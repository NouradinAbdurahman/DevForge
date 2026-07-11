// Portable workspace bundles: `tar.gz` export/import of a workspace
// directory (secrets and snapshot history excluded - see store.js's
// WORKSPACE_TRANSFER_EXCLUDES), shelling out to the system `tar` exactly
// like core/pluginSdk.js's packagePlugin/installPlugin do, rather than
// adding a tar/zip npm dependency. A `bundle.json` sidecar records which
// DevForgeKit/workspace-schema version produced the archive - the
// "compatibility check" - and importing always runs the same reference-
// repair pass `repairWorkspace()` (below) uses standalone, so a bundle
// built on a machine with different registry contents (a custom profile/
// plugin that didn't travel with it) degrades to a warning-annotated
// import instead of a hard failure.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, renameSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { runShellCommand, shellQuote } from "../shell.js";
import { assertSafeTarArchive } from "../archiveSafety.js";
import { loadProfiles, loadCollections, loadRecipes, loadPackages } from "../registry.js";
import { discoverPlugins } from "../plugins.js";
import { getVersion } from "../../version.js";
import { DevForgeError } from "../errors.js";
import { logger } from "../logger.js";
import { workspaceDir, workspaceExists, getWorkspace, saveWorkspace, WORKSPACE_TRANSFER_EXCLUDES } from "./store.js";
import { migrateWorkspace, validateWorkspaceDoc, CURRENT_SCHEMA_VERSION } from "./schema.js";

// describeWorkspaceShellRisks(doc) -> string[] human-readable warnings
// for any workspace.shell.aliases/functions/pathAdditions the document
// declares. These are legitimate, advertised functionality for a
// workspace you built yourself, but they also become real, unattended
// shell code the instant `workspace switch` sources workspace-shell.sh -
// and workspace bundles are explicitly built for sharing
// (export/import), so an imported bundle from someone else is the
// sharpest place this surface matters: nothing else in the import path
// reviews this content before it starts affecting your real shell.
// Exported so verification.js's previewBundleImport can surface the
// same list before anything is even extracted to a real workspace.
export function describeWorkspaceShellRisks(doc) {
    const risks = [];
    const shell = doc.shell || {};
    const aliasNames = Object.keys(shell.aliases || {});
    const functionNames = Object.keys(shell.functions || {});
    const pathAdditions = shell.pathAdditions || [];
    if (aliasNames.length > 0) {
        risks.push(`Declares ${aliasNames.length} shell alias(es) that will be sourced into your shell on 'workspace switch': ${aliasNames.join(", ")}`);
    }
    if (functionNames.length > 0) {
        risks.push(`Declares ${functionNames.length} shell function(s) that will be sourced into your shell on 'workspace switch': ${functionNames.join(", ")}`);
    }
    if (pathAdditions.length > 0) {
        risks.push(`Prepends ${pathAdditions.length} director(ies) to PATH ahead of everything else on 'workspace switch': ${pathAdditions.join(", ")}`);
    }
    return risks;
}

function tempDir(prefix) {
    return mkdtempSync(path.join(tmpdir(), prefix));
}

// autoRepairDoc(doc) -> { doc, repairs: string[] }. Drops any reference
// to a profile/collection/recipe/component/plugin that doesn't exist on
// *this* machine's registry, reporting exactly what was dropped rather
// than silently losing it or crashing the import over it. Every other
// field (git/ssh/env/docker/...) is left untouched - those are workspace-
// owned data, not registry references, so there's nothing for this
// module to reconcile them against.
function autoRepairDoc(doc) {
    const repairs = [];
    const repaired = { ...doc };

    const profileNames = new Set(loadProfiles().map((p) => p.name));
    if (repaired.profile && !profileNames.has(repaired.profile)) {
        repairs.push(`Removed reference to unknown profile '${repaired.profile}'`);
        repaired.profile = null;
    }

    const filterKnown = (names, knownSet, label) => {
        const kept = (names || []).filter((n) => knownSet.has(n));
        const dropped = (names || []).filter((n) => !knownSet.has(n));
        if (dropped.length > 0) repairs.push(`Removed unknown ${label} reference(s): ${dropped.join(", ")}`);
        return kept;
    };

    repaired.collections = filterKnown(repaired.collections, new Set(loadCollections().map((c) => c.name)), "collection");
    repaired.recipes = filterKnown(repaired.recipes, new Set(loadRecipes().map((r) => r.name)), "recipe");
    repaired.components = filterKnown(repaired.components, new Set(loadPackages().map((p) => p.name)), "component");
    repaired.plugins = filterKnown(repaired.plugins, new Set(discoverPlugins().filter((p) => p.valid).map((p) => p.name)), "plugin");

    return { doc: repaired, repairs };
}

// repairWorkspace(name) -> { workspace, repairs } - the standalone
// `workspace repair <name>` command's implementation: re-runs
// autoRepairDoc() against the workspace *currently on disk* (not an
// imported bundle), so drift introduced by e.g. deleting a custom
// profile/plugin after the workspace was created gets the exact same
// fix-up path a fresh import would have gotten.
export function repairWorkspace(name) {
    const { doc, repairs } = autoRepairDoc(getWorkspace(name));
    const workspace = repairs.length > 0 ? saveWorkspace(doc) : doc;
    return { workspace, repairs };
}

// exportWorkspaceBundle(name, outDir) -> { archivePath, meta }
export async function exportWorkspaceBundle(name, outDir) {
    const doc = getWorkspace(name);
    mkdirSync(outDir, { recursive: true });

    const staging = tempDir("devforgekit-workspace-export-");
    const srcDir = workspaceDir(name);
    const stagedDir = path.join(staging, name);
    cpSync(srcDir, stagedDir, {
        recursive: true,
        filter: (src) => !WORKSPACE_TRANSFER_EXCLUDES.has(path.relative(srcDir, src))
    });

    const meta = {
        bundleSchemaVersion: 1,
        workspaceSchemaVersion: doc.schemaVersion,
        devforgekitVersion: getVersion(),
        name: doc.name,
        exportedAt: new Date().toISOString()
    };
    writeFileSync(path.join(stagedDir, "bundle.json"), `${JSON.stringify(meta, null, 2)}\n`);

    const manifestPath = path.join(stagedDir, "workspace.json");
    const hash = crypto.createHash("sha256");
    hash.update(readFileSync(manifestPath));
    meta.checksum = hash.digest("hex");
    writeFileSync(path.join(stagedDir, "bundle.json"), `${JSON.stringify(meta, null, 2)}\n`);

    const archivePath = path.join(outDir, `${name}-workspace.tar.gz`);
    const code = await runShellCommand(`tar -czf ${shellQuote(archivePath)} -C ${shellQuote(staging)} ${shellQuote(name)}`, { silent: true });
    rmSync(staging, { recursive: true, force: true });
    if (code !== 0) {
        throw new DevForgeError(`tar failed while exporting workspace '${name}' (exit ${code})`);
    }
    return { archivePath, meta };
}

// importWorkspaceBundle(archivePath, { newName, overwrite }) ->
// { workspace, bundleMeta, repairs }. `newName` imports under a
// different name than the bundle recorded (e.g. importing a coworker's
// bundle without clobbering your own workspace of the same name);
// `overwrite: true` allows replacing an existing workspace of the target
// name (default: refuse, matching store.js's createWorkspace).
export async function importWorkspaceBundle(archivePath, { newName, overwrite = false } = {}) {
    if (!existsSync(archivePath)) {
        throw new DevForgeError(`No such file: ${archivePath}`);
    }

    await assertSafeTarArchive(archivePath);

    const extractDir = tempDir("devforgekit-workspace-import-");
    const code = await runShellCommand(`tar -xzf ${shellQuote(archivePath)} -C ${shellQuote(extractDir)}`, { silent: true });
    if (code !== 0) {
        rmSync(extractDir, { recursive: true, force: true });
        throw new DevForgeError(`tar failed while extracting ${archivePath} (exit ${code})`);
    }

    const topLevel = readdirSync(extractDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (topLevel.length !== 1) {
        rmSync(extractDir, { recursive: true, force: true });
        throw new DevForgeError(`Expected exactly one top-level directory in the bundle, found ${topLevel.length}`);
    }
    const extractedDir = path.join(extractDir, topLevel[0].name);

    const bundleMetaPath = path.join(extractedDir, "bundle.json");
    const bundleMeta = existsSync(bundleMetaPath) ? JSON.parse(readFileSync(bundleMetaPath, "utf8")) : null;
    if (bundleMeta && bundleMeta.workspaceSchemaVersion > CURRENT_SCHEMA_VERSION) {
        rmSync(extractDir, { recursive: true, force: true });
        throw new DevForgeError(`This bundle was created by a newer DevForgeKit (workspace schema v${bundleMeta.workspaceSchemaVersion}, this CLI supports up to v${CURRENT_SCHEMA_VERSION}). Update DevForgeKit to import it.`);
    }

    const manifestPath = path.join(extractedDir, "workspace.json");
    if (!existsSync(manifestPath)) {
        rmSync(extractDir, { recursive: true, force: true });
        throw new DevForgeError(`Bundle has no workspace.json at ${manifestPath}`);
    }

    if (bundleMeta && bundleMeta.checksum) {
        const hash = crypto.createHash("sha256");
        hash.update(readFileSync(manifestPath));
        const actual = hash.digest("hex");
        if (actual !== bundleMeta.checksum) {
            rmSync(extractDir, { recursive: true, force: true });
            throw new DevForgeError(`Bundle integrity check failed: workspace.json checksum mismatch (expected ${bundleMeta.checksum.slice(0, 12)}..., got ${actual.slice(0, 12)}...). The archive may be corrupted or tampered with.`);
        }
    }

    let doc;
    try {
        doc = migrateWorkspace(JSON.parse(readFileSync(manifestPath, "utf8")));
    } catch (err) {
        rmSync(extractDir, { recursive: true, force: true });
        throw new DevForgeError(`Bundle's workspace.json is incompatible: ${err.message}`);
    }

    const { doc: repaired, repairs } = autoRepairDoc(doc);
    const finalName = newName || repaired.name;
    repaired.name = finalName;

    if (workspaceExists(finalName) && !overwrite) {
        rmSync(extractDir, { recursive: true, force: true });
        throw new DevForgeError(`Workspace '${finalName}' already exists - pass a different name or overwrite: true.`);
    }

    const destDir = workspaceDir(finalName);
    if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
    mkdirSync(path.dirname(destDir), { recursive: true });
    renameSync(extractedDir, destDir);
    rmSync(path.join(destDir, "bundle.json"), { force: true });
    rmSync(extractDir, { recursive: true, force: true });

    const workspace = saveWorkspace(validateWorkspaceDoc(repaired));

    const shellRisks = describeWorkspaceShellRisks(repaired);
    for (const risk of shellRisks) {
        logger.warn(`Imported workspace '${finalName}': ${risk}`);
    }

    return { workspace, bundleMeta, repairs, shellRisks };
}
