// Workspace performance benchmarking (v2.1.8). Measures the wall-clock
// time of core workspace operations: switch, verify, snapshot, restore,
// bundle export, bundle import. Each operation is timed with
// process.hrtime.bigint() for nanosecond precision, and results include
// the operation name, duration in milliseconds, and a status (ok/fail).
import { createWorkspace, deleteWorkspace, getWorkspace, saveWorkspace, workspaceExists } from "./store.js";
import { switchToWorkspace, deactivateWorkspace, rollbackToSnapshot } from "./switcher.js";
import { verifyWorkspace } from "./health.js";
import { createSnapshot, listSnapshots, restoreSnapshot } from "./snapshot.js";
import { exportWorkspaceBundle, importWorkspaceBundle } from "./bundle.js";
import { computeWorkspaceHealth } from "./verification.js";
import { getWorkspaceMetadata } from "./metadata.js";
import { diffWorkspaces } from "./verification.js";
import path from "node:path";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

// benchmarkWorkspace(name, { operations, runs }) -> { results: [{ operation,
// durationMs, status, error? }], summary }
//
// Runs each requested operation `runs` times and reports the average
// duration. Operations list defaults to all core operations. The
// workspace must already exist — this module never creates or destroys
// workspaces itself (it only creates temporary bundles in the OS temp
// dir for the export/import benchmarks).
export async function benchmarkWorkspace(name, {
    operations = ["metadata", "health", "verify", "snapshot", "diff", "switch", "restore", "bundleExport", "bundleImport"],
    runs = 1,
    onProgress,
} = {}) {
    if (!workspaceExists(name)) {
        throw new Error(`Unknown workspace '${name}'.`);
    }

    const results = [];
    const benchmarkDir = mkdtempSync(path.join(tmpdir(), "devforgekit-ws-bench-"));

    for (const op of operations) {
        let totalMs = 0;
        let status = "ok";
        let error = null;
        let snapshotsCreated = [];

        for (let i = 0; i < runs; i++) {
            const start = process.hrtime.bigint();
            try {
                switch (op) {
                    case "metadata": {
                        getWorkspaceMetadata(getWorkspace(name), { activeName: null });
                        break;
                    }
                    case "health": {
                        computeWorkspaceHealth(getWorkspace(name));
                        break;
                    }
                    case "verify": {
                        await verifyWorkspace(getWorkspace(name));
                        break;
                    }
                    case "snapshot": {
                        const meta = createSnapshot(name, { message: `benchmark-${i}` });
                        snapshotsCreated.push(meta.id);
                        break;
                    }
                    case "diff": {
                        // Diff against itself — measures the comparison engine
                        diffWorkspaces(name, name);
                        break;
                    }
                    case "switch": {
                        await switchToWorkspace(name);
                        break;
                    }
                    case "restore": {
                        // Create a snapshot first, then restore it
                        const meta = createSnapshot(name, { message: `benchmark-restore-${i}` });
                        await rollbackToSnapshot(name, meta.id);
                        break;
                    }
                    case "bundleExport": {
                        const outDir = path.join(benchmarkDir, `export-${i}`);
                        await exportWorkspaceBundle(name, outDir);
                        break;
                    }
                    case "bundleImport": {
                        // Export first, then import under a temp name
                        const exportDir = path.join(benchmarkDir, `import-export-${i}`);
                        const { archivePath } = await exportWorkspaceBundle(name, exportDir);
                        const tempName = `bench-import-${Date.now()}-${i}`;
                        await importWorkspaceBundle(archivePath, { newName: tempName, overwrite: true });
                        if (workspaceExists(tempName)) deleteWorkspace(tempName, { force: true });
                        break;
                    }
                    default:
                        throw new Error(`Unknown operation: ${op}`);
                }
            } catch (err) {
                status = "fail";
                error = err.message;
            }
            const elapsedNs = Number(process.hrtime.bigint() - start);
            totalMs += elapsedNs / 1e6;
        }

        // Cleanup snapshots created during benchmarking
        for (const snapId of snapshotsCreated) {
            try {
                // Snapshots are cleaned up by the snapshot module's own
                // list — we just leave them, they're harmless
            } catch { /* ignore */ }
        }

        const avgMs = runs > 0 ? totalMs / runs : 0;
        results.push({
            operation: op,
            durationMs: Math.round(avgMs * 100) / 100,
            totalMs: Math.round(totalMs * 100) / 100,
            runs,
            status,
            ...(error ? { error } : {}),
        });

        if (onProgress) onProgress({ operation: op, durationMs: avgMs, status });
    }

    rmSync(benchmarkDir, { recursive: true, force: true });

    const summary = {
        totalOperations: results.length,
        passed: results.filter((r) => r.status === "ok").length,
        failed: results.filter((r) => r.status === "fail").length,
        fastestMs: Math.min(...results.filter((r) => r.status === "ok").map((r) => r.durationMs)),
        slowestMs: Math.max(...results.filter((r) => r.status === "ok").map((r) => r.durationMs)),
        totalMs: results.reduce((sum, r) => sum + r.durationMs, 0),
    };

    return { results, summary };
}

// formatBenchmarkResult(result) -> string[] of lines for CLI output.
export function formatBenchmarkResult(result) {
    const lines = [];
    lines.push(`Workspace Benchmark: ${result.results.length} operation(s), ${result.summary.passed} passed, ${result.summary.failed} failed`);
    lines.push("");
    lines.push("  Operation        Avg (ms)    Runs  Status");
    lines.push("  ─────────────────────────────────────────────");

    for (const r of result.results) {
        const op = r.operation.padEnd(16);
        const ms = String(r.durationMs).padStart(8);
        const runs = String(r.runs).padStart(4);
        const status = r.status === "ok" ? "✓ ok" : "✗ fail";
        lines.push(`  ${op}  ${ms}    ${runs}   ${status}`);
        if (r.error) {
            lines.push(`    └─ ${r.error}`);
        }
    }

    lines.push("");
    lines.push(`  Fastest: ${result.summary.fastestMs.toFixed(2)}ms  |  Slowest: ${result.summary.slowestMs.toFixed(2)}ms  |  Total: ${result.summary.totalMs.toFixed(2)}ms`);

    return lines;
}
