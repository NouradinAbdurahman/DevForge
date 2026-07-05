// Orchestrates a workspace switch across every subsystem, and a
// snapshot-based rollback on top of it. Each subsystem's apply*()
// already reports success/failure per-item instead of throwing (see
// git.js/ssh.js/docker.js/kubernetes.js/cloud.js) - switchToWorkspace()
// preserves that "never hard-fail over one broken subsystem" policy:
// every subsystem is attempted and its result recorded, and the active
// pointer only moves once every attempt has finished, so a missing
// `docker`/`kubectl`/cloud CLI on this machine never leaves the pointer
// in a half-switched state. Deactivating (switching to "no workspace")
// deliberately leaves git/ssh/docker/k8s/cloud state exactly as they
// were - there is no meaningful single "no workspace" identity for a
// global git/docker/kubectl config to revert to (the same reasoning
// git.js's additive-only aliases already documents); only the generated
// shell-export file and the active pointer are cleared.
import { getWorkspace, setActiveWorkspaceName, getActiveWorkspaceName } from "./store.js";
import { applyWorkspaceGit } from "./git.js";
import { applyWorkspaceSsh } from "./ssh.js";
import { applyWorkspaceDocker } from "./docker.js";
import { applyWorkspaceKubernetes } from "./kubernetes.js";
import { applyWorkspaceCloud, cloudEnvVars } from "./cloud.js";
import { getAllSecrets, writeWorkspaceEnvFile } from "./env.js";
import { applyWorkspaceShell, clearWorkspaceShell } from "./shellIntegration.js";
import { createSnapshot, restoreSnapshot } from "./snapshot.js";

// switchToWorkspace(name, { onOutput }) -> { workspace, subsystems }
// Order: identity (git/ssh) -> infrastructure contexts (docker/k8s/cloud)
// -> env/shell last, since the generated shell export layers cloud's
// supplementary env vars (AWS_PROFILE/GOOGLE_CLOUD_PROJECT) and env.js's
// decrypted secrets on top of everything else.
export async function switchToWorkspace(name, { onOutput } = {}) {
    const workspace = getWorkspace(name);

    const subsystems = {};
    subsystems.git = await applyWorkspaceGit(workspace, { onOutput });
    subsystems.ssh = await applyWorkspaceSsh(workspace, { onOutput });
    subsystems.docker = await applyWorkspaceDocker(workspace, { onOutput });
    subsystems.kubernetes = await applyWorkspaceKubernetes(workspace, { onOutput });
    subsystems.cloud = await applyWorkspaceCloud(workspace, { onOutput });

    const resolvedEnv = { ...cloudEnvVars(workspace), ...getAllSecrets(workspace) };
    subsystems.shell = { file: applyWorkspaceShell(workspace, { resolvedEnv }) };
    subsystems.env = { file: writeWorkspaceEnvFile(workspace) };

    setActiveWorkspaceName(name);
    return { workspace, subsystems };
}

// deactivateWorkspace() - clears the active pointer and the generated
// shell-export file only (see module doc comment for why nothing else
// is touched).
export function deactivateWorkspace() {
    clearWorkspaceShell();
    setActiveWorkspaceName(null);
}

// rollbackToSnapshot(name, snapshotId, { onOutput }) -> { workspace, applied, subsystems? }
// Always takes a safety snapshot of the *current* state first (a
// rollback replaces almost the entire document, unlike repairWorkspace()'s
// narrow removal of dangling references, so undoing a rollback-to-the-
// wrong-snapshot needs its own snapshot to undo *to*). Only re-applies
// live subsystem state if `name` is the currently active workspace -
// rolling back an inactive workspace's stored document has nothing live
// to re-apply until it's switched to.
export async function rollbackToSnapshot(name, snapshotId, { onOutput } = {}) {
    createSnapshot(name, { message: `Auto-snapshot before rolling back to ${snapshotId}` });
    const workspace = restoreSnapshot(name, snapshotId);

    if (getActiveWorkspaceName() !== name) {
        return { workspace, applied: false };
    }
    const { subsystems } = await switchToWorkspace(name, { onOutput });
    return { workspace, applied: true, subsystems };
}
