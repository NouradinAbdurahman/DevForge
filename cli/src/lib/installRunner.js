// Shared UI wrapper around core/installer.js's installPlan: prints the
// resolved dependency order, drives a progress bar while installing, and
// reports a final PASS/skip/FAIL summary. Used by both the `component
// install` and `collection install` commands so neither duplicates this
// loop - see docs/PlatformArchitecture.md's dependency-graph section.
import { resolveInstallOrder, installPlan } from "../core/installer.js";
import { formatInstallFailure } from "../core/installAudit.js";
import { getPackage } from "../core/registry.js";
import { createProgressBar, updateProgressBar } from "./progress.js";
import { section, formatDuration } from "./ui.js";
import { logger } from "../core/logger.js";
import chalk from "chalk";

export async function runInstallPlan(names, { variants = {} } = {}) {
    const plan = resolveInstallOrder(names);

    logger.section("Install plan");
    console.log(`  ${plan.map((p) => p.name).join(" → ")}`);
    console.log(`  ${plan.length} package${plan.length === 1 ? "" : "s"}`);

    const started = Date.now();
    const bar = createProgressBar(plan.length, "Installing");
    const { results } = await installPlan(names, {
        variants,
        onStep: (pkg, index) => updateProgressBar(bar, index, { item: pkg.name })
    });
    updateProgressBar(bar, plan.length, { item: "done" });
    bar.stop();
    const totalElapsed = Date.now() - started;

    let failed = 0;
    let skipped = 0;
    const failures = [];
    for (const r of results) {
        if (r.status === "installed") continue;
        if (r.status === "skipped") skipped++;
        else {
            failed++;
            failures.push(r);
        }
    }
    const installed = results.length - failed - skipped;

    for (const r of results) {
        if (r.status === "installed") logger.success(`${r.name} installed in ${formatDuration(r.durationMs)}`);
        else if (r.status === "skipped") logger.info(`${r.name} already satisfied - skipped`);
    }

    const summary = [
        chalk.green(`✓ ${installed} installed`),
        skipped > 0 ? chalk.dim(`○ ${skipped} already satisfied`) : null,
        failed > 0 ? chalk.red(`✗ ${failed} failed`) : null,
        `in ${formatDuration(totalElapsed)}`
    ].filter(Boolean).join("  ·  ");

    console.log("");
    console.log(section(failed === 0 ? "Install complete" : "Install finished with errors", [summary]));

    for (const r of failures) {
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
    }

    if (failed > 0) {
        logger.info("Next: devforgekit repair run to retry failed installs, or devforgekit doctor to check overall health.");
    } else {
        logger.info("Next: devforgekit doctor to verify your environment, or devforgekit component info <name> for details.");
    }

    return { plan, results, failed };
}
