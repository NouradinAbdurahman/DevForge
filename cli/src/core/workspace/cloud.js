// Cloud provider references for a workspace: `workspace.cloud.<provider>`
// is always just a small { ref, region } pointer - a profile/project/
// account *name*, never a secret or credential. Honest scoping, decided
// per provider on what's actually a real, stable, well-documented global
// CLI concept (rather than guessing at one to make every provider look
// equally "supported"):
//   - gcp   - REAL: `gcloud config configurations activate <ref>` is a
//     genuine, persistent, machine-wide switch ("named configurations").
//   - azure - REAL: `az account set --subscription <ref>` is likewise
//     genuine and persistent (~/.azure/azureProfile.json).
//   - aws   - reference-only *switch* (the aws-cli has no global
//     `aws use-profile`), but `AWS_PROFILE` is a real, universally-
//     respected env var - exported by switcher.js via
//     shellIntegration.js, not "switched" here.
//   - firebase/supabase - their CLIs' project selection (`firebase use`,
//     `supabase link`) writes into the *current working directory*
//     (.firebaserc, supabase/.temp/project-ref), not global machine
//     state, so there is nothing for a workspace switch to apply outside
//     a specific project directory.
//   - cloudflare/vercel/netlify - reference-only: no stable, documented
//     global CLI/env-var convention this codebase can honestly claim to
//     apply without guessing.
import { runShellCommand, captureShellCommand, commandExists, shellQuote } from "../shell.js";

// REAL_SWITCH_PROVIDERS - the only providers applyWorkspaceCloud()
// actually invokes a CLI for. Every other provider's `ref`/`region` is
// carried in the document purely for display/health/search (see
// store.js's searchWorkspaces()).
export const REAL_SWITCH_PROVIDERS = ["gcp", "azure"];

// SUPPLEMENTARY_ENV_VARS - real, documented env vars a cloud reference
// can also export (layered on top of the real switch above by
// switcher.js). No entry exists for a provider unless this codebase is
// confident the variable is genuinely respected - AWS_PROFILE by every
// AWS SDK/CLI, GOOGLE_CLOUD_PROJECT as the default-project fallback most
// Google client libraries read.
export const SUPPLEMENTARY_ENV_VARS = { aws: "AWS_PROFILE", gcp: "GOOGLE_CLOUD_PROJECT" };

export function cloudEnvVars(workspace) {
    const cloud = workspace.cloud || {};
    const vars = {};
    for (const [provider, envVar] of Object.entries(SUPPLEMENTARY_ENV_VARS)) {
        const ref = cloud[provider]?.ref;
        if (ref) vars[envVar] = ref;
    }
    return vars;
}

async function listGcloudConfigurations() {
    if (!(await commandExists("gcloud"))) return [];
    const { code, stdout } = await captureShellCommand("gcloud config configurations list --format='value(name)'");
    return code === 0 ? stdout.split("\n").map((l) => l.trim()).filter(Boolean) : [];
}

async function applyGcp(ref, { onOutput } = {}) {
    if (!(await commandExists("gcloud"))) return { provider: "gcp", applied: false, reason: "gcloud is not installed" };
    const configs = await listGcloudConfigurations();
    if (!configs.includes(ref)) {
        return { provider: "gcp", applied: false, reason: `No gcloud configuration named '${ref}' (known: ${configs.join(", ") || "none"})` };
    }
    const code = await runShellCommand(`gcloud config configurations activate ${shellQuote(ref)}`, { onOutput, silent: !onOutput });
    return { provider: "gcp", applied: code === 0, reason: code === 0 ? null : `gcloud exited ${code}` };
}

async function listAzureSubscriptions() {
    if (!(await commandExists("az"))) return [];
    const { code, stdout } = await captureShellCommand('az account list --query "[].{name:name,id:id}" -o json');
    if (code !== 0) return [];
    try {
        return JSON.parse(stdout).flatMap((s) => [s.name, s.id]).filter(Boolean);
    } catch {
        return [];
    }
}

async function applyAzure(ref, { onOutput } = {}) {
    if (!(await commandExists("az"))) return { provider: "azure", applied: false, reason: "az (Azure CLI) is not installed" };
    const known = await listAzureSubscriptions();
    if (!known.includes(ref)) {
        return { provider: "azure", applied: false, reason: `No Azure subscription matching '${ref}' (known: ${known.join(", ") || "none"})` };
    }
    const code = await runShellCommand(`az account set --subscription ${shellQuote(ref)}`, { onOutput, silent: !onOutput });
    return { provider: "azure", applied: code === 0, reason: code === 0 ? null : `az exited ${code}` };
}

// applyWorkspaceCloud(workspace, { onOutput }) -> [{ provider, applied, reason? }, ...]
// Only ever shells out for gcp/azure; every other declared reference is
// reported with applied:false and an explicit "reference-only" reason,
// so callers (health.js, `workspace switch`'s summary) are never
// ambiguous about what did and didn't actually change on the machine.
export async function applyWorkspaceCloud(workspace, { onOutput } = {}) {
    const cloud = workspace.cloud || {};
    const results = [];
    for (const provider of REAL_SWITCH_PROVIDERS) {
        const ref = cloud[provider]?.ref;
        if (!ref) continue;
        results.push(provider === "gcp" ? await applyGcp(ref, { onOutput }) : await applyAzure(ref, { onOutput }));
    }
    for (const [provider, value] of Object.entries(cloud)) {
        if (REAL_SWITCH_PROVIDERS.includes(provider) || !value?.ref) continue;
        results.push({ provider, applied: false, reason: "reference-only - no real global CLI concept to switch" });
    }
    return results;
}
