// Docker context switching for workspaces. `docker context use <name>`
// is a genuine, persistent, machine-wide switch (stored in
// ~/.docker/config.json's `currentContext`) - the exact "single global
// CLI concept" this platform's honest-scoping rule requires before
// calling something "real" (contrast cloud.js, where most providers
// don't have one). `composeFiles`/`networks`/`volumes` are deliberately
// reference-only: actually applying a compose file means running
// containers (`docker compose up`), a heavy, side-effect-laden operation
// completely different in kind from "switch which context is active" -
// a workspace switch must stay fast and non-destructive, so these stay
// informational (surfaced by health.js/`workspace show`, never
// auto-run).
import { runShellCommand, captureShellCommand, commandExists, shellQuote } from "../shell.js";

export async function listDockerContexts() {
    if (!(await commandExists("docker"))) return [];
    const { code, stdout } = await captureShellCommand("docker context ls --format '{{.Name}}'");
    return code === 0 ? stdout.split("\n").map((l) => l.trim()).filter(Boolean) : [];
}

// captureDockerContext() -> the live, currently-active docker context
// name, or null if docker isn't installed/configured. Mirrors git.js's
// capture pattern - useful for `workspace create --from-current`.
export async function captureDockerContext() {
    if (!(await commandExists("docker"))) return null;
    const { code, stdout } = await captureShellCommand("docker context show");
    return code === 0 ? stdout.trim() : null;
}

// applyWorkspaceDocker(workspace, { onOutput }) -> { applied, reason? }
// A no-op (applied: false, with a clear reason) rather than a thrown
// error when docker isn't installed or the named context doesn't exist
// locally - a workspace switch should never hard-fail over one
// subsystem's tool being absent (matching switcher.js's per-subsystem
// isolation).
export async function applyWorkspaceDocker(workspace, { onOutput } = {}) {
    const docker = workspace.docker || {};
    if (!docker.context) return { applied: false, reason: "No docker context declared for this workspace" };
    if (!(await commandExists("docker"))) return { applied: false, reason: "docker is not installed" };

    const contexts = await listDockerContexts();
    if (!contexts.includes(docker.context)) {
        return { applied: false, reason: `Docker context '${docker.context}' does not exist locally (known: ${contexts.join(", ") || "none"})` };
    }
    const code = await runShellCommand(`docker context use ${shellQuote(docker.context)}`, { onOutput, silent: !onOutput });
    return { applied: code === 0, reason: code === 0 ? null : `'docker context use' exited ${code}` };
}
