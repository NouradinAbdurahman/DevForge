// Intelligent Repair Engine command (v1.3.4). Multi-stage diagnostic and
// repair: Scan → Analyze → Plan → Repair → Verify. See core/repair.js.
import path from "node:path";
import { writeFileSync } from "node:fs";
import {
    scanIssues,
    planRepairs,
    executeRepairs,
    verifyRepairs,
    createRollbackPoint,
    rollback,
    rollbackRepair,
    listRollbackPoints,
    previewRollback,
    runFullRepair,
    listHistory,
    getRepairRecord,
    deleteRepairRecord,
    cleanHistory,
    exportRecord,
    explainIssues,
    explainRepair,
    explainPlan,
    dryRunPlan,
    computeQualityScore,
    rollbackRepairResult,
    benchmarkRepairEngine,
    REPAIR_VERSION,
    REPAIR_CATEGORIES,
    CATEGORY_LABELS,
    RISK_LEVELS,
    RISK_LABELS
} from "../core/repair.js";
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";

export function registerRepairCommand(program) {
    const repair = program
        .command("repair")
        .description("Intelligent Repair Engine - detect, analyze, plan, and safely repair environment issues")
        .alias("fix")
        .alias("heal");

    // ─── (default = full pipeline) ───────────────────────────────────
    repair
        .command("run", { isDefault: true })
        .description("Run the full repair pipeline: scan → plan → repair → verify")
        .option("-y, --yes", "skip all confirmation prompts")
        .option("--dry-run", "preview what would be repaired without making changes")
        .option("--skip-benchmark", "skip before/after benchmark comparison")
        .option("--json", "output result as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const record = await runFullRepair({
                assumeYes: opts.yes || false,
                skipBenchmark: opts.skipBenchmark !== false,
                dryRun: opts.dryRun || false
            });
            if (opts.json) {
                console.log(JSON.stringify(record, null, 2));
            }
        }));

    // ─── scan ────────────────────────────────────────────────────────
    repair
        .command("scan")
        .description("Scan for issues across all DevForgeKit subsystems")
        .option("--json", "output issues as JSON")
        .option("--category <cat>", "filter by category")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            let issues = await scanIssues();

            if (opts.category) {
                issues = issues.filter((i) => i.category === opts.category);
            }

            if (opts.json) {
                console.log(JSON.stringify(issues, null, 2));
                return;
            }

            if (issues.length === 0) {
                logger.success("No issues detected - environment is healthy!");
                return;
            }

            logger.section("Detected Issues");
            for (const issue of issues) {
                const symbol = issue.severity === "CRITICAL" || issue.severity === "FATAL" ? "✗" :
                    issue.severity === "WARNING" ? "!" : "i";
                console.log(`\n  ${symbol} [${issue.severity}] ${issue.title || issue.description}`);
                console.log(`    Category: ${issue.categoryLabel || issue.category} | Subsystem: ${issue.subsystem} | Risk: ${issue.riskLabel || "unknown"}`);
                console.log(`    Impact: ${issue.impact}`);
                console.log(`    Fix: ${issue.fix}`);
                console.log(`    Time: ${issue.estimatedTime}`);
            }
            console.log(`\n  ${issues.length} issue(s) total`);
        }));

    // ─── plan ────────────────────────────────────────────────────────
    repair
        .command("plan")
        .description("Generate a repair plan from the last scan or a fresh scan")
        .option("--dry-run", "show what would be done without making changes")
        .option("--json", "output plan as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const issues = await scanIssues();

            if (issues.length === 0) {
                logger.success("No issues detected - nothing to plan.");
                return;
            }

            const plan = planRepairs(issues);

            if (opts.json) {
                console.log(JSON.stringify(opts.dryRun ? dryRunPlan(plan) : plan, null, 2));
                return;
            }

            if (opts.dryRun) {
                const preview = dryRunPlan(plan);
                logger.section("Dry Run Preview");
                console.log(`\n  Repairs: ${preview.totalRepairs} (plus ${preview.totalInfo} informational)`);
                console.log(`  Estimated time: ${preview.estimatedTime}`);
                console.log(`  Risk level: ${preview.riskLevel}`);
                if (preview.requiresRestart) console.log("  Restart required: yes");
                if (preview.filesAffected.length > 0) console.log(`  Files affected: ${preview.filesAffected.join(", ")}`);
                if (preview.packagesAffected.length > 0) console.log(`  Packages affected: ${preview.packagesAffected.join(", ")}`);
                console.log("\n  Repair Order:");
                for (const p of preview.preview) {
                    console.log(`  ${p.index}. [${p.severity}] ${p.title}`);
                    console.log(`     Action: ${p.actionType} | Risk: ${p.risk}`);
                    console.log(`     ${p.description}`);
                }
                return;
            }

            logger.section("Repair Plan");
            console.log(`\n  ${plan.totalRepairs} repair(s) + ${plan.totalInfo} informational`);
            console.log(`  Estimated time: ${plan.estimatedTime}`);
            console.log(`  Risk level: ${plan.riskLabel}`);
            if (plan.requiresRestart) console.log("  Restart required: yes");
            console.log("\n  Repair Order:");
            for (let i = 0; i < plan.issues.length; i++) {
                const issue = plan.issues[i];
                console.log(`  ${i + 1}. [${issue.severity}] ${issue.description}`);
                console.log(`     Fix: ${issue.fix} (Risk: ${issue.riskLabel})`);
            }

            if (plan.informational.length > 0) {
                console.log("\n  Informational (no auto-repair):");
                for (const info of plan.informational) {
                    console.log(`  • ${info.description}`);
                    console.log(`    Suggestion: ${info.fix}`);
                }
            }
        }));

    // ─── explain ─────────────────────────────────────────────────────
    repair
        .command("explain")
        .description("AI-powered explanation of detected issues (requires AI provider)")
        .option("--provider <id>", "AI provider to use")
        .option("--model <model>", "model override")
        .option("--endpoint <url>", "custom API endpoint")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const issues = await scanIssues();

            if (issues.length === 0) {
                logger.success("No issues detected - nothing to explain.");
                return;
            }

            const result = await explainIssues(issues, {
                provider: opts.provider,
                model: opts.model,
                endpoint: opts.endpoint
            });
            if (!result.ok) {
                logger.error(result.error);
                process.exitCode = 1;
                return;
            }
            console.log(result.explanation);
        }));

    // ─── explain-issues ─────────────────────────────────────────────
    repair
        .command("explain-issues")
        .description("Explain repair issues in human-readable format")
        .option("--plan", "explain the full repair plan, not just individual issues")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const issues = await scanIssues();

            if (issues.length === 0) {
                logger.success("No issues detected - nothing to explain.");
                return;
            }

            const plan = planRepairs(issues);

            if (opts.json) {
                console.log(JSON.stringify(opts.plan ? plan : issues.map(explainRepair), null, 2));
                return;
            }

            if (opts.plan) {
                console.log(explainPlan(plan));
            } else {
                for (let i = 0; i < issues.length; i++) {
                    const issue = issues[i];
                    console.log(`\n${"─".repeat(60)}`);
                    console.log(`Issue ${i + 1} of ${issues.length}: ${issue.title || issue.description}`);
                    console.log(`${"─".repeat(60)}`);
                    console.log(explainRepair(issue));
                }
            }
        }));

    // ─── verify ──────────────────────────────────────────────────────
    repair
        .command("verify")
        .description("Run post-repair verification (compatibility, health, workspaces, plugins)")
        .option("--benchmark", "include a quick benchmark in verification")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            await verifyRepairs({ runBenchmark: opts.benchmark || false });
        }));

    // ─── rollback ────────────────────────────────────────────────────
    repair
        .command("rollback <snapshotId>")
        .description("Roll back to a pre-repair snapshot")
        .action(withErrorHandling(async (snapshotId) => {
            await rollback(snapshotId);
        }));

    // ─── rollback-repair ─────────────────────────────────────────────
    repair
        .command("rollback-repair <repairId>")
        .description("Roll back a specific repair by restoring file backups")
        .option("--snapshot", "use the full environment snapshot instead of file backups")
        .option("-y, --yes", "skip confirmation prompt")
        .option("--preview", "preview what would be restored without doing it")
        .action(withErrorHandling(async function (repairId) {
            const opts = this.opts();
            if (opts.preview) {
                const preview = previewRollback(repairId);
                logger.section(`Rollback Preview: ${repairId}`);
                console.log(`\n  Created: ${preview.createdAt}`);
                console.log(`  Snapshot: ${preview.hasSnapshot ? preview.rollbackSnapshotId : "none"}`);
                console.log(`  Repairs reversible: ${preview.repairsReversible}`);
                console.log(`  Repairs irreversible: ${preview.repairsIrreversible}`);
                if (preview.fileBackups.length > 0) {
                    console.log(`\n  Files to restore:`);
                    for (const fb of preview.fileBackups) {
                        const status = fb.backupExists ? "✓" : "✗";
                        console.log(`  ${status} ${fb.originalPath}`);
                        console.log(`      Issue: ${fb.issue}`);
                    }
                }
                return;
            }
            await rollbackRepair(repairId, { useSnapshot: opts.snapshot || false, assumeYes: opts.yes || false });
        }));

    // ─── rollback-list ───────────────────────────────────────────────
    repair
        .command("rollback-list")
        .description("List repair records that can be rolled back")
        .action(withErrorHandling(() => {
            const points = listRollbackPoints();
            if (points.length === 0) {
                logger.info("No rollback points available.");
                return;
            }
            logger.section("Available Rollback Points");
            console.log("\n  ID                              Fixed  Failed  Snapshot  Date");
            console.log("  " + "-".repeat(90));
            for (const p of points) {
                const id = (p.id || "").slice(0, 32).padEnd(32);
                const fixed = String(p.fixed).padStart(5);
                const failed = String(p.failed).padStart(7);
                const snapshot = (p.rollbackSnapshotId ? "yes" : "no").padEnd(8);
                const date = p.createdAt ? p.createdAt.slice(0, 19).replace("T", " ") : "unknown";
                console.log(`  ${id}  ${fixed}  ${failed}  ${snapshot}  ${date}`);
            }
            console.log(`\n  ${points.length} rollback point(s)`);
        }));

    // ─── history ─────────────────────────────────────────────────────
    repair
        .command("history")
        .description("List past repair records")
        .option("--clear", "delete all repair history records")
        .option("--search <query>", "search by ID, machine, platform, or category")
        .option("--filter-risk <risk>", "filter by risk level (none, low, medium, high)")
        .option("--filter-category <cat>", "filter by category label")
        .option("--filter-status <status>", "filter by status (success, failed, partial)")
        .option("--sort <field>", "sort by: date, fixed, failed, quality", "date")
        .option("--limit <n>", "limit number of results", parseInt)
        .option("--json", "output as JSON")
        .action(withErrorHandling(function () {
            const opts = this.opts();
            if (opts.clear) {
                const result = cleanHistory();
                logger.success(`Deleted ${result.deleted} repair record(s)`);
                return;
            }
            const filter = {};
            if (opts.filterRisk) filter.risk = opts.filterRisk;
            if (opts.filterCategory) filter.category = opts.filterCategory;
            if (opts.filterStatus) filter.status = opts.filterStatus;

            const history = listHistory({
                filter: Object.keys(filter).length > 0 ? filter : undefined,
                search: opts.search,
                sortBy: opts.sort,
                limit: opts.limit
            });
            if (history.length === 0) {
                logger.info("No repair records found. Run 'devforgekit repair' to start.");
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(history, null, 2));
                return;
            }

            logger.section("Repair History");
            console.log("\n  ID                              Issues  Fixed  Failed  Risk    Quality  Date");
            console.log("  " + "-".repeat(105));
            for (const h of history) {
                const id = (h.id || "").slice(0, 32).padEnd(32);
                const issues = String(h.issueCount).padStart(6);
                const fixed = String(h.fixed).padStart(5);
                const failed = String(h.failed).padStart(7);
                const risk = (h.riskLabel || h.riskLevel || "unknown").padEnd(6);
                const quality = h.qualityScore ? `${h.qualityScore.score}/100 (${h.qualityScore.grade})`.padEnd(8) : "n/a".padEnd(8);
                const date = h.createdAt ? h.createdAt.slice(0, 19).replace("T", " ") : "unknown";
                console.log(`  ${id}  ${issues}  ${fixed}  ${failed}  ${risk}  ${quality}  ${date}`);
            }
            console.log(`\n  ${history.length} record(s)`);
        }));

    // ─── export ──────────────────────────────────────────────────────
    repair
        .command("export <id>")
        .description("Export a repair record (json, markdown, html, csv)")
        .option("-f, --format <format>", "output format: json, markdown, html, csv", "markdown")
        .option("-o, --output <file>", "output file (default: stdout)")
        .action(withErrorHandling(function (id) {
            const opts = this.opts();
            const record = getRepairRecord(id);
            const content = exportRecord(record, opts.format);

            if (opts.output) {
                writeFileSync(opts.output, content);
                logger.success(`Exported to ${opts.output}`);
            } else {
                console.log(content);
            }
        }));

    // ─── delete ──────────────────────────────────────────────────────
    repair
        .command("delete <id>")
        .description("Delete a repair record")
        .action(withErrorHandling((id) => {
            const deleted = deleteRepairRecord(id);
            logger.success(`Deleted ${deleted}`);
        }));

    // ─── clean ───────────────────────────────────────────────────────
    repair
        .command("clean")
        .description("Delete all repair history records")
        .action(withErrorHandling(() => {
            const result = cleanHistory();
            logger.success(`Deleted ${result.deleted} repair record(s)`);
        }));

    // ─── benchmark ───────────────────────────────────────────────────
    repair
        .command("benchmark")
        .description("Benchmark repair engine performance (scan, plan, history)")
        .option("-n, --iterations <n>", "number of iterations", parseInt, 3)
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const result = await benchmarkRepairEngine({ iterations: opts.iterations || 3 });
            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
            }
        }));
}
