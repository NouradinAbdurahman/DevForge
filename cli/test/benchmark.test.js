import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    BENCHMARK_VERSION,
    BENCHMARK_DIR,
    gradeForScore,
    runBenchmark,
    saveResult,
    listHistory,
    getResult,
    deleteResult,
    compareResults,
    exportResult,
    benchmarkSummary,
    getTrend,
    getTrendSummary,
    renderSparkline,
    explainBenchmark,
    explainBenchmarkResult,
    computeBenchmarkQuality,
    generateRichReport,
    BENCHMARK_METADATA
} from "../src/core/benchmark.js";

// Point HOME at a scratch directory to isolate from the developer's real
// ~/.devforgekit (same pattern as snapshot.test.js and self-update.test.js).
function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-bench-test-"));
    process.env.HOME = tempHome;
    try {
        return fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

// ─── Constants ────────────────────────────────────────────────────────

test("BENCHMARK_VERSION is 2", () => {
    assert.equal(BENCHMARK_VERSION, 2);
});

test("BENCHMARK_DIR is 'benchmarks'", () => {
    assert.equal(BENCHMARK_DIR, "benchmarks");
});

// ─── gradeForScore ────────────────────────────────────────────────────

test("gradeForScore returns A+ for 95+", () => {
    assert.equal(gradeForScore(95), "A+");
    assert.equal(gradeForScore(100), "A+");
    assert.equal(gradeForScore(99), "A+");
});

test("gradeForScore returns A for 90-94", () => {
    assert.equal(gradeForScore(90), "A");
    assert.equal(gradeForScore(94), "A");
});

test("gradeForScore returns B for 80-89", () => {
    assert.equal(gradeForScore(80), "B");
    assert.equal(gradeForScore(89), "B");
});

test("gradeForScore returns C for 70-79", () => {
    assert.equal(gradeForScore(70), "C");
    assert.equal(gradeForScore(79), "C");
});

test("gradeForScore returns D for 60-69", () => {
    assert.equal(gradeForScore(60), "D");
    assert.equal(gradeForScore(69), "D");
});

test("gradeForScore returns F for <60", () => {
    assert.equal(gradeForScore(59), "F");
    assert.equal(gradeForScore(0), "F");
});

// ─── saveResult / listHistory / getResult / deleteResult ─────────────

test("saveResult writes a JSON file to ~/.devforgekit/benchmarks/", () => {
    withTempHome((tempHome) => {
        const result = {
            id: "test-id-123",
            createdAt: new Date().toISOString(),
            profile: "quick",
            overallScore: 85,
            overallGrade: "B",
            durationMs: 5000,
            devforgekitVersion: "1.3.3",
            machine: { hostname: "test" },
            categoryResults: {},
            categoryScores: { cpu: 85 }
        };
        const filePath = saveResult(result);
        assert.ok(existsSync(filePath));
        assert.ok(filePath.endsWith("test-id-123.json"));

        const saved = JSON.parse(readFileSync(filePath, "utf8"));
        assert.equal(saved.id, "test-id-123");
        assert.equal(saved.overallScore, 85);
    });
});

test("listHistory returns empty array when no benchmarks directory exists", () => {
    withTempHome(() => {
        const history = listHistory();
        assert.deepEqual(history, []);
    });
});

test("listHistory returns saved results sorted by date (newest first)", () => {
    withTempHome(() => {
        const old = {
            id: "old-result",
            createdAt: "2025-01-01T00:00:00.000Z",
            profile: "quick",
            overallScore: 70,
            overallGrade: "C",
            durationMs: 5000
        };
        const newer = {
            id: "new-result",
            createdAt: "2025-06-01T00:00:00.000Z",
            profile: "quick",
            overallScore: 85,
            overallGrade: "B",
            durationMs: 4000
        };
        saveResult(old);
        saveResult(newer);

        const history = listHistory();
        assert.equal(history.length, 2);
        assert.equal(history[0].id, "new-result");
        assert.equal(history[1].id, "old-result");
    });
});

test("getResult reads a saved benchmark result", () => {
    withTempHome(() => {
        const result = {
            id: "get-test",
            createdAt: new Date().toISOString(),
            profile: "quick",
            overallScore: 90,
            overallGrade: "A",
            durationMs: 3000,
            machine: { hostname: "test" },
            categoryResults: { cpu: { compression: 400 } },
            categoryScores: { cpu: 90 }
        };
        saveResult(result);
        const loaded = getResult("get-test");
        assert.equal(loaded.id, "get-test");
        assert.equal(loaded.overallScore, 90);
        assert.deepEqual(loaded.categoryScores, { cpu: 90 });
    });
});

test("getResult throws for non-existent id", () => {
    withTempHome(() => {
        assert.throws(
            () => getResult("nonexistent"),
            /not found/
        );
    });
});

test("deleteResult removes a benchmark result file", () => {
    withTempHome(() => {
        const result = {
            id: "delete-test",
            createdAt: new Date().toISOString(),
            profile: "quick",
            overallScore: 50,
            overallGrade: "F",
            durationMs: 1000
        };
        const filePath = saveResult(result);
        assert.ok(existsSync(filePath));

        const deleted = deleteResult("delete-test");
        assert.equal(deleted, filePath);
        assert.ok(!existsSync(filePath));
    });
});

test("deleteResult throws for non-existent id", () => {
    withTempHome(() => {
        assert.throws(
            () => deleteResult("nonexistent"),
            /not found/
        );
    });
});

// ─── compareResults ───────────────────────────────────────────────────

test("compareResults identifies improvements and regressions", () => {
    const oldResult = {
        id: "old",
        createdAt: "2025-01-01T00:00:00.000Z",
        overallScore: 70,
        overallGrade: "C",
        machine: { hostname: "mac1" },
        categoryScores: { cpu: 60, disk: 80, git: 70 }
    };
    const newResult = {
        id: "new",
        createdAt: "2025-06-01T00:00:00.000Z",
        overallScore: 85,
        overallGrade: "B",
        machine: { hostname: "mac1" },
        categoryScores: { cpu: 85, disk: 75, git: 95 }
    };

    const comparison = compareResults(oldResult, newResult);

    assert.equal(comparison.old.overallScore, 70);
    assert.equal(comparison.new.overallScore, 85);
    assert.equal(comparison.overallDelta, 15);

    const cpu = comparison.categories.find((c) => c.category === "cpu");
    assert.equal(cpu.oldScore, 60);
    assert.equal(cpu.newScore, 85);
    assert.equal(cpu.delta, 25);
    assert.equal(cpu.status, "improved");

    const disk = comparison.categories.find((c) => c.category === "disk");
    assert.equal(disk.delta, -5);
    assert.equal(disk.status, "regressed");

    const git = comparison.categories.find((c) => c.category === "git");
    assert.equal(git.delta, 25);
    assert.equal(git.status, "improved");
});

test("compareResults handles missing categories", () => {
    const oldResult = {
        id: "old",
        createdAt: "2025-01-01T00:00:00.000Z",
        overallScore: 70,
        overallGrade: "C",
        machine: { hostname: "mac1" },
        categoryScores: { cpu: 60 }
    };
    const newResult = {
        id: "new",
        createdAt: "2025-06-01T00:00:00.000Z",
        overallScore: 85,
        overallGrade: "B",
        machine: { hostname: "mac1" },
        categoryScores: { cpu: 85, disk: 90 }
    };

    const comparison = compareResults(oldResult, newResult);
    assert.equal(comparison.categories.length, 2);

    const disk = comparison.categories.find((c) => c.category === "disk");
    assert.equal(disk.oldScore, null);
    assert.equal(disk.newScore, 90);
    assert.equal(disk.delta, null);
    assert.equal(disk.status, "N/A");
});

// ─── exportResult ─────────────────────────────────────────────────────

test("exportResult produces valid JSON", () => {
    const result = {
        id: "export-test",
        createdAt: "2025-01-01T00:00:00.000Z",
        profile: "quick",
        overallScore: 85,
        overallGrade: "B",
        durationMs: 5000,
        devforgekitVersion: "1.3.3",
        machine: { hostname: "test", os: "macOS 15.4" },
        categoryResults: { cpu: { compression: 400 } },
        categoryScores: { cpu: 85 },
        skipped: [],
        compatibilityIssues: []
    };
    const json = exportResult(result, "json");
    const parsed = JSON.parse(json);
    assert.equal(parsed.id, "export-test");
    assert.equal(parsed.overallScore, 85);
});

test("exportResult produces valid Markdown", () => {
    const result = {
        id: "export-md",
        createdAt: "2025-01-01T00:00:00.000Z",
        profile: "quick",
        overallScore: 90,
        overallGrade: "A",
        durationMs: 3000,
        devforgekitVersion: "1.3.3",
        machine: { hostname: "test", os: "macOS 15.4" },
        categoryResults: { cpu: { compression: 400, jsonParse: 30 } },
        categoryScores: { cpu: 90 },
        skipped: [{ category: "docker", reason: "docker not installed" }],
        compatibilityIssues: [{ severity: "WARNING", tool: "node", message: "version mismatch" }]
    };
    const md = exportResult(result, "markdown");
    assert.ok(md.includes("# Benchmark Report"));
    assert.ok(md.includes("**90/100**"));
    assert.ok(md.includes("## Category Scores"));
    assert.ok(md.includes("## Skipped Categories"));
    assert.ok(md.includes("## Compatibility Issues"));
    assert.ok(md.includes("## Detailed Measurements"));
});

test("exportResult produces valid HTML", () => {
    const result = {
        id: "export-html",
        createdAt: "2025-01-01T00:00:00.000Z",
        profile: "quick",
        overallScore: 75,
        overallGrade: "C",
        durationMs: 5000,
        devforgekitVersion: "1.3.3",
        machine: { hostname: "test", os: "macOS 15.4" },
        categoryResults: { cpu: { compression: 400 } },
        categoryScores: { cpu: 75 },
        skipped: [],
        compatibilityIssues: []
    };
    const html = exportResult(result, "html");
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("<title>Benchmark Report"));
    assert.ok(html.includes("75/100"));
    assert.ok(html.includes("<table>"));
});

test("exportResult produces valid CSV", () => {
    const result = {
        id: "export-csv",
        createdAt: "2025-01-01T00:00:00.000Z",
        profile: "quick",
        overallScore: 80,
        overallGrade: "B",
        durationMs: 4000,
        devforgekitVersion: "1.3.3",
        machine: { hostname: "test" },
        categoryResults: { cpu: { compression: 400, jsonParse: 30 } },
        categoryScores: { cpu: 80 },
        skipped: [],
        compatibilityIssues: []
    };
    const csv = exportResult(result, "csv");
    const lines = csv.trim().split("\n");
    assert.equal(lines[0], "category,measurement,duration_ms,score");
    assert.ok(lines.some((l) => l.startsWith("cpu,compression,")));
    assert.ok(lines.some((l) => l.startsWith("cpu,jsonParse,")));
    assert.ok(lines.some((l) => l.includes("overall") && l.includes("80")));
});

test("exportResult throws for unknown format", () => {
    const result = { id: "x", overallScore: 50, categoryResults: {}, categoryScores: {} };
    assert.throws(
        () => exportResult(result, "xml"),
        /Unknown export format/
    );
});

// ─── benchmarkSummary ─────────────────────────────────────────────────

test("benchmarkSummary extracts a compact summary from a full result", () => {
    const result = {
        id: "summary-test",
        createdAt: "2025-01-01T00:00:00.000Z",
        profile: "quick",
        overallScore: 88,
        overallGrade: "B",
        durationMs: 5000,
        machine: { hostname: "test" },
        categoryResults: { cpu: { compression: 400 } },
        categoryScores: { cpu: 88, disk: 90 },
        slowest: { category: "cpu", score: 88 },
        fastest: { category: "disk", score: 90 },
        skipped: [],
        compatibilityIssues: []
    };
    const summary = benchmarkSummary(result);
    assert.equal(summary.id, "summary-test");
    assert.equal(summary.overallScore, 88);
    assert.equal(summary.overallGrade, "B");
    assert.deepEqual(summary.categoryScores, { cpu: 88, disk: 90 });
    assert.deepEqual(summary.slowest, { category: "cpu", score: 88 });
    assert.deepEqual(summary.fastest, { category: "disk", score: 90 });
    // Should not include detailed measurements
    assert.ok(!summary.categoryResults);
});

// ─── Integration: runBenchmark (quick profile) ────────────────────────

test("runBenchmark with quick profile produces valid results", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-bench-run-"));
    process.env.HOME = tempHome;

    try {
        const result = await runBenchmark({ profile: "quick" });

        assert.ok(result.id);
        assert.ok(result.createdAt);
        assert.equal(result.profile, "quick");
        assert.equal(result.benchmarkVersion, BENCHMARK_VERSION);
        assert.ok(result.machine);
        assert.ok(result.machine.hostname);
        assert.ok(result.machine.cpuModel);
        assert.ok(result.machine.cpuCount > 0);
        assert.ok(result.durationMs > 0);
        assert.ok(result.devforgekitVersion);

        // Should have category scores for quick profile categories
        assert.ok(result.categoryScores);
        assert.ok(typeof result.overallScore === "number");
        assert.ok(result.overallScore >= 0 && result.overallScore <= 100);
        assert.ok(result.overallGrade);

        // Should have results for at least some categories
        const categories = Object.keys(result.categoryResults);
        assert.ok(categories.length > 0, "should have at least one category with results");
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

test("runBenchmark with unknown profile throws", async () => {
    await assert.rejects(
        () => runBenchmark({ profile: "nonexistent" }),
        /Unknown benchmark profile/
    );
});

test("runBenchmark + saveResult + listHistory full cycle", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-bench-cycle-"));
    process.env.HOME = tempHome;

    try {
        const result = await runBenchmark({ profile: "quick" });
        const filePath = saveResult(result);
        assert.ok(existsSync(filePath));

        const history = listHistory();
        assert.equal(history.length, 1);
        assert.equal(history[0].id, result.id);

        // Delete it
        deleteResult(result.id);
        const afterDelete = listHistory();
        assert.equal(afterDelete.length, 0);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

test("runBenchmark cleans up temporary directories", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-bench-cleanup-"));
    process.env.HOME = tempHome;

    try {
        // Count temp dirs before
        const tmpDir = tmpdir();
        const before = readdirSync(tmpDir).filter((f) => f.startsWith("bench-")).length;

        await runBenchmark({ profile: "quick" });

        // Count temp dirs after - should not be significantly more
        const after = readdirSync(tmpDir).filter((f) => f.startsWith("bench-")).length;
        // Allow some race condition tolerance but generally should be cleaned up
        assert.ok(after <= before + 2, `temp dirs should be cleaned up (before: ${before}, after: ${after})`);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

test("runBenchmark calls onProgress callback", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-bench-progress-"));
    process.env.HOME = tempHome;

    try {
        const progressCalls = [];
        await runBenchmark({
            profile: "quick",
            onProgress: (p) => progressCalls.push(p)
        });

        assert.ok(progressCalls.length > 0, "onProgress should be called");
        assert.ok(progressCalls.some((p) => p.status === "running" || p.status === "done" || p.status === "skipped"));
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

// ─── Phase 2: Rich metadata in runBenchmark ───────────────────────────

test("runBenchmark includes rich metadata (environment, categoryLabels, qualityScore)", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-bench-meta-"));
    process.env.HOME = tempHome;

    try {
        const result = await runBenchmark({ profile: "quick" });
        assert.ok(result.environment, "should have environment object");
        assert.ok(result.environment.nodeVersion, "should have nodeVersion");
        assert.ok(result.environment.shellType, "should have shellType");
        assert.ok(result.categoryLabels, "should have categoryLabels");
        assert.ok(result.affectedPackages, "should have affectedPackages");
        assert.ok(result.confidence, "should have confidence data");
        assert.ok(result.qualityScore, "should have qualityScore");
        assert.ok(typeof result.qualityScore.score === "number");
        assert.ok(result.qualityScore.coverage != null);
        assert.ok(result.qualityScore.confidence != null);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

// ─── Phase 4: Enhanced comparison ─────────────────────────────────────

test("compareResults includes summary, significance, likelyCause, measurementDeltas", () => {
    const oldResult = {
        id: "old",
        createdAt: "2025-01-01T00:00:00.000Z",
        overallScore: 70,
        overallGrade: "C",
        machine: { hostname: "mac1", freeMemoryGb: 16, os: "macOS 14" },
        categoryScores: { cpu: 60, disk: 80 },
        categoryResults: { cpu: { compression: 800 }, disk: { sequentialWrite: 600 } }
    };
    const newResult = {
        id: "new",
        createdAt: "2025-06-01T00:00:00.000Z",
        overallScore: 50,
        overallGrade: "F",
        machine: { hostname: "mac1", freeMemoryGb: 8, os: "macOS 14" },
        categoryScores: { cpu: 30, disk: 70 },
        categoryResults: { cpu: { compression: 1600 }, disk: { sequentialWrite: 800 } }
    };

    const comparison = compareResults(oldResult, newResult);

    assert.ok(comparison.summary, "should have summary");
    assert.equal(comparison.summary.improved, 0);
    assert.equal(comparison.summary.regressed, 2);

    const cpu = comparison.categories.find((c) => c.category === "cpu");
    assert.ok(cpu.significant, "cpu regression should be significant");
    assert.ok(cpu.likelyCause, "should have likelyCause for significant regression");
    assert.ok(cpu.recommendation, "should have recommendation");
    assert.ok(cpu.measurementDeltas, "should have measurementDeltas");
    assert.ok(cpu.measurementDeltas.length > 0, "should have at least one measurement delta");
    assert.ok(cpu.measurementDeltas.some((m) => m.measurement === "compression"));
});

test("compareResults detects machine change as likely cause", () => {
    const oldResult = {
        id: "old",
        createdAt: "2025-01-01T00:00:00.000Z",
        overallScore: 80,
        overallGrade: "B",
        machine: { hostname: "mac1" },
        categoryScores: { cpu: 80 }
    };
    const newResult = {
        id: "new",
        createdAt: "2025-06-01T00:00:00.000Z",
        overallScore: 60,
        overallGrade: "D",
        machine: { hostname: "mac2" },
        categoryScores: { cpu: 60 }
    };

    const comparison = compareResults(oldResult, newResult);
    const cpu = comparison.categories.find((c) => c.category === "cpu");
    assert.ok(cpu.likelyCause.includes("Different machine"));
});

// ─── Phase 5: Trend analysis ──────────────────────────────────────────

test("getTrend returns points from history for overall", () => {
    withTempHome(() => {
        saveResult({ id: "t1", createdAt: "2025-01-01T00:00:00.000Z", profile: "quick", overallScore: 70, overallGrade: "C", durationMs: 1000, machine: {}, categoryScores: {}, categoryResults: {} });
        saveResult({ id: "t2", createdAt: "2025-02-01T00:00:00.000Z", profile: "quick", overallScore: 75, overallGrade: "C", durationMs: 1000, machine: {}, categoryScores: {}, categoryResults: {} });
        saveResult({ id: "t3", createdAt: "2025-03-01T00:00:00.000Z", profile: "quick", overallScore: 85, overallGrade: "B", durationMs: 1000, machine: {}, categoryScores: {}, categoryResults: {} });

        const trend = getTrend("overall", { limit: 10 });
        assert.equal(trend.count, 3);
        assert.equal(trend.points[0].score, 70);
        assert.equal(trend.points[2].score, 85);
    });
});

test("getTrend returns points for a specific category", () => {
    withTempHome(() => {
        saveResult({ id: "c1", createdAt: "2025-01-01T00:00:00.000Z", profile: "quick", overallScore: 70, overallGrade: "C", durationMs: 1000, machine: {}, categoryScores: { cpu: 60 }, categoryResults: {} });
        saveResult({ id: "c2", createdAt: "2025-02-01T00:00:00.000Z", profile: "quick", overallScore: 80, overallGrade: "B", durationMs: 1000, machine: {}, categoryScores: { cpu: 75 }, categoryResults: {} });

        const trend = getTrend("cpu", { limit: 10 });
        assert.equal(trend.count, 2);
        assert.equal(trend.points[0].score, 60);
        assert.equal(trend.points[1].score, 75);
    });
});

test("renderSparkline produces non-empty string for valid values", () => {
    const sparkline = renderSparkline([50, 60, 70, 80, 90]);
    assert.ok(sparkline.length > 0);
    assert.ok(typeof sparkline === "string");
});

test("renderSparkline returns empty string for empty values", () => {
    assert.equal(renderSparkline([]), "");
});

test("getTrendSummary identifies improving trend", () => {
    withTempHome(() => {
        saveResult({ id: "i1", createdAt: "2025-01-01T00:00:00.000Z", profile: "quick", overallScore: 70, overallGrade: "C", durationMs: 1000, machine: {}, categoryScores: {}, categoryResults: {} });
        saveResult({ id: "i2", createdAt: "2025-02-01T00:00:00.000Z", profile: "quick", overallScore: 85, overallGrade: "B", durationMs: 1000, machine: {}, categoryScores: {}, categoryResults: {} });

        const summary = getTrendSummary("overall", { limit: 10 });
        assert.equal(summary.direction, "improving");
        assert.ok(summary.delta > 0);
        assert.ok(summary.sparkline.length > 0);
    });
});

test("getTrendSummary identifies declining trend", () => {
    withTempHome(() => {
        saveResult({ id: "d1", createdAt: "2025-01-01T00:00:00.000Z", profile: "quick", overallScore: 85, overallGrade: "B", durationMs: 1000, machine: {}, categoryScores: {}, categoryResults: {} });
        saveResult({ id: "d2", createdAt: "2025-02-01T00:00:00.000Z", profile: "quick", overallScore: 70, overallGrade: "C", durationMs: 1000, machine: {}, categoryScores: {}, categoryResults: {} });

        const summary = getTrendSummary("overall", { limit: 10 });
        assert.equal(summary.direction, "declining");
        assert.ok(summary.delta < 0);
    });
});

test("getTrendSummary returns insufficient data for single point", () => {
    withTempHome(() => {
        saveResult({ id: "s1", createdAt: "2025-01-01T00:00:00.000Z", profile: "quick", overallScore: 70, overallGrade: "C", durationMs: 1000, machine: {}, categoryScores: {}, categoryResults: {} });

        const summary = getTrendSummary("overall", { limit: 10 });
        assert.equal(summary.trend, "insufficient data");
    });
});

// ─── Phase 6: Benchmark Intelligence ──────────────────────────────────

test("explainBenchmark produces structured Why/Matters/Affects output", () => {
    const result = {
        categoryScores: { cpu: 65 },
        categoryResults: { cpu: { compression: 700, jsonParse: 80 } },
        confidence: { cpu: { avgConfidence: 0.85, runs: 3 } }
    };
    const text = explainBenchmark("cpu", result);
    assert.ok(text.includes("CPU"));
    assert.ok(text.includes("Description"));
    assert.ok(text.includes("Why it matters"));
    assert.ok(text.includes("Score: 65/100"));
    assert.ok(text.includes("Confidence: 85%"));
    assert.ok(text.includes("What affects it"));
    assert.ok(text.includes("Build speed"));
    assert.ok(text.includes("Recommendation"));
});

test("explainBenchmark shows excellent status for high score", () => {
    const text = explainBenchmark("cpu", { categoryScores: { cpu: 95 }, categoryResults: {} });
    assert.ok(text.includes("Excellent"));
});

test("explainBenchmark returns error for unknown category", () => {
    const text = explainBenchmark("nonexistent", {});
    assert.ok(text.includes("Unknown category"));
});

test("explainBenchmarkResult produces full report with all categories", () => {
    const result = {
        overallScore: 75,
        overallGrade: "C",
        profile: "quick",
        durationMs: 15000,
        machine: { hostname: "test", os: "macOS 15", cpuModel: "M1", cpuCount: 8, totalMemoryGb: 16, freeMemoryGb: 8 },
        environment: { nodeVersion: "v20.0.0", shellType: "zsh" },
        categoryScores: { cpu: 70, disk: 80 },
        categoryResults: { cpu: { compression: 700 }, disk: { sequentialWrite: 500 } },
        slowest: { category: "cpu", score: 70 },
        fastest: { category: "disk", score: 80 },
        skipped: [{ category: "docker", reason: "docker not installed" }],
        qualityScore: { score: 85, grade: "B", coverage: 100, confidence: 90 }
    };
    const text = explainBenchmarkResult(result);
    assert.ok(text.includes("Benchmark Intelligence Report"));
    assert.ok(text.includes("Overall Score: 75/100"));
    assert.ok(text.includes("Machine: test"));
    assert.ok(text.includes("Slowest: CPU"));
    assert.ok(text.includes("Fastest: Disk"));
    assert.ok(text.includes("Skipped Categories"));
    assert.ok(text.includes("docker"));
    assert.ok(text.includes("Benchmark Quality: 85/100"));
});

// ─── Phase 8: Benchmark Quality Score ─────────────────────────────────

test("computeBenchmarkQuality returns high score for full coverage", () => {
    const q = computeBenchmarkQuality({
        totalCategories: 6,
        runCategories: 6,
        skipped: 0,
        confidenceData: {}
    });
    assert.ok(q.score >= 90);
    assert.equal(q.coverage, 100);
    assert.equal(q.stability, 100);
});

test("computeBenchmarkQuality penalizes skipped categories", () => {
    const q = computeBenchmarkQuality({
        totalCategories: 6,
        runCategories: 3,
        skipped: 3,
        confidenceData: {}
    });
    assert.ok(q.score < 90);
    assert.equal(q.coverage, 50);
    assert.ok(q.stability < 100);
});

test("computeBenchmarkQuality factors in confidence data", () => {
    const q = computeBenchmarkQuality({
        totalCategories: 6,
        runCategories: 6,
        skipped: 0,
        confidenceData: {
            cpu: { avgConfidence: 0.5, runs: 3 },
            disk: { avgConfidence: 0.6, runs: 3 }
        }
    });
    assert.ok(q.confidence < 100);
    assert.ok(q.confidence > 0);
});

// ─── Phase 3: Rich Report ─────────────────────────────────────────────

test("generateRichReport produces per-category report with scores", () => {
    const result = {
        overallScore: 80,
        overallGrade: "B",
        categoryScores: { cpu: 75, disk: 85 },
        categoryResults: { cpu: { compression: 600 }, disk: { sequentialWrite: 400 } }
    };
    const report = generateRichReport(result);
    assert.ok(report.includes("B 80/100"));
    assert.ok(report.includes("CPU"));
    assert.ok(report.includes("75/100"));
    assert.ok(report.includes("compression: 600ms"));
    assert.ok(report.includes("Disk"));
    assert.ok(report.includes("85/100"));
});

test("generateRichReport includes previous comparison when provided", () => {
    const result = {
        overallScore: 85,
        overallGrade: "B",
        categoryScores: { cpu: 80 },
        categoryResults: { cpu: { compression: 500 } }
    };
    const previous = {
        categoryScores: { cpu: 70 }
    };
    const report = generateRichReport(result, { previousResult: previous });
    assert.ok(report.includes("Previous: 70/100"));
    assert.ok(report.includes("Difference: +10"));
    assert.ok(report.includes("improved"));
});

test("generateRichReport includes recommendation for slow categories", () => {
    const result = {
        overallScore: 50,
        overallGrade: "F",
        categoryScores: { cpu: 40 },
        categoryResults: { cpu: { compression: 2000 } }
    };
    const report = generateRichReport(result);
    assert.ok(report.includes("Recommendation"));
    assert.ok(report.includes("background"));
});

// ─── Phase 9: History filtering and searching ─────────────────────────

test("listHistory filters by profile", () => {
    withTempHome(() => {
        saveResult({ id: "p1", createdAt: "2025-01-01T00:00:00.000Z", profile: "quick", overallScore: 80, overallGrade: "B", durationMs: 1000, machine: {}, categoryScores: {} });
        saveResult({ id: "p2", createdAt: "2025-02-01T00:00:00.000Z", profile: "full", overallScore: 70, overallGrade: "C", durationMs: 5000, machine: {}, categoryScores: {} });
        const quickOnly = listHistory({ filter: { profile: "quick" } });
        assert.equal(quickOnly.length, 1);
        assert.equal(quickOnly[0].id, "p1");
    });
});

test("listHistory filters by grade", () => {
    withTempHome(() => {
        saveResult({ id: "g1", createdAt: "2025-01-01T00:00:00.000Z", profile: "quick", overallScore: 90, overallGrade: "A", durationMs: 1000, machine: {}, categoryScores: {} });
        saveResult({ id: "g2", createdAt: "2025-02-01T00:00:00.000Z", profile: "quick", overallScore: 50, overallGrade: "F", durationMs: 1000, machine: {}, categoryScores: {} });
        const aOnly = listHistory({ filter: { grade: "A" } });
        assert.equal(aOnly.length, 1);
        assert.equal(aOnly[0].id, "g1");
    });
});

test("listHistory filters by score range", () => {
    withTempHome(() => {
        saveResult({ id: "r1", createdAt: "2025-01-01T00:00:00.000Z", profile: "quick", overallScore: 60, overallGrade: "D", durationMs: 1000, machine: {}, categoryScores: {} });
        saveResult({ id: "r2", createdAt: "2025-02-01T00:00:00.000Z", profile: "quick", overallScore: 90, overallGrade: "A", durationMs: 1000, machine: {}, categoryScores: {} });
        const highOnly = listHistory({ filter: { minScore: 80 } });
        assert.equal(highOnly.length, 1);
        assert.equal(highOnly[0].id, "r2");
    });
});

test("listHistory searches across id and machine", () => {
    withTempHome(() => {
        saveResult({ id: "search-1", createdAt: "2025-01-01T00:00:00.000Z", profile: "quick", overallScore: 80, overallGrade: "B", durationMs: 1000, machine: { hostname: "macbook-pro" }, categoryScores: {} });
        saveResult({ id: "search-2", createdAt: "2025-02-01T00:00:00.000Z", profile: "quick", overallScore: 70, overallGrade: "C", durationMs: 1000, machine: { hostname: "linux-box" }, categoryScores: {} });
        const results = listHistory({ search: "macbook" });
        assert.equal(results.length, 1);
        assert.equal(results[0].id, "search-1");
    });
});

test("listHistory supports sorting by score", () => {
    withTempHome(() => {
        saveResult({ id: "so1", createdAt: "2025-01-01T00:00:00.000Z", profile: "quick", overallScore: 60, overallGrade: "D", durationMs: 1000, machine: {}, categoryScores: {} });
        saveResult({ id: "so2", createdAt: "2025-02-01T00:00:00.000Z", profile: "quick", overallScore: 90, overallGrade: "A", durationMs: 1000, machine: {}, categoryScores: {} });
        const sorted = listHistory({ sortBy: "score", sortOrder: "desc" });
        assert.equal(sorted[0].id, "so2");
        assert.equal(sorted[1].id, "so1");
    });
});

test("listHistory supports limit", () => {
    withTempHome(() => {
        for (let i = 0; i < 5; i++) {
            saveResult({ id: `lim-${i}`, createdAt: new Date(Date.now() + i).toISOString(), profile: "quick", overallScore: 70, overallGrade: "C", durationMs: 1000, machine: {}, categoryScores: {} });
        }
        const limited = listHistory({ limit: 2 });
        assert.equal(limited.length, 2);
    });
});

// ─── BENCHMARK_METADATA ───────────────────────────────────────────────

test("BENCHMARK_METADATA has entries for all 12 categories", () => {
    const keys = Object.keys(BENCHMARK_METADATA);
    assert.equal(keys.length, 12);
    for (const key of keys) {
        const meta = BENCHMARK_METADATA[key];
        assert.ok(meta.label, `${key} should have label`);
        assert.ok(meta.description, `${key} should have description`);
        assert.ok(meta.why, `${key} should have why`);
        assert.ok(meta.affects, `${key} should have affects`);
        assert.ok(meta.expectedRange, `${key} should have expectedRange`);
        assert.ok(meta.recommendation, `${key} should have recommendation`);
    }
});
