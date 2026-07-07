// The Context Engine: pure aggregation of what DevForgeKit already knows
// about this machine - no new probes, no new data collection. Every field
// comes from a subsystem that already existed before this module (the
// registry, the compatibility engine, the workspace manager, config) - see
// docs/ContextEngine.md.
import { loadConfig } from "../../config.js";
import { loadPackages, getRegistryStats, loadCategories, loadCollections, loadProfiles, loadRecipes } from "../../registry.js";
import { validate } from "../../installer.js";
import { captureShellCommand, commandExists } from "../../shell.js";
import { getActiveWorkspace } from "../../workspace/store.js";
import { scanCompatibility } from "../../compatibility/engine.js";
import { getPlatform } from "../../platform/index.js";
import { listGenerators } from "../../../generators/index.js";
import { getHistory } from "../memory/history.js";

// platformSummary() - a real, cheap (no I/O) OS/arch fact using the same
// OS Abstraction Layer (core/platform/) the installer/compatibility
// engine already resolve against - never a raw process.platform string,
// so "macos"/"apple-silicon" reads the same way here as everywhere else.
function platformSummary() {
    const platform = getPlatform();
    return { id: platform.id, label: platform.label, architecture: platform.architecture() };
}

// recentActivity() - the last few AI memory events (never chat contents -
// see memory/history.js), so the assistant can answer "what did I just
// do" without re-deriving it from the current conversation alone.
function recentActivity(limit = 5) {
    return getHistory().slice(-limit).map((e) => ({ type: e.type, summary: e.summary, timestamp: e.timestamp }));
}

async function gatherGitStatus(cwd) {
    const { code: isRepoCode } = await captureShellCommand(`git -C "${cwd}" rev-parse --is-inside-work-tree`);
    if (isRepoCode !== 0) return { isRepo: false };

    const [branchResult, statusResult] = await Promise.all([
        captureShellCommand(`git -C "${cwd}" rev-parse --abbrev-ref HEAD`),
        captureShellCommand(`git -C "${cwd}" status --porcelain`)
    ]);
    const changedFiles = statusResult.stdout.split("\n").map((l) => l.trim()).filter(Boolean).length;
    return { isRepo: true, branch: branchResult.stdout.trim(), changedFiles };
}

function summarizeWorkspace(workspace) {
    if (!workspace) return null;
    const lastScan = workspace.compatibility?.scanHistory?.slice(-1)[0] || null;
    return {
        name: workspace.name,
        profile: workspace.profile,
        collections: workspace.collections,
        recipes: workspace.recipes,
        components: workspace.components,
        lastCompatibilityScan: lastScan ? { score: lastScan.score, verdict: lastScan.verdict, timestamp: lastScan.timestamp } : null
    };
}

// installedComponentNames() -> every registry package whose `validate`
// command currently passes - the same technique `profile export`/`stats`
// already use, reused rather than reimplemented.
export async function installedComponentNames() {
    const names = [];
    for (const pkg of loadPackages()) {
        if (!pkg.validate) continue;
        try {
            if ((await validate(pkg)) === 0) names.push(pkg.name);
        } catch {
            // Not installed - not part of the context.
        }
    }
    return names;
}

// gatherContext([{ full, cwd }]) -> a plain object ready to feed into
// prompts/library.js's buildPrompt(). `full: true` (used by `ai doctor`/
// `ai analyze`, which genuinely need it) additionally runs the ~250-probe
// installed-component scan and a compatibility scan - skipped by default
// since most commands (`ai chat`, `ai explain <topic>`) don't need it and
// shouldn't pay for it on every turn.
export async function gatherContext({ full = false, cwd = process.cwd() } = {}) {
    const config = loadConfig();
    const workspace = getActiveWorkspace();
    const [git, dockerAvailable] = await Promise.all([
        gatherGitStatus(cwd),
        commandExists("docker")
    ]);

    const context = {
        cwd,
        platform: platformSummary(),
        config: { editor: config.editor, shell: config.shell, packageManager: config.packageManager, aiProvider: config.aiProvider, aiModel: config.aiModel },
        workspace: summarizeWorkspace(workspace),
        git,
        dockerAvailable,
        availableGeneratorStacks: listGenerators().map((g) => g.id),
        recentActivity: recentActivity()
    };

    // Registry-wide stats need to read every package/collection/profile/
    // recipe YAML file (~261 packages) - real, but not cheap enough to
    // pay on every `ai chat` turn, so it's grouped with the other
    // `full`-only work below rather than the light fields above.
    if (full) {
        const installedComponents = await installedComponentNames();
        context.installedComponents = installedComponents;
        context.compatibility = await scanCompatibility(installedComponents);
        context.registry = getRegistryStats({
            categories: loadCategories(), packages: loadPackages(), collections: loadCollections(),
            profiles: loadProfiles(), recipes: loadRecipes()
        });
    }

    return context;
}
