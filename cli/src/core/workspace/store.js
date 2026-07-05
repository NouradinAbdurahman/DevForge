// Workspace storage: CRUD over ~/.config/devforgekit/workspaces/<name>/
// (one workspace.json manifest per directory, see schema.js) plus the
// single active-workspace pointer file. Deliberately pure data
// management, no subsystem side effects - applying a workspace's git/
// ssh/env/docker/etc. configuration to the live machine is switcher.js's
// job, layered on top of this. Mirrors core/plugins.js's discoverPlugins
// "never crash discovery over one bad entry" convention: a corrupt
// workspace.json is reported per-entry (valid: false, reason), not a
// thrown error that would take out `workspace list` for every other
// workspace on disk.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, cpSync, renameSync } from "node:fs";
import path from "node:path";
import { userConfigDir } from "../paths.js";
import { DevForgeError, usageError } from "../errors.js";
import { createWorkspaceDoc, migrateWorkspace, validateWorkspaceDoc } from "./schema.js";

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export function workspacesRoot() {
    return path.join(userConfigDir(), "workspaces");
}

export function workspaceDir(name) {
    return path.join(workspacesRoot(), name);
}

export function workspaceManifestPath(name) {
    return path.join(workspaceDir(name), "workspace.json");
}

function pointerPath() {
    return path.join(workspacesRoot(), "active.json");
}

export function assertValidWorkspaceName(name) {
    if (!name || !NAME_PATTERN.test(name)) {
        throw usageError(`Invalid workspace name '${name}' - must start with a lowercase letter and contain only lowercase letters, digits, and hyphens.`);
    }
}

export function workspaceExists(name) {
    return existsSync(workspaceManifestPath(name));
}

// loadWorkspaceEntry(name) -> { name, dir, valid, doc?, reason? }. The one
// place that reads a workspace.json off disk, migrates it, and validates
// it - listWorkspaces() and getWorkspace() both build on this so a
// corrupt/incompatible workspace is described identically everywhere.
function loadWorkspaceEntry(name) {
    const dir = workspaceDir(name);
    const manifestPath = workspaceManifestPath(name);
    if (!existsSync(manifestPath)) {
        return { name, dir, valid: false, reason: "No workspace.json found" };
    }
    let raw;
    try {
        raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (err) {
        return { name, dir, valid: false, reason: `Failed to parse workspace.json: ${err.message}` };
    }
    try {
        const doc = validateWorkspaceDoc(migrateWorkspace(raw));
        return { name, dir, valid: true, doc };
    } catch (err) {
        return { name, dir, valid: false, reason: err.message };
    }
}

// listWorkspaces() -> [{ name, dir, valid, doc?, reason? }, ...], sorted
// by name. Includes invalid entries (matching discoverPlugins()) so
// `workspace list`/health tooling can surface "this workspace is broken"
// instead of it silently vanishing from every listing.
export function listWorkspaces() {
    const root = workspacesRoot();
    let entries;
    try {
        entries = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
        return [];
    }
    return entries
        .map((e) => loadWorkspaceEntry(e.name))
        .sort((a, b) => a.name.localeCompare(b.name));
}

// getWorkspace(name) -> valid workspace document, or throws. The
// "you asked for exactly one, it must exist and be valid" counterpart to
// listWorkspaces(), matching core/registry.js's getProfile/getPackage
// convention.
export function getWorkspace(name) {
    const entry = loadWorkspaceEntry(name);
    if (!entry.valid) {
        if (entry.reason === "No workspace.json found") {
            throw new DevForgeError(`Unknown workspace '${name}'. Run 'devforgekit workspace list' to see available workspaces.`);
        }
        throw new DevForgeError(`Workspace '${name}' is invalid: ${entry.reason}`);
    }
    return entry.doc;
}

// createWorkspace({ name, description, owner }) -> the created document.
export function createWorkspace({ name, description, owner } = {}) {
    assertValidWorkspaceName(name);
    if (workspaceExists(name)) {
        throw new DevForgeError(`Workspace '${name}' already exists. Use 'devforgekit workspace switch ${name}' or pick a different name.`);
    }
    const dir = workspaceDir(name);
    mkdirSync(dir, { recursive: true });
    const doc = createWorkspaceDoc({ name, description, owner });
    writeFileSync(workspaceManifestPath(name), `${JSON.stringify(doc, null, 2)}\n`);
    return doc;
}

// saveWorkspace(doc) -> doc (with a freshly-stamped modifiedAt). Always
// re-validates before writing - a hand-edited-then-saved document can
// never reach disk in a shape a later `getWorkspace()` would reject.
export function saveWorkspace(doc) {
    const updated = validateWorkspaceDoc({ ...doc, modifiedAt: new Date().toISOString() });
    if (!workspaceExists(updated.name)) {
        throw new DevForgeError(`Cannot save unknown workspace '${updated.name}' - create it first with 'devforgekit workspace create'.`);
    }
    writeFileSync(workspaceManifestPath(updated.name), `${JSON.stringify(updated, null, 2)}\n`);
    return updated;
}

// deleteWorkspace(name, { force }) -> void. Refuses to delete the
// currently-active workspace unless `force` is set, since that would
// leave the active pointer dangling (and the live machine still
// configured for a workspace whose definition just disappeared).
export function deleteWorkspace(name, { force = false } = {}) {
    if (!workspaceExists(name)) {
        throw new DevForgeError(`Unknown workspace '${name}'.`);
    }
    if (getActiveWorkspaceName() === name && !force) {
        throw new DevForgeError(`'${name}' is the active workspace - switch to another workspace first, or pass --force.`);
    }
    rmSync(workspaceDir(name), { recursive: true, force: true });
    if (getActiveWorkspaceName() === name) {
        setActiveWorkspaceName(null);
    }
}

// renameWorkspace(oldName, newName) -> the renamed document. Moves the
// whole directory (so snapshots/env files move with it) and keeps the
// active pointer pointed at the same workspace under its new name.
export function renameWorkspace(oldName, newName) {
    assertValidWorkspaceName(newName);
    const doc = getWorkspace(oldName);
    if (workspaceExists(newName)) {
        throw new DevForgeError(`Workspace '${newName}' already exists.`);
    }
    renameSync(workspaceDir(oldName), workspaceDir(newName));
    const renamed = saveWorkspace({ ...doc, name: newName });
    if (getActiveWorkspaceName() === oldName) {
        setActiveWorkspaceName(newName);
    }
    return renamed;
}

// Paths never carried over when a workspace directory is copied out from
// under itself - by cloneWorkspace() below, and by bundle.js's export:
// secrets (env.js's encrypted store and its per-workspace key) and
// snapshot history are workspace-specific and security-sensitive. A
// clone is a new workspace that happens to start with the same
// *configuration*, not a fork that silently inherits another
// workspace's secret values or point-in-time history; a bundle is
// meant to be portable/shareable, which secrets and local history
// specifically must never be.
export const WORKSPACE_TRANSFER_EXCLUDES = new Set(["snapshots", path.join("env", "secrets.enc.json"), path.join("env", "secret.key")]);

// cloneWorkspace(sourceName, newName, { description }) -> the cloned
// document. Copies the full directory (so env variable *names*, SSH
// identities, shell aliases, etc. all carry over) except the excluded
// secret/snapshot paths above.
export function cloneWorkspace(sourceName, newName, { description } = {}) {
    assertValidWorkspaceName(newName);
    const source = getWorkspace(sourceName);
    if (workspaceExists(newName)) {
        throw new DevForgeError(`Workspace '${newName}' already exists.`);
    }
    const srcDir = workspaceDir(sourceName);
    const destDir = workspaceDir(newName);
    cpSync(srcDir, destDir, {
        recursive: true,
        filter: (src) => !WORKSPACE_TRANSFER_EXCLUDES.has(path.relative(srcDir, src))
    });
    const now = new Date().toISOString();
    return saveWorkspace({
        ...source,
        name: newName,
        description: description || `Clone of '${sourceName}'`,
        createdAt: now,
        modifiedAt: now,
        env: { ...source.env, secretKeys: source.env.secretKeys || [] }
    });
}

// --------------------------------------------------------------------
// Active-workspace pointer
// --------------------------------------------------------------------

function readPointer() {
    try {
        return JSON.parse(readFileSync(pointerPath(), "utf8"));
    } catch {
        return { active: null };
    }
}

export function getActiveWorkspaceName() {
    return readPointer().active || null;
}

// getActiveWorkspace() -> the active workspace's document, or null if
// none is set. Throws (rather than silently returning null) if the
// pointer names a workspace that no longer exists on disk - that's a
// real inconsistency worth surfacing, not something to paper over.
export function getActiveWorkspace() {
    const name = getActiveWorkspaceName();
    if (!name) return null;
    return getWorkspace(name);
}

// setActiveWorkspaceName(name|null) - the low-level pointer write only.
// Does not apply anything to the live machine; see switcher.js for the
// orchestrated "switch" that calls this as its last step.
export function setActiveWorkspaceName(name) {
    if (name !== null) {
        assertValidWorkspaceName(name);
        if (!workspaceExists(name)) {
            throw new DevForgeError(`Unknown workspace '${name}'.`);
        }
    }
    mkdirSync(workspacesRoot(), { recursive: true });
    writeFileSync(pointerPath(), `${JSON.stringify({ active: name }, null, 2)}\n`);
    return name;
}

// --------------------------------------------------------------------
// Search
// --------------------------------------------------------------------

function searchHaystack(doc) {
    const cloudTokens = Object.entries(doc.cloud || {}).flatMap(([provider, ref]) => (ref && ref.ref ? [provider, ref.ref] : []));
    const sshTokens = (doc.ssh?.identities || []).flatMap((i) => [i.provider, i.host, i.hostAlias, i.user]);
    return [
        doc.name, doc.description, doc.profile, doc.owner,
        ...(doc.tags || []),
        ...(doc.recipes || []),
        ...(doc.collections || []),
        ...(doc.components || []),
        doc.git?.name, doc.git?.email,
        ...sshTokens,
        ...cloudTokens
    ].filter(Boolean).map((v) => String(v).toLowerCase());
}

// searchWorkspaces(query) -> [doc, ...] matching name, description,
// owner, tags, profile, recipes, collections, components (a stand-in for
// "language" - there is no dedicated language field, but runtimes like
// "node"/"python"/"go" are ordinary components), git identity, SSH
// provider/host/user, or a cloud provider's reference. Invalid workspaces
// are excluded (there's nothing meaningful to search in a document that
// didn't parse).
export function searchWorkspaces(query) {
    const docs = listWorkspaces().filter((w) => w.valid).map((w) => w.doc);
    const q = String(query || "").trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((doc) => searchHaystack(doc).some((token) => token.includes(q)));
}
