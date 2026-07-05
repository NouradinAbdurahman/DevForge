// The Context Engine: pure aggregation of what DevForgeKit already knows
// about this machine - no new probes, no new data collection. Every field
// comes from a subsystem that already existed before this module (the
// registry, the compatibility engine, the workspace manager, config) - see
// docs/ContextEngine.md.
import { loadConfig } from "../../config.js";
import { loadPackages } from "../../registry.js";
import { validate } from "../../installer.js";
import { captureShellCommand, commandExists } from "../../shell.js";
import { getActiveWorkspace } from "../../workspace/store.js";
import { scanCompatibility } from "../../compatibility/engine.js";

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
        config: { editor: config.editor, shell: config.shell, packageManager: config.packageManager, aiProvider: config.aiProvider, aiModel: config.aiModel },
        workspace: summarizeWorkspace(workspace),
        git,
        dockerAvailable
    };

    if (full) {
        const installedComponents = await installedComponentNames();
        context.installedComponents = installedComponents;
        context.compatibility = await scanCompatibility(installedComponents);
    }

    return context;
}
