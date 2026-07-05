// Point-in-time snapshots of a workspace's document, stored under
// `<workspace dir>/snapshots/<id>/`. Deliberately only ever
// copies workspace.json - never the env/ secrets sidecar (secrets.enc.json)
// or its key. Two reasons: (1) it keeps a security-sensitive artifact
// from being duplicated once per snapshot forever, and (2) it makes the
// behavior of restoring an old snapshot unambiguous - a restore rolls
// back *which* keys are declared secret (`env.secretKeys`) and every
// other structural field, but a secret's live *value* is whatever is
// currently stored for that key name (health.js's "declared secret does
// not decrypt" check is exactly the signal a user gets if a restored
// snapshot references a secret that's since been removed). "Rollback"
// in the fuller sense (re-applying git/ssh/docker/k8s/shell state to
// match a restored snapshot) is switcher.js's job, layered on top of
// restoreSnapshot() here - this module never touches the live machine.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { workspaceDir, getWorkspace, saveWorkspace } from "./store.js";
import { validateWorkspaceDoc } from "./schema.js";
import { DevForgeError } from "../errors.js";

function snapshotsDir(name) {
    return path.join(workspaceDir(name), "snapshots");
}

function snapshotDir(name, id) {
    return path.join(snapshotsDir(name), id);
}

function snapshotManifestPath(name, id) {
    return path.join(snapshotDir(name, id), "workspace.json");
}

function snapshotMetaPath(name, id) {
    return path.join(snapshotDir(name, id), "meta.json");
}

// makeSnapshotId(isoTimestamp) - derives the id from the *same* instant
// createSnapshot() records as `createdAt` (a single `new Date()` call,
// threaded through) rather than calling `new Date()` a second time -
// two separate calls could straddle a millisecond boundary, leaving the
// id's embedded timestamp and the recorded createdAt one millisecond
// apart and no longer agreeing on relative order.
function makeSnapshotId(isoTimestamp) {
    return `${isoTimestamp.replace(/[:.]/g, "-")}-${crypto.randomBytes(2).toString("hex")}`;
}

// createSnapshot(workspaceName, { message }) -> { id, createdAt, message, schemaVersion, sourceModifiedAt }
export function createSnapshot(workspaceName, { message = "" } = {}) {
    const doc = getWorkspace(workspaceName);
    const createdAt = new Date().toISOString();
    const id = makeSnapshotId(createdAt);
    mkdirSync(snapshotDir(workspaceName, id), { recursive: true });
    writeFileSync(snapshotManifestPath(workspaceName, id), `${JSON.stringify(doc, null, 2)}\n`);
    const meta = { id, createdAt, message, schemaVersion: doc.schemaVersion, sourceModifiedAt: doc.modifiedAt };
    writeFileSync(snapshotMetaPath(workspaceName, id), `${JSON.stringify(meta, null, 2)}\n`);
    return meta;
}

// listSnapshots(workspaceName) -> [{ id, createdAt, message, ... }, ...],
// newest first. A snapshot whose meta.json is missing/corrupt is still
// listed (with a placeholder message) rather than silently hidden - a
// broken snapshot is something `workspace snapshot list` should surface,
// not swallow.
export function listSnapshots(workspaceName) {
    let entries;
    try {
        entries = readdirSync(snapshotsDir(workspaceName), { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
        return [];
    }
    const snapshots = entries.map((entry) => {
        try {
            return JSON.parse(readFileSync(snapshotMetaPath(workspaceName, entry.name), "utf8"));
        } catch {
            return { id: entry.name, createdAt: null, message: "(corrupt snapshot metadata)" };
        }
    });
    // Plain codepoint comparison, not localeCompare() - ICU's default
    // locale-aware collation does not reliably preserve the chronological
    // ordering of fixed-format ISO-8601-like strings (verified: it
    // sorted two real createdAt timestamps one millisecond apart out of
    // order), whereas `<`/`>` on strings this shape is exactly a
    // timestamp comparison.
    return snapshots.sort((a, b) => {
        const aKey = a.createdAt || "";
        const bKey = b.createdAt || "";
        if (aKey === bKey) return 0;
        return aKey < bKey ? 1 : -1;
    });
}

export function getSnapshotDoc(workspaceName, id) {
    const file = snapshotManifestPath(workspaceName, id);
    if (!existsSync(file)) {
        throw new DevForgeError(`Unknown snapshot '${id}' for workspace '${workspaceName}'.`);
    }
    return JSON.parse(readFileSync(file, "utf8"));
}

// restoreSnapshot(workspaceName, id) -> the restored (and saved)
// document. Keeps the workspace's real `name`/`createdAt` regardless of
// what the snapshot recorded (a snapshot always restores *into* the
// workspace it was taken from, never renames/re-dates it); every other
// field reverts to the snapshot's values, and saveWorkspace() stamps a
// fresh `modifiedAt`.
export function restoreSnapshot(workspaceName, id) {
    const snapshotDoc = getSnapshotDoc(workspaceName, id);
    const current = getWorkspace(workspaceName);
    const restored = validateWorkspaceDoc({ ...snapshotDoc, name: current.name, createdAt: current.createdAt });
    return saveWorkspace(restored);
}

export function deleteSnapshot(workspaceName, id) {
    const dir = snapshotDir(workspaceName, id);
    if (!existsSync(dir)) {
        throw new DevForgeError(`Unknown snapshot '${id}' for workspace '${workspaceName}'.`);
    }
    rmSync(dir, { recursive: true, force: true });
}

// exportSnapshot(workspaceName, id, destPath) -> destPath. A lightweight,
// single-file export of just that point in time's workspace.json - see
// bundle.js for the full portable-workspace archive format (which
// exports the *current* state, not historical snapshots).
export function exportSnapshot(workspaceName, id, destPath) {
    writeFileSync(destPath, `${JSON.stringify(getSnapshotDoc(workspaceName, id), null, 2)}\n`);
    return destPath;
}

// diffDocs(a, b) -> { added, removed, changed } - a flat, top-level-key
// diff (deep-equal per key), not a recursive JSON patch. A workspace
// document is only one level of subsystem objects deep, so "which
// top-level section changed" (git/ssh/docker/...) is exactly the
// granularity a human comparing two snapshots needs.
function diffDocs(a, b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const added = [];
    const removed = [];
    const changed = [];
    for (const key of keys) {
        const inA = Object.prototype.hasOwnProperty.call(a, key);
        const inB = Object.prototype.hasOwnProperty.call(b, key);
        if (!inA && inB) {
            added.push(key);
        } else if (inA && !inB) {
            removed.push(key);
        } else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
            changed.push(key);
        }
    }
    return { added, removed, changed };
}

export function compareSnapshots(workspaceName, idA, idB) {
    return diffDocs(getSnapshotDoc(workspaceName, idA), getSnapshotDoc(workspaceName, idB));
}

// compareWithCurrent(workspaceName, id) -> same shape, snapshot vs. the
// live, current document.
export function compareWithCurrent(workspaceName, id) {
    return diffDocs(getSnapshotDoc(workspaceName, id), getWorkspace(workspaceName));
}
