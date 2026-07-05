// Shared UI wrapper around core/installer.js's installPlan: prints the
// resolved dependency order, drives a progress bar while installing, and
// reports a final PASS/skip/FAIL summary. Used by both the `component
// install` and `collection install` commands so neither duplicates this
// loop - see docs/PlatformArchitecture.md's dependency-graph section.
import { resolveInstallOrder, installPlan } from "../core/installer.js";
import { formatInstallFailure } from "../core/installAudit.js";
import { getPackage } from "../core/registry.js";
import { createProgressBar } from "./progress.js";
import { logger } from "../core/logger.js";

function formatDuration(ms) {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export async function runInstallPlan(names, { variants = {} } = {}) {
    const plan = resolveInstallOrder(names);

    logger.section("Install plan");
    console.log(`  ${plan.map((p) => p.name).join(" -> ")}`);

    const bar = createProgressBar(plan.length, "Installing");
    const { results } = await installPlan(names, {
        variants,
        onStep: (pkg, index) => bar.update(index, { item: pkg.name })
    });
    bar.update(plan.length, { item: "done" });
    bar.stop();

    logger.section("Install results");
    let failed = 0;
    for (const r of results) {
        if (r.status === "installed") logger.success(`${r.name} installed in ${formatDuration(r.durationMs)}`);
        else if (r.status === "skipped") logger.info(`${r.name} already satisfied - skipped`);
        else {
            // Rich failure output instead of generic "failed"
            const pkg = getPackage(r.name);
            const fakeResult = {
                command: pkg.install ? `install ${r.name}` : r.name,
                stderr: r.stderr || "",
                exitCode: r.code,
                timedOut: false
            };
            console.log();
            console.log(formatInstallFailure(fakeResult, pkg, resolveInstallOrder([r.name])));
            console.log();
            failed++;
        }
    }

    return { plan, results, failed };
}
