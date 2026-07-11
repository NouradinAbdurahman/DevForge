// Environment diff: what changed between a snapshot and now - packages
// tracked/untracked, observed version changes, and the generated
// PATH/variable deltas. Both sides' models are built against the
// CURRENT registry (same reasoning as snapshot restore - see
// snapshot.js), so the diff shows what tracking changes did, never
// phantom differences from manifest edits in between.
import { getEnvironmentSnapshot, listEnvironmentSnapshots } from "./snapshot.js";
import { loadEnvironmentState, trackedNames } from "./state.js";
import { buildEnvironmentModel } from "./model.js";
import { diffModels } from "./changelog.js";
import { DevForgeError } from "../errors.js";

// diffEnvironment({ snapshotId }) -> {
//   snapshotId, snapshotCreatedAt,
//   packagesAdded, packagesRemoved,
//   versionChanges: [{ name, from, to }],
//   model: diffModels() change set (or null when identical)
// }
// Defaults to the most recent snapshot when no id is given.
export function diffEnvironment({ snapshotId } = {}) {
    let id = snapshotId;
    if (!id) {
        const snapshots = listEnvironmentSnapshots();
        if (snapshots.length === 0) {
            throw new DevForgeError("No environment snapshots to diff against - create one with 'devforgekit env snapshot'.");
        }
        id = snapshots[0].id;
    }

    const snapshot = getEnvironmentSnapshot(id);
    const current = loadEnvironmentState();

    const beforeNames = trackedNames(snapshot.state);
    const afterNames = trackedNames(current);

    const versionChanges = [];
    for (const name of afterNames) {
        if (!beforeNames.includes(name)) continue;
        const from = snapshot.state.packages[name]?.version || null;
        const to = current.packages[name]?.version || null;
        if (from !== to) versionChanges.push({ name, from, to });
    }

    return {
        snapshotId: id,
        snapshotCreatedAt: snapshot.createdAt,
        packagesAdded: afterNames.filter((n) => !beforeNames.includes(n)),
        packagesRemoved: beforeNames.filter((n) => !afterNames.includes(n)),
        versionChanges,
        model: diffModels(buildEnvironmentModel(snapshot.state), buildEnvironmentModel(current))
    };
}
