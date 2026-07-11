// Runs the existing scripts/doctor.sh unchanged (including --fix), then
// layers in native component-registry validation/repair checks (see
// docs/PlatformArchitecture.md section 9).
import { writeFileSync } from "node:fs";
import { runScript } from "../core/shell.js";
import { loadPackages, getPackage } from "../core/registry.js";
import { validate as validateComponent, repair as repairComponent } from "../core/installer.js";
import { mapWithConcurrency } from "../core/concurrency.js";
import { scoreResults } from "../core/health.js";
import { scanCompatibility } from "../core/compatibility/engine.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";

// exportDoctorMarkdown(...) -> a Markdown report of the native component
// diagnostics + compatibility scan (the bash-side scripts/doctor.sh text
// output isn't structured data, so it's skipped for export the same way
// --json already skips it - the exported report reflects the same
// native checks --json emits, just rendered as Markdown instead of JSON).
function exportDoctorMarkdown({ results, score, verdict, compatibility }) {
    const lines = [
        `# DevForgeKit Doctor Report`,
        ``,
        `**Date:** ${new Date().toISOString()}`,
        `**Component Health:** ${score}% - ${verdict}`,
        ``,
        `## Component Diagnostics`,
        ``,
        `| Status | Component |`,
        `|--------|-----------|`
    ];
    for (const r of results) {
        lines.push(`| ${r.status} | ${r.description} |`);
    }

    if (compatibility) {
        lines.push(``, `## Compatibility`, ``, `**Score:** ${compatibility.score}% - ${compatibility.verdict}`, ``);
        const relevant = compatibility.issues.filter((i) => i.severity !== "PASS" && i.severity !== "RECOMMEND");
        if (relevant.length > 0) {
            lines.push(`| Severity | Tool | Message |`, `|----------|------|---------|`);
            for (const issue of relevant) {
                lines.push(`| ${issue.severity} | ${issue.tool} | ${issue.message}${issue.recommendation ? ` (${issue.recommendation})` : ""} |`);
            }
        } else {
            lines.push(`No compatibility issues found.`);
        }
    }

    return `${lines.join("\n")}\n`;
}

// runComponentDiagnostics(fix) -> { results, installedNames }. One
// bounded-concurrency pass (mapWithConcurrency, same worker pool
// componentManager.js's getAllComponentStatuses uses) instead of a plain
// sequential for-await over all 261 packages - measured at ~52s
// sequential on a full registry, since every package validates via at
// least one real child-process spawn. installedNames is derived from
// this same pass (a PASS/repaired-PASS result IS "installed") rather
// than a second full validate() sweep, which used to double the work for
// no reason - the compatibility scan only ever needs the name list.
async function runComponentDiagnostics(fix) {
    const packages = loadPackages().filter((pkg) => pkg.validate);
    const installedNames = [];
    const results = await mapWithConcurrency(packages, 8, async (pkg) => {
        let code;
        try {
            code = await validateComponent(getPackage(pkg.name));
        } catch {
            return { status: "WARNING", description: `Component check: ${pkg.name} (could not run)` };
        }

        if (code === 0) {
            installedNames.push(pkg.name);
            return { status: "PASS", description: `Component check: ${pkg.name}` };
        }

        if (fix && pkg.repair) {
            logger.step(`Attempting repair: ${pkg.name}`);
            await repairComponent(getPackage(pkg.name));
            const recheck = await validateComponent(getPackage(pkg.name));
            if (recheck === 0) installedNames.push(pkg.name);
            return {
                status: recheck === 0 ? "PASS" : "WARNING",
                description: `Component check: ${pkg.name}${recheck === 0 ? " (repaired)" : " (repair attempted, still failing)"}`
            };
        }

        return { status: "WARNING", description: `Component check: ${pkg.name}` };
    });
    return { results, installedNames };
}

export function registerDoctorCommand(program) {
    program
        .command("doctor [args...]")
        .description("Deep diagnostics + health score (forwards flags like --fix to scripts/doctor.sh)")
        .allowUnknownOption(true)
        .option("--json", "emit the native component-check results as JSON instead of text")
        .option("--skip-bash", "skip scripts/doctor.sh and only run native component checks")
        .option("--skip-compatibility", "skip the compatibility scan over installed components")
        .option("--export <format>", "export the native diagnostics report as markdown instead of printing (implies --skip-bash)")
        .option("-o, --output <file>", "write the export to a file (default: stdout)")
        .action(withErrorHandling(async function (args) {
            const opts = this.opts();
            const fix = args.includes("--fix");

            if (opts.export && opts.export !== "markdown") {
                throw usageError(`Unknown export format '${opts.export}'. Available: markdown`);
            }

            let bashCode = 0;
            if (!opts.skipBash && !opts.json && !opts.export) {
                bashCode = await runScript("scripts/doctor.sh", args);
            }

            const { results, installedNames } = await runComponentDiagnostics(fix);
            const { score, verdict, ...tally } = scoreResults(results);

            let compatibility = null;
            if (!opts.skipCompatibility) {
                compatibility = await scanCompatibility(installedNames);
            }

            if (opts.export) {
                const content = exportDoctorMarkdown({ results, score, verdict, compatibility });
                if (opts.output) {
                    writeFileSync(opts.output, content);
                    logger.success(`Exported to ${opts.output}`);
                } else {
                    console.log(content);
                }
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify({ results, ...tally, score, verdict, compatibility }, null, 2));
            } else {
                logger.section("Component diagnostics");
                for (const r of results) {
                    if (r.status === "PASS") logger.success(r.description);
                    else logger.warn(r.description);
                }
                logger.info(`Component health score: ${score}% - ${verdict}`);

                if (compatibility) {
                    logger.section("Compatibility diagnostics");
                    for (const issue of compatibility.issues) {
                        if (issue.severity === "PASS" || issue.severity === "RECOMMEND") continue;
                        const line = `[${issue.severity}] ${issue.tool}: ${issue.message}${issue.recommendation ? ` (${issue.recommendation})` : ""}`;
                        if (issue.severity === "WARNING") logger.warn(line);
                        else logger.error(line);
                    }
                    logger.info(`Compatibility score: ${compatibility.score}% - ${compatibility.verdict}`);
                }
            }

            const compatibilityFailed = compatibility && (compatibility.critical > 0 || compatibility.unsupported > 0);
            process.exitCode = bashCode !== 0 ? bashCode : (compatibilityFailed ? 1 : 0);
        }));
}
