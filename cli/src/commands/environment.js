// The Environment Configuration Engine's command surface (core/environment/
// - see docs/EnvironmentEngine.md). Every subcommand is a thin wrapper;
// all real logic lives in core/environment/*.js, the same "commands
// depend on core" split every other subsystem in this CLI follows.
import { writeFileSync } from "node:fs";
import { getPlatform } from "../core/platform/index.js";
import {
    getEnvironmentReport,
    regenerateEnvironment,
    reloadGuidance,
    describeTrackedPackages,
    createEnvironmentSnapshot,
    listEnvironmentSnapshots,
    restoreEnvironment,
    diffEnvironment,
    renderEnvironmentTree,
    dependentsOf,
    detectRunningEditors,
    editorReloadGuidance,
    listTransactionDays,
    readTransactions,
    shellCapabilities,
    trackedNames,
    SUPPORTED_SHELLS
} from "../core/environment/index.js";
import { startEnvironmentWatch } from "../core/environment/watch.js";
import { loadEnvironmentState } from "../core/environment/state.js";
import { scoreResults } from "../core/health.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";
import { section, healthBar } from "../lib/ui.js";
import chalk from "chalk";

function resultMark(status) {
    if (status === "PASS") return chalk.green("✓");
    if (status === "WARNING") return chalk.yellow("!");
    return chalk.red("✗");
}

function resolveShellOption(shell) {
    if (shell && !SUPPORTED_SHELLS.includes(shell)) {
        throw usageError(`Unsupported shell '${shell}' - supported: ${SUPPORTED_SHELLS.join(", ")}`);
    }
    return shell || getPlatform().defaultShell();
}

// perPackageHealth(results) -> [{ name, score, reasons }] from the
// validator's package-tagged results - core/health.js's exact formula,
// applied per package, so "Docker 65% - daemon stopped" style summaries
// come from the same checks the main score already counted.
function perPackageHealth(results) {
    const byPackage = new Map();
    for (const result of results) {
        if (!result.package) continue;
        if (!byPackage.has(result.package)) byPackage.set(result.package, []);
        byPackage.get(result.package).push(result);
    }
    return [...byPackage.entries()]
        .map(([name, packageResults]) => ({
            name,
            score: scoreResults(packageResults).score,
            reasons: packageResults.filter((r) => r.status !== "PASS").map((r) => r.message.split("\n")[0].replace(/:$/, ""))
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

// reportGeneration({ state, model, files }) - the shared output for
// regenerate/restore: what was written, any manual edit that was backed
// up rather than silently destroyed, honest reload guidance (a CLI
// cannot mutate its parent shell), and - when a supported editor is
// running - the same honesty about its integrated terminals.
async function reportGeneration({ state, model, files }) {
    if (Object.keys(state.packages).length === 0) {
        logger.info("No packages have registered environment configuration yet - nothing to generate.");
        return;
    }
    for (const { shell, file, rcFile, manualEditBackup } of files) {
        logger.success(`Generated ${file} (${shell}), hook installed in ${rcFile}`);
        if (manualEditBackup) {
            logger.warn(`Manual edits detected in the managed ${shell} configuration - your version was preserved at ${manualEditBackup} before regenerating`);
        }
    }
    const guidance = reloadGuidance(model);
    if (guidance) logger.info(guidance.message);
    const editors = await detectRunningEditors();
    const editorGuidance = editorReloadGuidance(editors);
    if (editorGuidance) logger.info(editorGuidance);
}

// exportEnvironmentDoctorMarkdown(...) - the same report runDoctor()
// renders to the terminal, as Markdown. Mirrors commands/doctor.js's
// exportDoctorMarkdown() shape (report title, health line, then a
// per-check table) so every doctor-style export reads the same way.
function exportEnvironmentDoctorMarkdown({ score, results, packageHealth }) {
    const lines = [
        `# DevForgeKit Environment Doctor Report`,
        ``,
        `**Date:** ${new Date().toISOString()}`,
        `**Environment Health:** ${score.score}% - ${score.verdict}`,
        ``,
        `## Checks`,
        ``,
        `| Status | Check |`,
        `|--------|-------|`
    ];
    for (const result of results) {
        lines.push(`| ${result.status} | ${result.message.split("\n")[0].replace(/:$/, "")} |`);
    }

    if (packageHealth.length > 0) {
        lines.push(``, `## Package Health`, ``, `| Package | Score | Detail |`, `|---------|-------|--------|`);
        for (const pkg of packageHealth) {
            const detail = pkg.score === 100 ? "-" : (pkg.reasons[0] || "see checks above");
            lines.push(`| ${pkg.name} | ${pkg.score}% | ${detail} |`);
        }
    }

    return `${lines.join("\n")}\n`;
}

async function runDoctor({ shell, json, exportFormat, output }) {
    const resolvedShell = resolveShellOption(shell);
    const report = await getEnvironmentReport({ shell: resolvedShell });
    const score = scoreResults(report.results);
    const packageHealth = perPackageHealth(report.results);

    if (exportFormat) {
        if (exportFormat !== "markdown") {
            throw usageError(`Unknown export format '${exportFormat}'. Available: markdown`);
        }
        const content = exportEnvironmentDoctorMarkdown({ score, results: report.results, packageHealth });
        if (output) {
            writeFileSync(output, content);
            logger.success(`Exported to ${output}`);
        } else {
            console.log(content);
        }
        return;
    }

    if (json) {
        console.log(JSON.stringify({ ...report, score, packageHealth }, null, 2));
        return;
    }

    if (Object.keys(report.state.packages).length === 0) {
        logger.info("No packages have registered environment configuration yet.");
        logger.info("Packages are tracked automatically as they're installed (devforgekit component install / collection install / profile install / recipe install), or in bulk via 'devforgekit env regenerate' after a bootstrap.");
        return;
    }

    const lines = [healthBar(score.score), ""];
    for (const result of report.results) {
        lines.push(`${resultMark(result.status)} ${result.message.split("\n")[0].replace(/:$/, "")}`);
    }
    console.log(section(`Environment Health — ${score.verdict}`, lines));

    if (packageHealth.length > 0) {
        console.log(`\n${chalk.bold("Package health")}`);
        for (const pkg of packageHealth) {
            const mark = pkg.score === 100 ? chalk.green("✓") : chalk.yellow("!");
            const detail = pkg.score === 100 ? "" : ` - ${pkg.reasons[0] || "see warnings above"}`;
            console.log(`  ${mark} ${pkg.name}: ${pkg.score}%${detail}`);
        }
    }

    const actions = report.results
        .filter((r) => r.status !== "PASS")
        .map((r) => {
            const repairMatch = r.message.match(/devforgekit [a-z-]+ [a-z-]+(?: [a-z0-9-]+)?/);
            return repairMatch ? repairMatch[0] : null;
        })
        .filter(Boolean);
    const uniqueActions = [...new Set(actions)];
    if (uniqueActions.length > 0) {
        console.log(`\n${chalk.bold("Suggested actions")}`);
        for (const action of uniqueActions) console.log(`  ${chalk.cyan("→")} ${action}`);
    }
}

function addShellAndJsonOptions(cmd) {
    return cmd
        .option("--shell <shell>", `shell to check against (${SUPPORTED_SHELLS.join("/")})`)
        .option("--json", "output as JSON");
}

export function registerEnvironmentCommand(program) {
    const env = program
        .command("env")
        .description("Environment Configuration Engine - PATH/variables/shell hooks generated from package metadata, never hand-edited")
        .addHelpText("after", `
Examples:
  $ devforgekit env doctor              Health breakdown, conflicts, suggested fixes
  $ devforgekit env regenerate          Rewrite shell files from tracked package metadata
  $ devforgekit env graph               Dependency tree for tracked packages
  $ devforgekit env diff                Compare current environment to the last snapshot
  $ devforgekit env snapshot            Capture the current environment state

Learn more: docs/EnvironmentEngine.md`);

    addShellAndJsonOptions(env
        .command("doctor")
        .description("Validate the generated environment against the real filesystem/shell state")
        .option("--export <format>", "export the report as markdown instead of printing")
        .option("-o, --output <file>", "write the export to a file (default: stdout)"))
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            await runDoctor({ shell: opts.shell, json: opts.json, exportFormat: opts.export, output: opts.output });
        }));

    addShellAndJsonOptions(env
        .command("validate")
        .description("Alias for 'env doctor' - validate the current state without regenerating anything")
        .option("--export <format>", "export the report as markdown instead of printing")
        .option("-o, --output <file>", "write the export to a file (default: stdout)"))
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            await runDoctor({ shell: opts.shell, json: opts.json, exportFormat: opts.export, output: opts.output });
        }));

    env
        .command("list")
        .description("List tracked packages (version/provider/verified) and the merged PATH/variables/shell lines")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const { state, model } = await getEnvironmentReport({ verify: false });
            const tracked = describeTrackedPackages(state);

            if (opts.json) {
                console.log(JSON.stringify({ packages: tracked, model }, null, 2));
                return;
            }

            if (tracked.length === 0) {
                logger.info("No packages have registered environment configuration yet.");
                return;
            }

            console.log(`Packages (${tracked.length}):`);
            for (const pkg of tracked) {
                const version = pkg.version ? ` ${pkg.version}` : "";
                const provider = pkg.provider ? ` (${pkg.provider})` : "";
                const mark = pkg.verified ? "✓" : "?";
                const location = pkg.location ? ` - ${pkg.location}` : "";
                console.log(`  ${mark} ${pkg.name}${version}${provider}${location}`);
            }
            if (model.path.length > 0) {
                console.log("\nPATH additions (canonical order):");
                for (const entry of model.path) {
                    const owners = model.pathOwners[entry]?.join(", ");
                    console.log(`  ${entry}${owners ? ` (${owners})` : ""}`);
                }
            }
            const variableEntries = Object.entries(model.variables);
            if (variableEntries.length > 0) {
                console.log("\nVariables:");
                for (const [key, def] of variableEntries) {
                    console.log(`  ${key}=${def.command ? `$(${def.command})` : def.value} (${def.sourcePackage})`);
                }
            }
            if (model.shell.length > 0) {
                console.log("\nShell lines:");
                for (const { packageName, line } of model.shell) console.log(`  [${packageName}] ${line}`);
            }
        }));

    env
        .command("regenerate")
        .description("Rebuild every generated shell file from the current registry + tracked-package state, and (re)install the shell hook")
        .action(withErrorHandling(async function () {
            await reportGeneration(regenerateEnvironment());
        }));

    env
        .command("graph [name]")
        .description("Dependency tree of tracked tools; with a name, show what removing it would affect")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const state = loadEnvironmentState();
            if (trackedNames(state).length === 0) {
                if (opts.json) {
                    console.log(JSON.stringify(name ? { name, affected: [] } : { tree: [] }, null, 2));
                } else {
                    logger.info("No packages tracked yet - nothing to graph.");
                }
                return;
            }
            if (name) {
                const affected = dependentsOf(name, state);
                if (opts.json) {
                    console.log(JSON.stringify({ name, affected }, null, 2));
                    return;
                }
                if (affected.length === 0) {
                    logger.success(`No tracked package depends on ${name}.`);
                } else {
                    logger.warn(`Removing ${name} will affect: ${affected.join(", ")}`);
                }
                return;
            }
            const lines = renderEnvironmentTree(state);
            if (opts.json) {
                console.log(JSON.stringify({ tree: lines }, null, 2));
                return;
            }
            for (const line of lines) console.log(line);
        }));

    env
        .command("shells")
        .description("Per-shell writer capability matrix (what's supported, partial, or planned)")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const matrix = shellCapabilities();
            if (this.opts().json) {
                console.log(JSON.stringify(matrix, null, 2));
                return;
            }
            const current = getPlatform().defaultShell();
            for (const [shell, info] of Object.entries(matrix)) {
                const marker = shell === current ? " (current platform default)" : "";
                console.log(`${shell}${marker} - ${info.implemented ? "implemented" : "not implemented"}`);
                for (const [capability, status] of Object.entries(info.capabilities)) {
                    const symbol = status === "supported" ? "✓" : status === "partial" ? "◐" : "…";
                    console.log(`  ${symbol} ${capability}${status === "supported" ? "" : ` (${status})`}`);
                }
            }
        }));

    env
        .command("diff [snapshotId]")
        .description("What changed since a snapshot (default: the most recent one)")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (snapshotId) {
            const diff = diffEnvironment({ snapshotId });
            if (this.opts().json) {
                console.log(JSON.stringify(diff, null, 2));
                return;
            }
            console.log(`Since snapshot ${diff.snapshotId} (${diff.snapshotCreatedAt}):`);
            const section = (label, items, prefix) => {
                for (const item of items) console.log(`  ${prefix} ${label}: ${item}`);
            };
            section("package", diff.packagesAdded, "+");
            section("package", diff.packagesRemoved, "-");
            for (const change of diff.versionChanges) {
                console.log(`  ~ ${change.name}: ${change.from || "unknown"} → ${change.to || "unknown"}`);
            }
            if (diff.model) {
                section("PATH", diff.model.pathAdded, "+");
                section("PATH", diff.model.pathRemoved, "-");
                section("variable", diff.model.variablesAdded, "+");
                section("variable", diff.model.variablesRemoved, "-");
                section("variable", diff.model.variablesChanged, "~");
                if (diff.model.pathOrderChanged) console.log("  ~ PATH order changed");
            }
            if (!diff.model && diff.packagesAdded.length === 0 && diff.packagesRemoved.length === 0 && diff.versionChanges.length === 0) {
                logger.success("No changes.");
            }
        }));

    env
        .command("history [day]")
        .description("Transaction log: what each regeneration changed (default: list available days)")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (day) {
            const opts = this.opts();
            if (!day) {
                const days = listTransactionDays();
                if (opts.json) {
                    console.log(JSON.stringify(days, null, 2));
                    return;
                }
                if (days.length === 0) {
                    logger.info("No environment transactions logged yet.");
                    return;
                }
                for (const d of days) console.log(`  ${d}`);
                logger.info("Run 'devforgekit env history <day>' for details.");
                return;
            }
            const transactions = readTransactions(day);
            if (opts.json) {
                console.log(JSON.stringify(transactions, null, 2));
                return;
            }
            if (transactions.length === 0) {
                logger.info(`No transactions logged on ${day}.`);
                return;
            }
            for (const tx of transactions) {
                console.log(`${tx.timestamp} [${tx.action}]`);
                const c = tx.changes;
                for (const p of c.trackedAdded || []) console.log(`  + tracked ${p}`);
                for (const p of c.trackedRemoved || []) console.log(`  - tracked ${p}`);
                for (const p of c.packagesAdded || []) console.log(`  + contributor ${p}`);
                for (const p of c.packagesRemoved || []) console.log(`  - contributor ${p}`);
                for (const p of c.pathAdded || []) console.log(`  + PATH ${p}`);
                for (const p of c.pathRemoved || []) console.log(`  - PATH ${p}`);
                for (const v of c.variablesAdded || []) console.log(`  + variable ${v}`);
                for (const v of c.variablesRemoved || []) console.log(`  - variable ${v}`);
                for (const v of c.variablesChanged || []) console.log(`  ~ variable ${v}`);
                if (c.pathOrderChanged) console.log("  ~ PATH order changed");
            }
        }));

    env
        .command("watch")
        .description("Watch bin directories live: newly installed known tools are tracked and the environment regenerated as they appear (Ctrl-C to stop)")
        .option("--interval <seconds>", "poll interval", "2")
        .action(withErrorHandling(async function () {
            const intervalMs = Math.max(1, Number(this.opts().interval) || 2) * 1000;
            logger.info("Watching for new tool installations (Ctrl-C to stop)...");
            const stop = startEnvironmentWatch({
                intervalMs,
                onEvent: (event) => {
                    if (event.error) {
                        logger.warn(`${event.package} detected but registration failed: ${event.error}`);
                        return;
                    }
                    const version = event.version ? ` ${event.version}` : "";
                    logger.success(`${event.package}${version} detected (${event.dir}/${event.binary}). Environment updated.`);
                    if (event.reachableNow) {
                        logger.info("Already reachable in this shell - no restart required.");
                    } else {
                        logger.info("New PATH entry - takes effect in shells started after this (or 'exec $SHELL').");
                    }
                }
            });
            await new Promise((resolve) => {
                process.on("SIGINT", () => {
                    stop();
                    console.log("");
                    logger.info("Watch stopped.");
                    resolve();
                });
            });
        }));

    const snapshot = env
        .command("snapshot")
        .description("Environment snapshots - capture and inspect the tracked state and generated files");

    snapshot
        .command("create", { isDefault: true })
        .description("Save a snapshot of the current environment state")
        .option("-m, --message <message>", "note stored with the snapshot")
        .action(withErrorHandling(async function () {
            const { id, file } = createEnvironmentSnapshot({ message: this.opts().message || "" });
            logger.success(`Snapshot ${id} saved (${file})`);
        }));

    snapshot
        .command("list")
        .description("List saved environment snapshots, newest first")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const snapshots = listEnvironmentSnapshots();
            if (this.opts().json) {
                console.log(JSON.stringify(snapshots, null, 2));
                return;
            }
            if (snapshots.length === 0) {
                logger.info("No environment snapshots yet - create one with 'devforgekit env snapshot'.");
                return;
            }
            for (const s of snapshots) {
                console.log(`  ${s.id}  (${s.packageCount} package${s.packageCount === 1 ? "" : "s"})${s.message ? `  - ${s.message}` : ""}`);
            }
        }));

    env
        .command("restore <id>")
        .description("Restore a snapshot's tracked state and regenerate from it (a safety snapshot of the current state is taken first)")
        .action(withErrorHandling(async function (id) {
            const { safetySnapshotId, ...applied } = restoreEnvironment(id);
            logger.info(`Current state saved as safety snapshot ${safetySnapshotId}`);
            await reportGeneration(applied);
        }));
}
