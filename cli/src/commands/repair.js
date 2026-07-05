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
    runFullRepair,
    listHistory,
    getRepairRecord,
    deleteRepairRecord,
    cleanHistory,
    exportRecord,
    explainIssues,
    REPAIR_VERSION
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
        .option("--skip-benchmark", "skip before/after benchmark comparison")
        .option("--json", "output result as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const record = await runFullRepair({
                assumeYes: opts.yes || false,
                skipBenchmark: opts.skipBenchmark !== false
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
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const issues = await scanIssues();

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
                console.log(`\n  ${symbol} [${issue.severity}] ${issue.description}`);
                console.log(`    Category: ${issue.category} | Subsystem: ${issue.subsystem}`);
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
        .action(withErrorHandling(async () => {
            const issues = await scanIssues();

            if (issues.length === 0) {
                logger.success("No issues detected - nothing to plan.");
                return;
            }

            const plan = planRepairs(issues);

            logger.section("Repair Plan");
            console.log(`\n  ${plan.totalRepairs} repair(s) + ${plan.totalInfo} informational`);
            console.log(`  Estimated time: ${plan.estimatedTime}`);
            if (plan.requiresRestart) console.log("  Restart required: yes");
            console.log("\n  Repair Order:");
            for (let i = 0; i < plan.issues.length; i++) {
                const issue = plan.issues[i];
                console.log(`  ${i + 1}. [${issue.severity}] ${issue.description}`);
                console.log(`     Fix: ${issue.fix}`);
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

    // ─── history ─────────────────────────────────────────────────────
    repair
        .command("history")
        .description("List past repair records")
        .action(withErrorHandling(() => {
            const history = listHistory();
            if (history.length === 0) {
                logger.info("No repair records found. Run 'devforgekit repair' to start.");
                return;
            }

            logger.section("Repair History");
            console.log("\n  ID                              Issues  Fixed  Failed  Date");
            console.log("  " + "-".repeat(85));
            for (const h of history) {
                const id = (h.id || "").slice(0, 32).padEnd(32);
                const issues = String(h.issueCount).padStart(6);
                const fixed = String(h.fixed).padStart(5);
                const failed = String(h.failed).padStart(7);
                const date = h.createdAt ? h.createdAt.slice(0, 19).replace("T", " ") : "unknown";
                console.log(`  ${id}  ${issues}  ${fixed}  ${failed}  ${date}`);
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
}
