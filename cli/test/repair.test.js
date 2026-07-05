import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    REPAIR_VERSION,
    REPAIR_DIR,
    planRepairs,
    saveRepairRecord,
    listHistory,
    getRepairRecord,
    deleteRepairRecord,
    cleanHistory,
    exportRecord,
    scanIssues,
    verifyRepairs,
    createRollbackPoint
} from "../src/core/repair.js";

// Point HOME at a scratch directory to isolate from the developer's real
// ~/.devforgekit (same pattern as snapshot.test.js and benchmark.test.js).
function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-test-"));
    process.env.HOME = tempHome;
    try {
        return fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

// ─── Constants ────────────────────────────────────────────────────────

test("REPAIR_VERSION is 1", () => {
    assert.equal(REPAIR_VERSION, 1);
});

test("REPAIR_DIR is 'repairs'", () => {
    assert.equal(REPAIR_DIR, "repairs");
});

// ─── planRepairs ──────────────────────────────────────────────────────

test("planRepairs returns empty plan for no issues", () => {
    const plan = planRepairs([]);
    assert.equal(plan.totalRepairs, 0);
    assert.equal(plan.totalInfo, 0);
    assert.deepEqual(plan.issues, []);
    assert.deepEqual(plan.informational, []);
});

test("planRepairs separates repairable from informational issues", () => {
    const issues = [
        { id: "1", severity: "CRITICAL", category: "test", subsystem: "test", description: "critical issue", fix: "fix it", estimatedTime: "5 min", dependencies: [] },
        { id: "2", severity: "WARNING", category: "test", subsystem: "test", description: "warning issue", fix: "fix it too", estimatedTime: "2 min", dependencies: [] },
        { id: "3", severity: "INFO", category: "test", subsystem: "test", description: "info issue", fix: "consider this", estimatedTime: "1 min", dependencies: [] }
    ];
    const plan = planRepairs(issues);
    assert.equal(plan.totalRepairs, 2);
    assert.equal(plan.totalInfo, 1);
    assert.equal(plan.informational.length, 1);
    assert.equal(plan.informational[0].id, "3");
});

test("planRepairs sorts by severity (critical first)", () => {
    const issues = [
        { id: "1", severity: "WARNING", category: "test", subsystem: "test", description: "warning", fix: "fix", estimatedTime: "2 min", dependencies: [] },
        { id: "2", severity: "CRITICAL", category: "test", subsystem: "test", description: "critical", fix: "fix", estimatedTime: "5 min", dependencies: [] }
    ];
    const plan = planRepairs(issues);
    assert.equal(plan.issues[0].severity, "CRITICAL");
    assert.equal(plan.issues[1].severity, "WARNING");
});

test("planRepairs respects dependency ordering", () => {
    const issues = [
        { id: "a", severity: "WARNING", category: "test", subsystem: "test", description: "depends on b", fix: "fix a", estimatedTime: "1 min", dependencies: ["b"] },
        { id: "b", severity: "WARNING", category: "test", subsystem: "test", description: "no deps", fix: "fix b", estimatedTime: "1 min", dependencies: [] }
    ];
    const plan = planRepairs(issues);
    // "b" should come before "a" because "a" depends on "b"
    const aIndex = plan.issues.findIndex((i) => i.id === "a");
    const bIndex = plan.issues.findIndex((i) => i.id === "b");
    assert.ok(bIndex < aIndex, "dependency should be repaired first");
});

test("planRepairs handles cycle in dependencies gracefully", () => {
    const issues = [
        { id: "a", severity: "WARNING", category: "test", subsystem: "test", description: "a", fix: "fix a", estimatedTime: "1 min", dependencies: ["b"] },
        { id: "b", severity: "WARNING", category: "test", subsystem: "test", description: "b", fix: "fix b", estimatedTime: "1 min", dependencies: ["a"] }
    ];
    // Should not hang or throw
    const plan = planRepairs(issues);
    assert.equal(plan.totalRepairs, 2);
});

test("planRepairs calculates estimated time", () => {
    const issues = [
        { id: "1", severity: "WARNING", category: "test", subsystem: "test", description: "a", fix: "fix", estimatedTime: "5 min", dependencies: [] },
        { id: "2", severity: "WARNING", category: "test", subsystem: "test", description: "b", fix: "fix", estimatedTime: "3 min", dependencies: [] }
    ];
    const plan = planRepairs(issues);
    assert.equal(plan.estimatedTime, "8 min");
});

test("planRepairs detects restart requirement", () => {
    const issues = [
        { id: "1", severity: "WARNING", category: "test", subsystem: "test", description: "a", fix: "fix", estimatedTime: "1 min", requiresRestart: true, dependencies: [] }
    ];
    const plan = planRepairs(issues);
    assert.equal(plan.requiresRestart, true);
});

// ─── saveRepairRecord / listHistory / getRepairRecord / deleteRepairRecord ─

test("saveRepairRecord writes a JSON file to ~/.devforgekit/repairs/", () => {
    withTempHome(() => {
        const record = {
            id: "test-repair-123",
            createdAt: new Date().toISOString(),
            issues: [],
            fixed: 0,
            failed: 0,
            skipped: 0,
            durationMs: 5000,
            machine: { hostname: "test" }
        };
        const filePath = saveRepairRecord(record);
        assert.ok(existsSync(filePath));
        assert.ok(filePath.endsWith("test-repair-123.json"));
    });
});

test("listHistory returns empty array when no repairs directory exists", () => {
    withTempHome(() => {
        const history = listHistory();
        assert.deepEqual(history, []);
    });
});

test("listHistory returns saved records sorted by date (newest first)", () => {
    withTempHome(() => {
        saveRepairRecord({
            id: "old-repair",
            createdAt: "2025-01-01T00:00:00.000Z",
            issues: [],
            fixed: 1,
            failed: 0,
            skipped: 0,
            durationMs: 3000
        });
        saveRepairRecord({
            id: "new-repair",
            createdAt: "2025-06-01T00:00:00.000Z",
            issues: [],
            fixed: 2,
            failed: 0,
            skipped: 0,
            durationMs: 5000
        });

        const history = listHistory();
        assert.equal(history.length, 2);
        assert.equal(history[0].id, "new-repair");
        assert.equal(history[1].id, "old-repair");
    });
});

test("getRepairRecord reads a saved repair record", () => {
    withTempHome(() => {
        const record = {
            id: "get-test",
            createdAt: new Date().toISOString(),
            issues: [{ id: "i1", severity: "WARNING", description: "test issue" }],
            fixed: 1,
            failed: 0,
            skipped: 0,
            durationMs: 2000,
            machine: { hostname: "test" }
        };
        saveRepairRecord(record);
        const loaded = getRepairRecord("get-test");
        assert.equal(loaded.id, "get-test");
        assert.equal(loaded.fixed, 1);
        assert.equal(loaded.issues.length, 1);
    });
});

test("getRepairRecord throws for non-existent id", () => {
    withTempHome(() => {
        assert.throws(
            () => getRepairRecord("nonexistent"),
            /not found/
        );
    });
});

test("deleteRepairRecord removes a repair record file", () => {
    withTempHome(() => {
        const record = {
            id: "delete-test",
            createdAt: new Date().toISOString(),
            issues: [],
            fixed: 0,
            failed: 0,
            skipped: 0,
            durationMs: 1000
        };
        const filePath = saveRepairRecord(record);
        assert.ok(existsSync(filePath));

        const deleted = deleteRepairRecord("delete-test");
        assert.equal(deleted, filePath);
        assert.ok(!existsSync(filePath));
    });
});

test("deleteRepairRecord throws for non-existent id", () => {
    withTempHome(() => {
        assert.throws(
            () => deleteRepairRecord("nonexistent"),
            /not found/
        );
    });
});

// ─── cleanHistory ─────────────────────────────────────────────────────

test("cleanHistory deletes all repair records", () => {
    withTempHome(() => {
        saveRepairRecord({ id: "r1", createdAt: "2025-01-01T00:00:00Z", issues: [], fixed: 0, failed: 0, skipped: 0, durationMs: 1000 });
        saveRepairRecord({ id: "r2", createdAt: "2025-02-01T00:00:00Z", issues: [], fixed: 0, failed: 0, skipped: 0, durationMs: 1000 });

        const result = cleanHistory();
        assert.equal(result.deleted, 2);

        const history = listHistory();
        assert.equal(history.length, 0);
    });
});

test("cleanHistory returns 0 when no repairs directory exists", () => {
    withTempHome(() => {
        const result = cleanHistory();
        assert.equal(result.deleted, 0);
    });
});

// ─── exportRecord ─────────────────────────────────────────────────────

test("exportRecord produces valid JSON", () => {
    const record = {
        id: "export-test",
        createdAt: "2025-01-01T00:00:00.000Z",
        durationMs: 5000,
        devforgekitVersion: "1.3.4",
        machine: { hostname: "test" },
        issues: [{ id: "i1", severity: "WARNING", category: "test", subsystem: "test", description: "test", fix: "fix it", estimatedTime: "1 min" }],
        fixed: 1,
        failed: 0,
        skipped: 0,
        repairResults: [{ issue: { description: "test" }, ok: true }],
        verification: { results: [{ check: "Compatibility", status: "PASS", score: 100 }], health: { score: 100, verdict: "Machine Ready" } }
    };
    const json = exportRecord(record, "json");
    const parsed = JSON.parse(json);
    assert.equal(parsed.id, "export-test");
    assert.equal(parsed.fixed, 1);
});

test("exportRecord produces valid Markdown", () => {
    const record = {
        id: "export-md",
        createdAt: "2025-01-01T00:00:00.000Z",
        durationMs: 5000,
        devforgekitVersion: "1.3.4",
        machine: { hostname: "test" },
        issues: [{ id: "i1", severity: "WARNING", category: "test", subsystem: "test", description: "test issue", fix: "fix it", estimatedTime: "1 min" }],
        fixed: 1,
        failed: 0,
        skipped: 0,
        repairResults: [{ issue: { description: "test issue" }, ok: true }],
        verification: { results: [{ check: "Compatibility", status: "PASS", score: 100 }], health: { score: 100, verdict: "Machine Ready" } },
        benchmarkBefore: { overallScore: 70, overallGrade: "C" },
        benchmarkAfter: { overallScore: 85, overallGrade: "B" }
    };
    const md = exportRecord(record, "markdown");
    assert.ok(md.includes("# Repair Report"));
    assert.ok(md.includes("## Summary"));
    assert.ok(md.includes("## Issues"));
    assert.ok(md.includes("## Repair Results"));
    assert.ok(md.includes("## Verification"));
    assert.ok(md.includes("## Benchmark Comparison"));
});

test("exportRecord produces valid HTML", () => {
    const record = {
        id: "export-html",
        createdAt: "2025-01-01T00:00:00.000Z",
        durationMs: 3000,
        devforgekitVersion: "1.3.4",
        machine: { hostname: "test" },
        issues: [{ id: "i1", severity: "CRITICAL", category: "test", subsystem: "test", description: "critical issue", fix: "fix it", estimatedTime: "5 min" }],
        fixed: 0,
        failed: 1,
        skipped: 0
    };
    const html = exportRecord(record, "html");
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("<title>Repair Report"));
    assert.ok(html.includes("critical issue"));
});

test("exportRecord produces valid CSV", () => {
    const record = {
        id: "export-csv",
        createdAt: "2025-01-01T00:00:00.000Z",
        durationMs: 3000,
        devforgekitVersion: "1.3.4",
        machine: { hostname: "test" },
        issues: [
            { id: "i1", severity: "WARNING", category: "path", subsystem: "shell", description: "missing dir", fix: "remove it", estimatedTime: "1 min" },
            { id: "i2", severity: "CRITICAL", category: "docker", subsystem: "docker", description: "daemon down", fix: "start docker", estimatedTime: "30 sec" }
        ],
        fixed: 1,
        failed: 1,
        skipped: 0
    };
    const csv = exportRecord(record, "csv");
    const lines = csv.trim().split("\n");
    assert.equal(lines[0], "id,severity,category,subsystem,description,fix,estimated_time");
    assert.ok(lines.length >= 3);
    assert.ok(lines[1].includes("i1,WARNING,path,shell"));
    assert.ok(lines[2].includes("i2,CRITICAL,docker,docker"));
});

test("exportRecord throws for unknown format", () => {
    const record = { id: "x", issues: [] };
    assert.throws(
        () => exportRecord(record, "xml"),
        /Unknown export format/
    );
});

// ─── Integration: scanIssues ──────────────────────────────────────────

test("scanIssues returns an array of issues", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-scan-"));
    process.env.HOME = tempHome;

    try {
        const issues = await scanIssues();
        assert.ok(Array.isArray(issues));
        // Each issue should have required fields
        for (const issue of issues) {
            assert.ok(issue.id, "issue should have an id");
            assert.ok(issue.severity, "issue should have a severity");
            assert.ok(issue.category, "issue should have a category");
            assert.ok(issue.subsystem, "issue should have a subsystem");
            assert.ok(issue.description, "issue should have a description");
        }
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

test("scanIssues calls onProgress callback", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-progress-"));
    process.env.HOME = tempHome;

    try {
        const progressCalls = [];
        await scanIssues({
            onProgress: (p) => progressCalls.push(p)
        });

        assert.ok(progressCalls.length > 0, "onProgress should be called");
        assert.ok(progressCalls.some((p) => p.status === "running" || p.status === "done"));
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

// ─── Integration: verifyRepairs ───────────────────────────────────────

test("verifyRepairs returns verification results with health score", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-verify-"));
    process.env.HOME = tempHome;

    try {
        const result = await verifyRepairs();

        assert.ok(result.results);
        assert.ok(Array.isArray(result.results));
        assert.ok(result.results.length > 0);
        assert.ok(result.health);
        assert.ok(typeof result.health.score === "number");

        // Should include key verification checks
        const checks = result.results.map((r) => r.check);
        assert.ok(checks.includes("Compatibility"));
        assert.ok(checks.includes("Health Score"));
        assert.ok(checks.includes("Workspaces"));
        assert.ok(checks.includes("Plugins"));
        assert.ok(checks.includes("Configuration"));
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

// ─── Integration: createRollbackPoint ─────────────────────────────────

test("createRollbackPoint creates a snapshot or returns null on failure", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-rollback-"));
    process.env.HOME = tempHome;

    try {
        const snapshot = await createRollbackPoint();
        // Either creates a snapshot (with id) or returns null if it can't
        if (snapshot) {
            assert.ok(snapshot.id);
            assert.ok(snapshot.archivePath);
        }
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

// ─── Integration: saveRepairRecord + listHistory + delete cycle ───────

test("saveRepairRecord + listHistory + deleteRepairRecord full cycle", () => {
    withTempHome(() => {
        const record = {
            id: "cycle-test",
            createdAt: new Date().toISOString(),
            issues: [{ id: "i1", severity: "WARNING", description: "test" }],
            fixed: 1,
            failed: 0,
            skipped: 0,
            durationMs: 3000,
            machine: { hostname: "test" }
        };
        saveRepairRecord(record);

        const history = listHistory();
        assert.equal(history.length, 1);
        assert.equal(history[0].id, "cycle-test");

        deleteRepairRecord("cycle-test");
        const afterDelete = listHistory();
        assert.equal(afterDelete.length, 0);
    });
});
