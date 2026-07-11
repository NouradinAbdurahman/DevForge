// Point-in-time environment snapshots: the tracked-package state
// (packages + observed versions/providers/locations) and every generated
// shell file's content, saved as one JSON document under
// ~/.config/devforgekit/environment-snapshots/. Restore rewrites the
// state file and regenerates from it - the same capture/restore shape
// core/workspace/snapshot.js established for workspaces.
//
// The generated file contents are stored for INSPECTION/diffing ("what
// did my PATH look like before this install?"), but restore regenerates
// from the restored state + the CURRENT registry rather than writing the
// stored bytes back verbatim - a snapshot must not resurrect a stale
// manifest's output and reintroduce exactly the drift the engine exists
// to prevent.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { userConfigDir } from "../paths.js";
import { DevForgeError } from "../errors.js";
import { loadEnvironmentState, saveEnvironmentState } from "./state.js";
import { shellFilePath } from "./shellFile.js";
import { SUPPORTED_SHELLS } from "./writers/index.js";

export function snapshotsDir() {
    return path.join(userConfigDir(), "environment-snapshots");
}

// createEnvironmentSnapshot({ message }) -> { id, file, doc }
export function createEnvironmentSnapshot({ message = "" } = {}) {
    const state = loadEnvironmentState();
    const files = {};
    for (const shell of SUPPORTED_SHELLS) {
        const file = shellFilePath(shell);
        if (existsSync(file)) files[shell] = readFileSync(file, "utf8");
    }

    // Timestamp-based id, made collision-proof: two snapshots created in
    // the same millisecond (restore's automatic safety snapshot right
    // after a manual one, on a fast machine) must never overwrite each
    // other - caught by a real failing test, not hypothetical.
    mkdirSync(snapshotsDir(), { recursive: true });
    const base = new Date().toISOString().replace(/[:.]/g, "-");
    let id = base;
    for (let n = 2; existsSync(path.join(snapshotsDir(), `${id}.json`)); n++) {
        id = `${base}-${n}`;
    }
    const doc = { id, createdAt: new Date().toISOString(), message, state, files };
    const file = path.join(snapshotsDir(), `${id}.json`);
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    return { id, file, doc };
}

// listEnvironmentSnapshots() -> [{ id, createdAt, message, packageCount }], newest first
export function listEnvironmentSnapshots() {
    const dir = snapshotsDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
            try {
                const doc = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
                return {
                    id: doc.id,
                    createdAt: doc.createdAt,
                    message: doc.message || "",
                    packageCount: Object.keys(doc.state?.packages || {}).length
                };
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getEnvironmentSnapshot(id) {
    const file = path.join(snapshotsDir(), `${id}.json`);
    if (!existsSync(file)) {
        throw new DevForgeError(`Unknown environment snapshot '${id}'. Run 'devforgekit env snapshot list'.`);
    }
    return JSON.parse(readFileSync(file, "utf8"));
}

// restoreEnvironmentSnapshot(id) -> the restored state. An automatic
// safety snapshot of the CURRENT state is taken first (same convention
// as workspace rollback), so a restore is itself reversible. The caller
// (index.js's restoreEnvironment) regenerates afterwards.
export function restoreEnvironmentSnapshot(id) {
    const doc = getEnvironmentSnapshot(id);
    const safety = createEnvironmentSnapshot({ message: `auto: before restoring ${id}` });
    saveEnvironmentState(doc.state);
    return { state: loadEnvironmentState(), safetySnapshotId: safety.id };
}
