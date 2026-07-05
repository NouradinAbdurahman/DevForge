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
    benchmarkSummary
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

test("BENCHMARK_VERSION is 1", () => {
    assert.equal(BENCHMARK_VERSION, 1);
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
