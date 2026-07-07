// The AI Health Score (AI Assistant Excellence, v2.1.3 Phase 12) - the
// Manifest/Generator Quality Score's sibling for the AI Assistant: a
// single percentage plus a transparent per-check breakdown, replacing
// "is it configured, yes/no" with "how healthy is the whole pipeline."
// Every check reflects a real, distinct signal already computed
// elsewhere in this codebase (validateAIConfig, the credential manager,
// the context engine, the local memory store) - none invented here.
//
// "Connection" needs a real network call, which this module never makes
// on its own - same opt-in pattern core/quality.js's
// checkLiveReachability() uses for homepage/repository checks. Pass an
// already-run `provider.checkHealth()` result via `connectionResult` if
// you have one (e.g. AIOverviewPage already runs one on mount); omitted,
// "Connection" is left out of the score entirely rather than faked as a
// pass or a fail.
import { existsSync, accessSync, constants } from "node:fs";
import path from "node:path";
import { userConfigDir } from "../paths.js";
import { validateAIConfig } from "./validation.js";
import { gatherContext } from "./context/gather.js";
import { getProvider } from "./providers/index.js";

// checkMemoryWritable() - the local AI memory store (history.json/
// stats.json under ~/.config/devforgekit/ai/) is distinct from
// "Configuration" (the credential backend) - this checks the directory
// DevForgeKit's own event log writes to is actually usable. A directory
// that doesn't exist yet isn't broken (it's created on first write), so
// that's a pass, not a fail.
function checkMemoryWritable() {
    try {
        const dir = path.join(userConfigDir(), "ai");
        if (!existsSync(dir)) return true;
        accessSync(dir, constants.R_OK | constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

// checkContextGatherable() - the context engine (gatherContext) degrades
// gracefully field-by-field (a non-git cwd just gets `git: {isRepo:
// false}`), but this confirms the aggregation itself doesn't throw -
// distinct from every config-level check above it.
async function checkContextGatherable() {
    try {
        await gatherContext({ full: false });
        return true;
    } catch {
        return false;
    }
}

// scoreAIHealth({ connectionResult }) -> { score, checks, passCount,
// total, recommendationsCount }. Async - Context and Streaming checks
// need it (gatherContext awaits git probes; getProvider is sync but kept
// inside the same try/catch shape as the rest for consistency).
export async function scoreAIHealth({ connectionResult = null } = {}) {
    const validation = validateAIConfig();
    const cfg = validation.config;

    const checks = [
        { label: "Provider", pass: Boolean(cfg.provider) },
        { label: "Credential", pass: Boolean(cfg.keyAvailable) },
        { label: "Model", pass: !validation.issues.some((i) => i.field === "model") },
        { label: "Configuration", pass: Boolean(cfg.backendOk) },
        { label: "Memory", pass: checkMemoryWritable() },
        { label: "Context", pass: await checkContextGatherable() },
        { label: "Diagnostics", pass: validation.issues.length === 0 }
    ];

    if (cfg.provider) {
        try {
            const provider = getProvider(cfg.provider, {});
            checks.push({ label: "Streaming", pass: Boolean(provider.supportsStreaming) });
        } catch {
            checks.push({ label: "Streaming", pass: false });
        }
    }

    if (connectionResult) {
        checks.push({ label: "Connection", pass: Boolean(connectionResult.ok) });
    }

    const passCount = checks.filter((c) => c.pass).length;
    const score = Math.round((passCount / checks.length) * 100);

    return { score, checks, passCount, total: checks.length, recommendationsCount: validation.recommendations.length };
}
