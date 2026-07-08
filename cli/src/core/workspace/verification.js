// Structured workspace verification and switch preview (v2.1.8).
// Layers on top of health.js's verifyWorkspace() and switcher.js's
// switchToWorkspace() — both of those remain unchanged for backward
// compatibility. This module adds:
//   - verifyWorkspaceStructured(): groups results by subsystem with
//     per-field details (User, Email, Context, Status) instead of a
//     flat list of PASS/WARNING/FAIL strings.
//   - previewSwitch(): shows what would change for each subsystem if
//     the user switched to a target workspace, without actually
//     applying anything.
import { commandExists, captureShellCommand } from "../shell.js";
import { getWorkspace, getActiveWorkspaceName } from "./store.js";
import { verifyWorkspace } from "./health.js";
import { getSecret } from "./env.js";
import { listDockerContexts } from "./docker.js";
import { listKubeContexts } from "./kubernetes.js";
import { getWorkspaceMetadata } from "./metadata.js";
import { existsSync, readFileSync, readdirSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import crypto from "node:crypto";
import { runShellCommand, shellQuote } from "../shell.js";
import { migrateWorkspace, CURRENT_SCHEMA_VERSION } from "./schema.js";
import { workspaceExists } from "./store.js";
import { loadProfiles, loadCollections, loadRecipes, loadPackages } from "../registry.js";
import { discoverPlugins } from "../plugins.js";

// ─── Structured Verification ─────────────────────────────────────────

// verifyWorkspaceStructured(workspace) -> { score, verdict, pass, warn,
// fail, total, subsystems: [{ name, label, checks: [{ field, value,
// status, description }] }] }
//
// Groups the flat results from verifyWorkspace() into per-subsystem
// sections with structured field/value/status triples, matching the
// "Better Verification" format from the v2.1.8 audit:
//
//   Git
//     User        John Smith      PASS
//     Email       john@x.com      PASS
//     Signing     enabled         PASS
//   Docker
//     Context     production      PASS
//     Status      Healthy         PASS
export async function verifyWorkspaceStructured(workspace) {
    const raw = await verifyWorkspace(workspace);
    const groups = groupResultsBySubsystem(raw.results);
    return {
        score: raw.score,
        verdict: raw.verdict,
        pass: raw.pass,
        warn: raw.warn,
        fail: raw.fail,
        total: raw.total,
        subsystems: groups,
    };
}

// groupResultsBySubsystem(results) -> [{ name, label, checks }]
// Maps each flat result string to a subsystem based on its content,
// then groups them. The description text from verifyWorkspace() already
// contains enough context to categorize each check.
function groupResultsBySubsystem(results) {
    const groups = {};
    for (const r of results) {
        const info = categorizeResult(r);
        if (!groups[info.subsystem]) {
            groups[info.subsystem] = { name: info.subsystem, label: info.label, checks: [] };
        }
        groups[info.subsystem].checks.push({
            field: info.field,
            value: info.value,
            status: r.status,
            description: r.description,
        });
    }
    return Object.values(groups);
}

function categorizeResult(r) {
    const desc = r.description.toLowerCase();
    if (desc.includes("schema") || desc.includes("workspace document")) {
        return { subsystem: "schema", label: "Schema", field: "Document", value: "Valid" };
    }
    if (desc.includes("profile") && !desc.includes("component")) {
        return { subsystem: "registry", label: "Registry", field: "Profile", value: r.description.split("'")[1] || "-" };
    }
    if (desc.includes("collection")) {
        return { subsystem: "registry", label: "Registry", field: "Collection", value: r.description.split("'")[1] || "-" };
    }
    if (desc.includes("recipe")) {
        return { subsystem: "registry", label: "Registry", field: "Recipe", value: r.description.split("'")[1] || "-" };
    }
    if (desc.includes("component") && !desc.includes("plugin")) {
        return { subsystem: "registry", label: "Registry", field: "Component", value: r.description.split("'")[1] || "-" };
    }
    if (desc.includes("plugin")) {
        return { subsystem: "plugins", label: "Plugins", field: "Plugin", value: r.description.split("'")[1] || "-" };
    }
    if (desc.includes("git-lfs") || desc.includes("git lfs")) {
        return { subsystem: "git", label: "Git", field: "LFS", value: r.status === "PASS" ? "Installed" : "Missing" };
    }
    if (desc.includes("git is installed") || desc.includes("git is not installed")) {
        return { subsystem: "git", label: "Git", field: "Installed", value: r.status === "PASS" ? "Yes" : "No" };
    }
    if (desc.includes("git.hookspath") || desc.includes("hooksPath")) {
        return { subsystem: "git", label: "Git", field: "Hooks Path", value: r.status === "PASS" ? "Exists" : "Missing" };
    }
    if (desc.includes("ssh identity") || desc.includes("ssh identity file")) {
        const name = r.description.match(/'([^']+)'/)?.[1] || "-";
        return { subsystem: "ssh", label: "SSH", field: `Key: ${name}`, value: r.status === "PASS" ? "Exists" : "Missing" };
    }
    if (desc.includes("secret") && desc.includes("decrypt")) {
        const name = r.description.match(/'([^']+)'/)?.[1] || "-";
        return { subsystem: "secrets", label: "Secrets", field: name, value: r.status === "PASS" ? "Decrypts" : "Failed" };
    }
    if (desc.includes("docker context")) {
        const ctx = r.description.match(/'([^']+)'/)?.[1] || "-";
        return { subsystem: "docker", label: "Docker", field: "Context", value: ctx };
    }
    if (desc.includes("kubernetes context")) {
        const ctx = r.description.match(/'([^']+)'/)?.[1] || "-";
        return { subsystem: "kubernetes", label: "Kubernetes", field: "Context", value: ctx };
    }
    if (desc.includes("gcloud") || desc.includes("az ") || desc.includes("azure")) {
        return { subsystem: "cloud", label: "Cloud", field: "CLI", value: r.status === "PASS" ? "Installed" : "Missing" };
    }
    if (desc.includes("ollama")) {
        return { subsystem: "ai", label: "AI", field: "Ollama", value: r.status === "PASS" ? "Installed" : "Missing" };
    }
    if (desc.includes("ai provider")) {
        return { subsystem: "ai", label: "AI", field: "Provider", value: r.status === "PASS" ? "Configured" : "Incomplete" };
    }
    if (desc.includes("vscode") || desc.includes("cursor") || desc.includes("editor")) {
        return { subsystem: "editor", label: "Editor", field: "CLI", value: r.status === "PASS" ? "Installed" : "Missing" };
    }
    if (desc.includes("mise")) {
        return { subsystem: "packageManagers", label: "Package Managers", field: "mise", value: r.status === "PASS" ? "Installed" : "Missing" };
    }
    if (desc.includes("brewfile") || desc.includes("brew")) {
        return { subsystem: "packageManagers", label: "Package Managers", field: "Brewfile", value: r.status === "PASS" ? "Exists" : "Missing" };
    }
    if (desc.includes("outdated")) {
        return { subsystem: "packages", label: "Packages", field: "Outdated", value: r.status === "PASS" ? "Up to date" : "Outdated" };
    }
    if (desc.includes("installed")) {
        const name = r.description.match(/^(\S+)/)?.[1] || "-";
        return { subsystem: "packages", label: "Packages", field: name, value: r.status === "PASS" ? "Installed" : "Missing" };
    }
    return { subsystem: "other", label: "Other", field: r.description.slice(0, 40), value: r.status };
}

// formatStructuredVerification(result) -> string[] of lines for CLI output.
export function formatStructuredVerification(result) {
    const lines = [];
    for (const sub of result.subsystems) {
        lines.push(sub.label);
        for (const check of sub.checks) {
            const status = check.status === "PASS" ? "✓" : check.status === "WARNING" ? "⚠" : "✗";
            lines.push(`  ${check.field.padEnd(14)} ${String(check.value).padEnd(20)} ${status}`);
        }
        lines.push("");
    }
    lines.push(`Score: ${result.score}% - ${result.verdict} (${result.pass} pass, ${result.warn} warn, ${result.fail} fail)`);
    return lines;
}

// ─── Switch Preview ──────────────────────────────────────────────────

// previewSwitch(name) -> { target, current, changes: [{ subsystem, field,
// from, to }], warnings: [] }
//
// Compares the target workspace's declared configuration against the
// current live machine state (git config, docker context, kubectl
// context, cloud configs) to show what would change if the user
// switched. Does NOT apply anything — pure read-only inspection.
export async function previewSwitch(name) {
    const target = getWorkspace(name);
    const currentName = getActiveWorkspaceName();
    const current = currentName ? getWorkspace(currentName) : null;

    const changes = [];
    const warnings = [];

    // Git identity
    const liveGit = await captureLiveGit();
    if (target.git?.name && target.git.name !== liveGit.name) {
        changes.push({ subsystem: "Git", field: "User", from: liveGit.name || "(unset)", to: target.git.name });
    }
    if (target.git?.email && target.git.email !== liveGit.email) {
        changes.push({ subsystem: "Git", field: "Email", from: liveGit.email || "(unset)", to: target.git.email });
    }
    if (target.git?.signingKey !== (current?.git?.signingKey || null)) {
        changes.push({ subsystem: "Git", field: "Signing", from: current?.git?.signingKey ? "enabled" : "disabled", to: target.git?.signingKey ? "enabled" : "disabled" });
    }
    if (target.git?.defaultBranch && target.git.defaultBranch !== liveGit.defaultBranch) {
        changes.push({ subsystem: "Git", field: "Default branch", from: liveGit.defaultBranch || "(default)", to: target.git.defaultBranch });
    }

    // Docker context
    if (target.docker?.context) {
        const liveDocker = await captureLiveDocker();
        if (target.docker.context !== liveDocker) {
            changes.push({ subsystem: "Docker", field: "Context", from: liveDocker || "(none)", to: target.docker.context });
        }
        if (!(await commandExists("docker"))) {
            warnings.push("docker is not installed - context switch will be a no-op");
        }
    }

    // Kubernetes context
    if (target.kubernetes?.context) {
        const liveKube = await captureLiveKube();
        if (target.kubernetes.context !== liveKube) {
            changes.push({ subsystem: "Kubernetes", field: "Context", from: liveKube || "(none)", to: target.kubernetes.context });
        }
        if (target.kubernetes.namespace) {
            changes.push({ subsystem: "Kubernetes", field: "Namespace", from: "(current)", to: target.kubernetes.namespace });
        }
        if (!(await commandExists("kubectl"))) {
            warnings.push("kubectl is not installed - context switch will be a no-op");
        }
    }

    // Cloud
    const cloudProviders = Object.entries(target.cloud || {}).filter(([, ref]) => ref && ref.ref);
    for (const [provider, ref] of cloudProviders) {
        changes.push({ subsystem: "Cloud", field: provider, from: "(current)", to: ref.ref });
        if (provider === "gcp" && !(await commandExists("gcloud"))) {
            warnings.push("gcloud is not installed - GCP config switch will be a no-op");
        }
        if (provider === "azure" && !(await commandExists("az"))) {
            warnings.push("az is not installed - Azure subscription switch will be a no-op");
        }
    }

    // SSH
    if ((target.ssh?.identities || []).length > 0) {
        changes.push({ subsystem: "SSH", field: "Identities", from: "(current)", to: `${target.ssh.identities.length} identity block(s)` });
    }

    // Environment
    const envVars = Object.keys(target.env?.variables || {});
    const secretKeys = target.env?.secretKeys || [];
    if (envVars.length > 0 || secretKeys.length > 0) {
        changes.push({ subsystem: "Environment", field: "Variables", from: "(current)", to: `${envVars.length} var(s), ${secretKeys.length} secret(s)` });
    }

    // Shell
    const shellAliases = Object.keys(target.shell?.aliases || {});
    const shellFunctions = Object.keys(target.shell?.functions || {});
    const pathAdds = target.shell?.pathAdditions || [];
    if (shellAliases.length > 0 || shellFunctions.length > 0 || pathAdds.length > 0) {
        changes.push({ subsystem: "Shell", field: "Config", from: "(current)", to: `${shellAliases.length} alias(es), ${shellFunctions.length} function(s), ${pathAdds.length} PATH addition(s)` });
    }

    return {
        target: name,
        current: currentName || "(none)",
        changes,
        warnings,
    };
}

async function captureLiveGit() {
    const get = async (key) => {
        const { code, stdout } = await captureShellCommand(`git config --global --get ${key}`);
        return code === 0 ? stdout.trim() || null : null;
    };
    const [name, email, defaultBranch] = await Promise.all([
        get("user.name"), get("user.email"), get("init.defaultBranch"),
    ]);
    return { name, email, defaultBranch };
}

async function captureLiveDocker() {
    if (!(await commandExists("docker"))) return null;
    const { code, stdout } = await captureShellCommand("docker context show");
    return code === 0 ? stdout.trim() : null;
}

async function captureLiveKube() {
    if (!(await commandExists("kubectl"))) return null;
    const { code, stdout } = await captureShellCommand("kubectl config current-context");
    return code === 0 ? stdout.trim() : null;
}

// formatSwitchPreview(preview) -> string[] of lines for CLI output.
export function formatSwitchPreview(preview) {
    const lines = [];
    lines.push("Workspace Switch Preview");
    lines.push(`  Current:  ${preview.current}`);
    lines.push(`  Target:   ${preview.target}`);
    lines.push("");

    if (preview.changes.length === 0) {
        lines.push("  No changes — target matches current live state.");
        return lines;
    }

    lines.push("Changes:");
    let lastSubsystem = null;
    for (const c of preview.changes) {
        if (c.subsystem !== lastSubsystem) {
            lines.push(`  ${c.subsystem}`);
            lastSubsystem = c.subsystem;
        }
        lines.push(`    ${c.field.padEnd(14)} ${c.from} → ${c.to}`);
    }

    if (preview.warnings.length > 0) {
        lines.push("");
        lines.push("Warnings:");
        for (const w of preview.warnings) {
            lines.push(`  ⚠ ${w}`);
        }
    }

    return lines;
}

// ─── Workspace Diff ──────────────────────────────────────────────────

// diffWorkspaces(nameA, nameB) -> { nameA, nameB, differences: [{ subsystem,
// field, valueA, valueB }], same: boolean }
//
// Compares two workspaces across every subsystem, reporting per-field
// differences. Pure data comparison — no I/O, no async.
export function diffWorkspaces(nameA, nameB) {
    const a = getWorkspace(nameA);
    const b = getWorkspace(nameB);
    const diffs = [];

    const compare = (subsystem, field, va, vb) => {
        const sa = JSON.stringify(va);
        const sb = JSON.stringify(vb);
        if (sa !== sb) {
            diffs.push({ subsystem, field, valueA: va, valueB: vb });
        }
    };

    // Top-level
    compare("General", "Description", a.description, b.description);
    compare("General", "Status", a.status, b.status);
    compare("General", "Owner", a.owner, b.owner);
    compare("General", "Profile", a.profile, b.profile);
    compare("General", "Tags", a.tags, b.tags);
    compare("General", "Components", a.components, b.components);
    compare("General", "Plugins", a.plugins, b.plugins);
    compare("General", "Recipes", a.recipes, b.recipes);
    compare("General", "Collections", a.collections, b.collections);

    // Git
    compare("Git", "User", a.git?.name, b.git?.name);
    compare("Git", "Email", a.git?.email, b.git?.email);
    compare("Git", "Signing key", a.git?.signingKey, b.git?.signingKey);
    compare("Git", "Default branch", a.git?.defaultBranch, b.git?.defaultBranch);
    compare("Git", "Hooks path", a.git?.hooksPath, b.git?.hooksPath);
    compare("Git", "Credential helper", a.git?.credentialHelper, b.git?.credentialHelper);
    compare("Git", "LFS", a.git?.lfs, b.git?.lfs);
    compare("Git", "Aliases", a.git?.aliases, b.git?.aliases);

    // SSH
    compare("SSH", "Identities", a.ssh?.identities, b.ssh?.identities);
    compare("SSH", "Known hosts", a.ssh?.knownHosts, b.ssh?.knownHosts);

    // Env
    compare("Env", "Variables", a.env?.variables, b.env?.variables);
    compare("Env", "Secret keys", a.env?.secretKeys, b.env?.secretKeys);

    // Docker
    compare("Docker", "Context", a.docker?.context, b.docker?.context);
    compare("Docker", "Compose files", a.docker?.composeFiles, b.docker?.composeFiles);
    compare("Docker", "Networks", a.docker?.networks, b.docker?.networks);
    compare("Docker", "Volumes", a.docker?.volumes, b.docker?.volumes);

    // Kubernetes
    compare("Kubernetes", "Context", a.kubernetes?.context, b.kubernetes?.context);
    compare("Kubernetes", "Namespace", a.kubernetes?.namespace, b.kubernetes?.namespace);
    compare("Kubernetes", "Clusters", a.kubernetes?.clusters, b.kubernetes?.clusters);

    // Cloud
    for (const provider of ["aws", "azure", "gcp", "firebase", "supabase", "cloudflare", "vercel", "netlify"]) {
        compare("Cloud", provider, a.cloud?.[provider], b.cloud?.[provider]);
    }

    // AI
    compare("AI", "Provider", a.ai?.provider, b.ai?.provider);
    compare("AI", "Model", a.ai?.model, b.ai?.model);
    compare("AI", "Endpoint", a.ai?.endpoint, b.ai?.endpoint);
    compare("AI", "API key ref", a.ai?.apiKeyRef, b.ai?.apiKeyRef);

    // Editor
    compare("Editor", "App", a.editor?.app, b.editor?.app);
    compare("Editor", "Theme", a.editor?.theme, b.editor?.theme);
    compare("Editor", "Extensions", a.editor?.extensions, b.editor?.extensions);

    // Shell
    compare("Shell", "Shell", a.shell?.shell, b.shell?.shell);
    compare("Shell", "Aliases", a.shell?.aliases, b.shell?.aliases);
    compare("Shell", "Functions", a.shell?.functions, b.shell?.functions);
    compare("Shell", "Prompt", a.shell?.prompt, b.shell?.prompt);
    compare("Shell", "PATH additions", a.shell?.pathAdditions, b.shell?.pathAdditions);

    // Package managers
    compare("Package Managers", "Brewfile", a.packageManagers?.brew?.brewfile, b.packageManagers?.brew?.brewfile);
    compare("Package Managers", "mise tools", a.packageManagers?.mise?.tools, b.packageManagers?.mise?.tools);
    compare("Package Managers", "npm registry", a.packageManagers?.npm?.registry, b.packageManagers?.npm?.registry);

    return { nameA, nameB, differences: diffs, same: diffs.length === 0 };
}

// formatWorkspaceDiff(diff) -> string[] of lines for CLI output.
export function formatWorkspaceDiff(diff) {
    const lines = [];
    lines.push(`Workspace Diff: ${diff.nameA} vs ${diff.nameB}`);
    lines.push("");

    if (diff.same) {
        lines.push("  No differences — workspaces are identical.");
        return lines;
    }

    let lastSubsystem = null;
    for (const d of diff.differences) {
        if (d.subsystem !== lastSubsystem) {
            lines.push(`  ${d.subsystem}`);
            lastSubsystem = d.subsystem;
        }
        const va = d.valueA === null || d.valueA === undefined ? "(none)" : typeof d.valueA === "object" ? JSON.stringify(d.valueA) : String(d.valueA);
        const vb = d.valueB === null || d.valueB === undefined ? "(none)" : typeof d.valueB === "object" ? JSON.stringify(d.valueB) : String(d.valueB);
        const valA = va.length > 30 ? va.slice(0, 27) + "..." : va;
        const valB = vb.length > 30 ? vb.slice(0, 27) + "..." : vb;
        lines.push(`    ${d.field.padEnd(18)} ${valA} → ${valB}`);
    }

    lines.push("");
    lines.push(`  ${diff.differences.length} difference(s) across ${new Set(diff.differences.map((d) => d.subsystem)).size} subsystem(s).`);
    return lines;
}

// ─── Bundle Import Preview ───────────────────────────────────────────

// previewBundleImport(archivePath, { newName }) -> { name, schemaVersion,
// compatible, repairs: [], checksum: { verified, expected, actual },
// conflicts: { existingWorkspace: boolean } }
//
// Extracts the bundle to a temp dir, inspects its contents, and reports
// what would happen if imported — without actually importing anything.
export async function previewBundleImport(archivePath, { newName } = {}) {
    if (!existsSync(archivePath)) {
        throw new Error(`No such file: ${archivePath}`);
    }

    const extractDir = mkdtempSync(`${tmpdir()}/devforgekit-bundle-preview-`);
    try {
        const code = await runShellCommand(`tar -xzf ${shellQuote(archivePath)} -C ${shellQuote(extractDir)}`, { silent: true });
        if (code !== 0) {
            throw new Error(`tar failed while extracting ${archivePath} (exit ${code})`);
        }

        const topLevel = readdirSync(extractDir, { withFileTypes: true }).filter((e) => e.isDirectory());
        if (topLevel.length !== 1) {
            throw new Error(`Expected exactly one top-level directory in the bundle, found ${topLevel.length}`);
        }
        const extractedDir = `${extractDir}/${topLevel[0].name}`;

        const bundleMetaPath = `${extractedDir}/bundle.json`;
        const bundleMeta = existsSync(bundleMetaPath) ? JSON.parse(readFileSync(bundleMetaPath, "utf8")) : null;

        const manifestPath = `${extractedDir}/workspace.json`;
        if (!existsSync(manifestPath)) {
            throw new Error(`Bundle has no workspace.json`);
        }

        let doc;
        try {
            doc = migrateWorkspace(JSON.parse(readFileSync(manifestPath, "utf8")));
        } catch (err) {
            throw new Error(`Bundle's workspace.json is incompatible: ${err.message}`, { cause: err });
        }

        const finalName = newName || doc.name;
        const compatible = !bundleMeta || bundleMeta.workspaceSchemaVersion <= CURRENT_SCHEMA_VERSION;

        // Check for checksum
        let checksum = { verified: null, expected: null, actual: null };
        if (bundleMeta && bundleMeta.checksum) {
            checksum.expected = bundleMeta.checksum;
            const hash = crypto.createHash("sha256");
            hash.update(readFileSync(manifestPath));
            checksum.actual = hash.digest("hex");
            checksum.verified = checksum.expected === checksum.actual;
        }

        // Check for conflicts
        const conflicts = {
            existingWorkspace: workspaceExists(finalName),
        };

        // Preview repairs (without applying)
        const repairs = previewRepairs(doc);

        return {
            name: finalName,
            originalName: doc.name,
            schemaVersion: doc.schemaVersion,
            compatible,
            bundleMeta,
            repairs,
            checksum,
            conflicts,
            description: doc.description,
            git: { name: doc.git?.name, email: doc.git?.email },
            docker: { context: doc.docker?.context },
            kubernetes: { context: doc.kubernetes?.context },
            components: doc.components || [],
            plugins: doc.plugins || [],
            profile: doc.profile,
        };
    } finally {
        rmSync(extractDir, { recursive: true, force: true });
    }
}

function previewRepairs(doc) {
    const repairs = [];
    const repaired = { ...doc };

    const profileNames = new Set(loadProfiles().map((p) => p.name));
    if (repaired.profile && !profileNames.has(repaired.profile)) {
        repairs.push(`Would remove reference to unknown profile '${repaired.profile}'`);
    }

    const filterKnown = (names, knownSet, label) => {
        const dropped = (names || []).filter((n) => !knownSet.has(n));
        if (dropped.length > 0) repairs.push(`Would remove unknown ${label} reference(s): ${dropped.join(", ")}`);
    };

    filterKnown(repaired.collections, new Set(loadCollections().map((c) => c.name)), "collection");
    filterKnown(repaired.recipes, new Set(loadRecipes().map((r) => r.name)), "recipe");
    filterKnown(repaired.components, new Set(loadPackages().map((p) => p.name)), "component");
    filterKnown(repaired.plugins, new Set(discoverPlugins().filter((p) => p.valid).map((p) => p.name)), "plugin");

    return repairs;
}

// formatBundlePreview(preview) -> string[] of lines for CLI output.
export function formatBundlePreview(preview) {
    const lines = [];
    lines.push("Bundle Import Preview");
    lines.push(`  Name:          ${preview.name}${preview.name !== preview.originalName ? ` (original: ${preview.originalName})` : ""}`);
    lines.push(`  Description:   ${preview.description || "(none)"}`);
    lines.push(`  Schema:        v${preview.schemaVersion}`);
    lines.push(`  Compatible:    ${preview.compatible ? "Yes" : "No — bundle was created by a newer DevForgeKit"}`);
    lines.push("");

    if (preview.git.name || preview.git.email) {
        lines.push("Git");
        lines.push(`  User:          ${preview.git.name || "(not set)"}`);
        lines.push(`  Email:         ${preview.git.email || "(not set)"}`);
        lines.push("");
    }

    if (preview.docker.context) {
        lines.push(`Docker context: ${preview.docker.context}`);
    }
    if (preview.kubernetes.context) {
        lines.push(`Kubernetes:     ${preview.kubernetes.context}`);
    }
    if (preview.profile) {
        lines.push(`Profile:        ${preview.profile}`);
    }
    if (preview.components.length > 0) {
        lines.push(`Components:     ${preview.components.join(", ")}`);
    }
    if (preview.plugins.length > 0) {
        lines.push(`Plugins:        ${preview.plugins.join(", ")}`);
    }

    if (preview.checksum.verified !== null) {
        lines.push("");
        lines.push(`Checksum:       ${preview.checksum.verified ? "✓ verified" : "✗ MISMATCH"}`);
        if (!preview.checksum.verified) {
            lines.push(`  Expected:     ${preview.checksum.expected}`);
            lines.push(`  Actual:       ${preview.checksum.actual}`);
        }
    }

    if (preview.conflicts.existingWorkspace) {
        lines.push("");
        lines.push("⚠ A workspace with this name already exists — use --overwrite to replace it.");
    }

    if (preview.repairs.length > 0) {
        lines.push("");
        lines.push("Auto-repairs that would be applied:");
        for (const r of preview.repairs) {
            lines.push(`  • ${r}`);
        }
    }

    return lines;
}

// ─── Workspace Health Score ──────────────────────────────────────────

// computeWorkspaceHealth(workspace) -> { score, breakdown: [{ subsystem,
// status, count, detail }] }
//
// A quick, synchronous health score based on the workspace document's
// declared configuration — doesn't run verifyWorkspace() (which shells
// out to check if tools are installed). Instead, checks structural
// completeness: are subsystems configured, are references valid, are
// secrets declared, etc. Useful for the TUI overview and list display.
export function computeWorkspaceHealth(workspace) {
    const breakdown = [];
    let totalScore = 0;
    let count = 0;

    const check = (subsystem, condition, detail) => {
        const status = condition ? "healthy" : "unconfigured";
        breakdown.push({ subsystem, status, detail });
        totalScore += condition ? 100 : 0;
        count++;
    };

    check("Git", Boolean(workspace.git?.name || workspace.git?.email), workspace.git?.name ? `User: ${workspace.git.name}` : "Not configured");
    check("SSH", (workspace.ssh?.identities || []).length > 0, `${(workspace.ssh?.identities || []).length} identity/identities`);
    check("Env", Object.keys(workspace.env?.variables || {}).length > 0 || (workspace.env?.secretKeys || []).length > 0, `${Object.keys(workspace.env?.variables || {}).length} var(s), ${(workspace.env?.secretKeys || []).length} secret(s)`);
    check("Docker", Boolean(workspace.docker?.context), workspace.docker?.context || "No context");
    check("Kubernetes", Boolean(workspace.kubernetes?.context), workspace.kubernetes?.context || "No context");
    check("Cloud", Object.values(workspace.cloud || {}).some((c) => c && c.ref), `${Object.entries(workspace.cloud || {}).filter(([, c]) => c && c.ref).map(([p]) => p).join(", ") || "none"}`);
    check("AI", workspace.ai?.provider && workspace.ai.provider !== "none", workspace.ai?.provider || "none");
    check("Editor", workspace.editor?.app && workspace.editor.app !== "none", workspace.editor?.app || "none");
    check("Shell", Boolean(workspace.shell?.shell) || Object.keys(workspace.shell?.aliases || {}).length > 0, workspace.shell?.shell || "default");
    check("Components", (workspace.components || []).length > 0 || workspace.profile, `${(workspace.components || []).length} component(s)${workspace.profile ? `, profile: ${workspace.profile}` : ""}`);
    check("Plugins", (workspace.plugins || []).length > 0, `${(workspace.plugins || []).length} plugin(s)`);
    check("Compatibility", (workspace.compatibility?.scanHistory || []).length > 0, `${(workspace.compatibility?.scanHistory || []).length} scan(s)`);

    return {
        score: count > 0 ? Math.round(totalScore / count) : 0,
        breakdown,
    };
}

// formatHealthScore(health) -> string[] of lines for CLI output.
export function formatHealthScore(health) {
    const lines = [];
    lines.push(`Workspace Health: ${health.score}%`);
    lines.push("");

    for (const item of health.breakdown) {
        const icon = item.status === "healthy" ? "✓" : "○";
        const label = item.subsystem.padEnd(14);
        lines.push(`  ${icon} ${label} ${item.detail}`);
    }

    return lines;
}
