// Benchmark Engine command (v1.3.3). Measures development environment
// performance with real developer workloads. See core/benchmark.js.
import path from "node:path";
import { writeFileSync } from "node:fs";
import {
    runBenchmark,
    saveResult,
    listHistory,
    getResult,
    deleteResult,
    compareResults,
    exportResult,
    explainResult,
    gradeForScore,
    benchmarkSummary
} from "../core/benchmark.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";

export function registerBenchmarkCommand(program) {
    const benchmark = program
        .command("benchmark")
        .description("Benchmark Engine - measure development environment performance")
        .alias("bench")
        .alias("perf");

    // ─── (default = quick) ───────────────────────────────────────────
    benchmark
        .command("quick", { isDefault: true })
        .description("Quick benchmark (~10-20s): CPU, disk, git, node, shell, memory")
        .option("--no-save", "don't save result to history")
        .option("--json", "output result as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const result = await runBenchmark({ profile: "quick" });
            if (opts.save) saveResult(result);
            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
            }
        }));

    // ─── full ────────────────────────────────────────────────────────
    benchmark
        .command("full")
        .description("Full benchmark (~2-5min): all categories including project generation")
        .option("--no-save", "don't save result to history")
        .option("--json", "output result as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const result = await runBenchmark({ profile: "full" });
            if (opts.save) saveResult(result);
            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
            }
        }));

    // ─── standard ────────────────────────────────────────────────────
    benchmark
        .command("standard")
        .description("Standard benchmark (~30-60s): quick + docker, flutter, python, databases, package managers")
        .option("--no-save", "don't save result to history")
        .option("--json", "output result as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const result = await runBenchmark({ profile: "standard" });
            if (opts.save) saveResult(result);
            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
            }
        }));

    // ─── compare ─────────────────────────────────────────────────────
    benchmark
        .command("compare [old] [new]")
        .description("Compare two benchmark results (by ID, or latest two if omitted)")
        .action(withErrorHandling(async (oldId, newId) => {
            let oldResult, newResult;

            if (oldId && newId) {
                oldResult = getResult(oldId);
                newResult = getResult(newId);
            } else {
                const history = listHistory();
                if (history.length < 2) {
                    logger.error("Need at least 2 benchmark results to compare. Run 'devforgekit benchmark' first.");
                    process.exitCode = 1;
                    return;
                }
                oldResult = getResult(history[1].id);
                newResult = getResult(history[0].id);
            }

            const comparison = compareResults(oldResult, newResult);

            logger.section("Benchmark Comparison");
            console.log(`\n  Old: ${comparison.old.createdAt} - ${comparison.old.overallScore}/100 (${comparison.old.overallGrade}) on ${comparison.old.machine}`);
            console.log(`  New: ${comparison.new.createdAt} - ${comparison.new.overallScore}/100 (${comparison.new.overallGrade}) on ${comparison.new.machine}`);

            if (comparison.overallDelta !== null) {
                const sign = comparison.overallDelta > 0 ? "+" : "";
                const status = comparison.overallDelta > 0 ? "improved" : comparison.overallDelta < 0 ? "regressed" : "unchanged";
                console.log(`\n  Overall: ${comparison.old.overallScore} → ${comparison.new.overallScore} (${sign}${comparison.overallDelta}, ${status})`);
            }

            console.log("\n  Category Breakdown:");
            console.log("  " + "-".repeat(60));
            for (const cat of comparison.categories) {
                const oldStr = cat.oldScore != null ? String(cat.oldScore) : "N/A";
                const newStr = cat.newScore != null ? String(cat.newScore) : "N/A";
                const deltaStr = cat.delta != null ? (cat.delta > 0 ? `+${cat.delta}` : String(cat.delta)) : "N/A";
                const symbol = cat.status === "improved" ? "↑" : cat.status === "regressed" ? "↓" : cat.status === "unchanged" ? "=" : "?";
                console.log(`  ${symbol} ${cat.category.padEnd(20)}  ${oldStr.padStart(5)} → ${newStr.padStart(5)}  (${deltaStr})`);
            }
        }));

    // ─── history ─────────────────────────────────────────────────────
    benchmark
        .command("history")
        .description("List past benchmark results")
        .action(withErrorHandling(() => {
            const history = listHistory();
            if (history.length === 0) {
                logger.info("No benchmark results found. Run 'devforgekit benchmark' to create one.");
                return;
            }

            logger.section("Benchmark History");
            console.log("\n  ID                              Profile     Score  Grade  Date");
            console.log("  " + "-".repeat(85));
            for (const h of history) {
                const id = (h.id || "").slice(0, 32).padEnd(32);
                const profile = (h.profile || "").padEnd(10);
                const score = String(h.overallScore ?? 0).padStart(5);
                const grade = (h.overallGrade || "F").padEnd(5);
                const date = h.createdAt ? h.createdAt.slice(0, 19).replace("T", " ") : "unknown";
                console.log(`  ${id}  ${profile}  ${score}  ${grade}  ${date}`);
            }
            console.log(`\n  ${history.length} result(s)`);
        }));

    // ─── export ──────────────────────────────────────────────────────
    benchmark
        .command("export <id>")
        .description("Export a benchmark result (json, markdown, html, csv)")
        .option("-f, --format <format>", "output format: json, markdown, html, csv", "markdown")
        .option("-o, --output <file>", "output file (default: stdout)")
        .action(withErrorHandling(function (id) {
            const opts = this.opts();
            const result = getResult(id);
            const content = exportResult(result, opts.format);

            if (opts.output) {
                writeFileSync(opts.output, content);
                logger.success(`Exported to ${opts.output}`);
            } else {
                console.log(content);
            }
        }));

    // ─── delete ──────────────────────────────────────────────────────
    benchmark
        .command("delete <id>")
        .description("Delete a benchmark result")
        .action(withErrorHandling((id) => {
            const deleted = deleteResult(id);
            logger.success(`Deleted ${deleted}`);
        }));

    // ─── explain ─────────────────────────────────────────────────────
    benchmark
        .command("explain [id]")
        .description("AI-powered explanation of benchmark results (requires AI provider)")
        .option("--provider <id>", "AI provider to use")
        .option("--model <model>", "model override")
        .option("--endpoint <url>", "custom API endpoint")
        .action(withErrorHandling(async function (id) {
            const opts = this.opts();
            let result;
            if (id) {
                result = getResult(id);
            } else {
                const history = listHistory();
                if (history.length === 0) {
                    logger.error("No benchmark results found. Run 'devforgekit benchmark' first.");
                    process.exitCode = 1;
                    return;
                }
                result = getResult(history[0].id);
            }

            const explanation = await explainResult(result, {
                provider: opts.provider,
                model: opts.model,
                endpoint: opts.endpoint
            });
            if (!explanation.ok) {
                logger.error(explanation.error);
                process.exitCode = 1;
                return;
            }
            console.log(explanation.explanation);
        }));
}
