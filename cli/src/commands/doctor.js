// Runs the existing scripts/doctor.sh unchanged (including --fix), then
// layers in native component-registry validation/repair checks (see
// docs/PlatformArchitecture.md section 9).
import { runScript } from "../core/shell.js";
import { loadPackages, getPackage } from "../core/registry.js";
import { validate as validateComponent, repair as repairComponent } from "../core/installer.js";
import { scoreResults } from "../core/health.js";
import { scanCompatibility } from "../core/compatibility/engine.js";
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";

async function installedComponentNames() {
    const names = [];
    for (const pkg of loadPackages()) {
        if (!pkg.validate) continue;
        try {
            if ((await validateComponent(pkg)) === 0) names.push(pkg.name);
        } catch {
            // Not installed - not part of the compatibility scan.
        }
    }
    return names;
}

async function runComponentDiagnostics(fix) {
    const results = [];
    for (const pkg of loadPackages()) {
        if (!pkg.validate) continue;
        let code;
        try {
            code = await validateComponent(getPackage(pkg.name));
        } catch {
            results.push({ status: "WARNING", description: `Component check: ${pkg.name} (could not run)` });
            continue;
        }

        if (code === 0) {
            results.push({ status: "PASS", description: `Component check: ${pkg.name}` });
            continue;
        }

        if (fix && pkg.repair) {
            logger.step(`Attempting repair: ${pkg.name}`);
            await repairComponent(getPackage(pkg.name));
            const recheck = await validateComponent(getPackage(pkg.name));
            results.push({
                status: recheck === 0 ? "PASS" : "WARNING",
                description: `Component check: ${pkg.name}${recheck === 0 ? " (repaired)" : " (repair attempted, still failing)"}`
            });
        } else {
            results.push({ status: "WARNING", description: `Component check: ${pkg.name}` });
        }
    }
    return results;
}

export function registerDoctorCommand(program) {
    program
        .command("doctor [args...]")
        .description("Deep diagnostics + health score (forwards flags like --fix to scripts/doctor.sh)")
        .allowUnknownOption(true)
        .option("--json", "emit the native component-check results as JSON instead of text")
        .option("--skip-bash", "skip scripts/doctor.sh and only run native component checks")
        .option("--skip-compatibility", "skip the compatibility scan over installed components")
        .action(withErrorHandling(async function (args) {
            const opts = this.opts();
            const fix = args.includes("--fix");
            let bashCode = 0;
            if (!opts.skipBash && !opts.json) {
                bashCode = await runScript("scripts/doctor.sh", args);
            }

            const results = await runComponentDiagnostics(fix);
            const { score, verdict, ...tally } = scoreResults(results);

            let compatibility = null;
            if (!opts.skipCompatibility) {
                const names = await installedComponentNames();
                compatibility = await scanCompatibility(names);
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
