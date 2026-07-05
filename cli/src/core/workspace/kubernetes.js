// Kubernetes context switching for workspaces. `kubectl config
// use-context <name>` and `kubectl config set-context --current
// --namespace=<ns>` are both genuine, persistent, machine-wide switches
// (stored in ~/.kube/config's `current-context`/that context's
// `namespace`) - the same "real global CLI concept" bar docker.js
// applies. `clusters` is reference-only: a context change already
// implies a specific cluster, so this field exists purely for
// display/search (e.g. `workspace search` matching a cluster name), not
// as something separately "applied."
import { runShellCommand, captureShellCommand, commandExists, shellQuote } from "../shell.js";

export async function listKubeContexts() {
    if (!(await commandExists("kubectl"))) return [];
    const { code, stdout } = await captureShellCommand("kubectl config get-contexts -o name");
    return code === 0 ? stdout.split("\n").map((l) => l.trim()).filter(Boolean) : [];
}

// captureKubeContext() -> the live current-context name, or null.
export async function captureKubeContext() {
    if (!(await commandExists("kubectl"))) return null;
    const { code, stdout } = await captureShellCommand("kubectl config current-context");
    return code === 0 ? stdout.trim() : null;
}

// applyWorkspaceKubernetes(workspace, { onOutput }) -> { applied, namespaceApplied?, reason? }
// Same no-hard-fail policy as docker.js: a missing kubectl or unknown
// context is reported, never thrown.
export async function applyWorkspaceKubernetes(workspace, { onOutput } = {}) {
    const k8s = workspace.kubernetes || {};
    if (!k8s.context) return { applied: false, reason: "No kubernetes context declared for this workspace" };
    if (!(await commandExists("kubectl"))) return { applied: false, reason: "kubectl is not installed" };

    const contexts = await listKubeContexts();
    if (!contexts.includes(k8s.context)) {
        return { applied: false, reason: `Kubernetes context '${k8s.context}' does not exist locally (known: ${contexts.join(", ") || "none"})` };
    }
    const code = await runShellCommand(`kubectl config use-context ${shellQuote(k8s.context)}`, { onOutput, silent: !onOutput });
    if (code !== 0) return { applied: false, reason: `'kubectl config use-context' exited ${code}` };

    if (!k8s.namespace) return { applied: true, namespaceApplied: false };

    const nsCode = await runShellCommand(`kubectl config set-context --current --namespace=${shellQuote(k8s.namespace)}`, { onOutput, silent: !onOutput });
    return { applied: true, namespaceApplied: nsCode === 0, reason: nsCode === 0 ? null : `namespace set exited ${nsCode}` };
}

export function describeKubernetesReferences(workspace) {
    return { clusters: (workspace.kubernetes || {}).clusters || [] };
}
