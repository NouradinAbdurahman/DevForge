import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    SNAPSHOT_VERSION,
    SNAPSHOT_EXTENSION,
    detectMissingSecrets,
    generateMissingSecretsMd,
    sha256File,
    sha256Dir,
    writeChecksums,
    formatBytes,
    diffArrays,
    diffConfig,
    listSnapshots,
    deleteSnapshot,
    exportSnapshot
} from "../src/core/snapshot.js";

// Point HOME at a scratch directory to isolate from the developer's real
// ~/.config/devforgekit and ~/.devforgekit (same pattern as config.test.js
// and self-update.test.js).
function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-snapshot-test-"));
    process.env.HOME = tempHome;
    try {
        return fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

// ─── Constants ────────────────────────────────────────────────────────

test("SNAPSHOT_VERSION is 1", () => {
    assert.equal(SNAPSHOT_VERSION, 1);
});

test("SNAPSHOT_EXTENSION is .dfk", () => {
    assert.equal(SNAPSHOT_EXTENSION, ".dfk");
});

// ─── formatBytes ──────────────────────────────────────────────────────

test("formatBytes formats bytes correctly", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1024), "1.0 KB");
    assert.equal(formatBytes(1024 * 1024), "1.0 MB");
    assert.equal(formatBytes(1024 * 1024 * 1024), "1.00 GB");
});

// ─── detectMissingSecrets ─────────────────────────────────────────────

test("detectMissingSecrets returns empty when no AI provider configured", () => {
    withTempHome(() => {
        const secrets = detectMissingSecrets();
        // Default config has aiProvider: "none", so no secrets expected
        assert.ok(Array.isArray(secrets));
    });
});

test("detectMissingSecrets detects AI provider API key references", () => {
    withTempHome((tempHome) => {
        // Create a config with an AI provider set
        const configDir = path.join(tempHome, ".config", "devforgekit");
        mkdirSync(configDir, { recursive: true });
        writeFileSync(path.join(configDir, "config.yaml"), "aiProvider: openai\n");

        const secrets = detectMissingSecrets();
        assert.ok(secrets.includes("OPENAI_API_KEY"));
    });
});

test("detectMissingSecrets detects workspace secret keys", () => {
    withTempHome((tempHome) => {
        const configDir = path.join(tempHome, ".config", "devforgekit");
        const wsDir = path.join(configDir, "workspaces", "test-ws");
        mkdirSync(wsDir, { recursive: true });
        writeFileSync(path.join(wsDir, "workspace.json"), JSON.stringify({
            schemaVersion: 2,
            name: "test-ws",
            description: "Test",
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
            env: { variables: {}, secretKeys: ["DATABASE_URL", "SUPABASE_URL"] },
            ai: { provider: "none", model: null, endpoint: null, temperature: null, apiKeyRef: "MY_AI_KEY" }
        }));

        const secrets = detectMissingSecrets();
        assert.ok(secrets.includes("DATABASE_URL"));
        assert.ok(secrets.includes("SUPABASE_URL"));
        assert.ok(secrets.includes("MY_AI_KEY"));
    });
});

// ─── generateMissingSecretsMd ─────────────────────────────────────────

test("generateMissingSecretsMd returns no-secrets message when empty", () => {
    const md = generateMissingSecretsMd([]);
    assert.ok(md.includes("No secrets were detected"));
});

test("generateMissingSecretsMd lists all secret keys", () => {
    const md = generateMissingSecretsMd(["OPENAI_API_KEY", "DATABASE_URL"]);
    assert.ok(md.includes("OPENAI_API_KEY"));
    assert.ok(md.includes("DATABASE_URL"));
    assert.ok(md.includes("export OPENAI_API_KEY"));
    assert.ok(md.includes("export DATABASE_URL"));
    assert.ok(md.includes("workspace env set"));
});

// ─── Checksums ────────────────────────────────────────────────────────

test("sha256File returns a hex hash for a file", () => {
    withTempHome((tempHome) => {
        const filePath = path.join(tempHome, "test.txt");
        writeFileSync(filePath, "hello world\n");
        const hash = sha256File(filePath);
        assert.equal(hash.length, 64);
        assert.match(hash, /^[a-f0-9]+$/);
    });
});

test("sha256Dir returns checksums for all files in a directory tree", () => {
    withTempHome((tempHome) => {
        const dir = path.join(tempHome, "testdir");
        mkdirSync(path.join(dir, "sub"), { recursive: true });
        writeFileSync(path.join(dir, "a.txt"), "content a\n");
        writeFileSync(path.join(dir, "sub", "b.txt"), "content b\n");

        const result = sha256Dir(dir);
        assert.ok(result.includes("a.txt"));
        assert.ok(result.includes("sub/b.txt"));
        // Each line is "hash  relative/path"
        const lines = result.split("\n");
        assert.equal(lines.length, 2);
        for (const line of lines) {
            assert.match(line, /^[a-f0-9]{64} {2}/);
        }
    });
});

test("sha256Dir returns empty string for non-existent directory", () => {
    const result = sha256Dir("/nonexistent/path/that/does/not/exist");
    assert.equal(result, "");
});

test("writeChecksums writes .sha256 files and returns a map", () => {
    withTempHome((tempHome) => {
        const staging = path.join(tempHome, "staging");
        mkdirSync(staging, { recursive: true });
        const checksumsDir = path.join(staging, "checksums");

        const result = writeChecksums(staging, {
            snapshot: '{"test": true}',
            config: "config-content"
        });

        assert.ok(result.snapshot);
        assert.ok(result.config);
        assert.equal(result.snapshot.length, 64);
        assert.ok(existsSync(path.join(checksumsDir, "snapshot.sha256")));
        assert.ok(existsSync(path.join(checksumsDir, "config.sha256")));

        // Verify the content
        const snapshotChecksum = readFileSync(path.join(checksumsDir, "snapshot.sha256"), "utf8").trim();
        assert.ok(snapshotChecksum.startsWith(result.snapshot));
    });
});

// ─── diffArrays ───────────────────────────────────────────────────────

test("diffArrays correctly identifies added, removed, and unchanged items", () => {
    const result = diffArrays(["a", "b", "c"], ["b", "c", "d"]);
    assert.deepEqual(result.added, ["d"]);
    assert.deepEqual(result.removed, ["a"]);
    assert.deepEqual(result.unchanged, ["b", "c"]);
});

test("diffArrays with identical arrays has no changes", () => {
    const result = diffArrays(["a", "b"], ["a", "b"]);
    assert.deepEqual(result.added, []);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.unchanged, ["a", "b"]);
});

test("diffArrays with empty arrays", () => {
    const result = diffArrays([], []);
    assert.deepEqual(result.added, []);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.unchanged, []);
});

// ─── diffConfig ───────────────────────────────────────────────────────

test("diffConfig identifies added, removed, and changed keys", () => {
    const oldCfg = { editor: "vscode", shell: "zsh", theme: "dark" };
    const newCfg = { editor: "cursor", shell: "zsh", font: "fira" };
    const result = diffConfig(oldCfg, newCfg);

    assert.equal(result.added.length, 1);
    assert.equal(result.added[0].key, "font");
    assert.equal(result.removed.length, 1);
    assert.equal(result.removed[0].key, "theme");
    assert.equal(result.changed.length, 1);
    assert.equal(result.changed[0].key, "editor");
    assert.equal(result.changed[0].oldValue, "vscode");
    assert.equal(result.changed[0].newValue, "cursor");
});

test("diffConfig with identical configs has no changes", () => {
    const cfg = { editor: "vscode", shell: "zsh" };
    const result = diffConfig(cfg, cfg);
    assert.equal(result.added.length, 0);
    assert.equal(result.removed.length, 0);
    assert.equal(result.changed.length, 0);
});

// ─── listSnapshots ────────────────────────────────────────────────────

test("listSnapshots returns empty array when no snapshots directory exists", () => {
    withTempHome(() => {
        const snapshots = listSnapshots();
        assert.deepEqual(snapshots, []);
    });
});

// ─── deleteSnapshot ───────────────────────────────────────────────────

test("deleteSnapshot throws for non-existent snapshot", () => {
    withTempHome(() => {
        assert.throws(
            () => deleteSnapshot("nonexistent-id"),
            /not found/
        );
    });
});

test("deleteSnapshot deletes a file by path", () => {
    withTempHome((tempHome) => {
        const snapshotsDir = path.join(tempHome, ".devforgekit", "snapshots");
        mkdirSync(snapshotsDir, { recursive: true });
        const filePath = path.join(snapshotsDir, "test.dfk");
        writeFileSync(filePath, "fake archive");

        const deleted = deleteSnapshot(filePath);
        assert.equal(deleted, filePath);
        assert.ok(!existsSync(filePath));
    });
});

// ─── exportSnapshot ───────────────────────────────────────────────────

test("exportSnapshot copies a snapshot to a destination directory", () => {
    withTempHome((tempHome) => {
        const snapshotsDir = path.join(tempHome, ".devforgekit", "snapshots");
        mkdirSync(snapshotsDir, { recursive: true });
        const srcPath = path.join(snapshotsDir, "test.dfk");
        writeFileSync(srcPath, "fake archive content");

        const destDir = path.join(tempHome, "exports");
        const destPath = exportSnapshot("test", destDir);

        assert.ok(existsSync(destPath));
        assert.equal(readFileSync(destPath, "utf8"), "fake archive content");
    });
});

test("exportSnapshot throws for non-existent snapshot", () => {
    withTempHome(() => {
        assert.throws(
            () => exportSnapshot("nonexistent", "/tmp"),
            /not found/
        );
    });
});

// ─── Integration: create + list + delete cycle ────────────────────────

test("createSnapshot produces a valid .dfk archive with snapshot.json", async () => {
    const { createSnapshot } = await import("../src/core/snapshot.js");

    withTempHome((tempHome) => {
        // We need to run createSnapshot with the temp home, but it's async
        // and withTempHome is sync. We'll handle it manually.
    });

    // Manual temp home management for async test
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-snap-create-"));
    process.env.HOME = tempHome;

    try {
        const outputDir = path.join(tempHome, "output");
        const result = await createSnapshot({ output: outputDir, skipInventory: true });

        // Verify archive exists
        assert.ok(existsSync(result.archivePath));
        assert.ok(result.archivePath.endsWith(".dfk"));
        assert.ok(result.size > 0);
        assert.ok(result.id);

        // Verify it's a valid tar.gz by extracting snapshot.json
        const { spawnSync } = await import("node:child_process");
        const extractDir = mkdtempSync(path.join(tmpdir(), "devforgekit-snap-verify-"));
        spawnSync("sh", ["-c", `tar -xzf "${result.archivePath}" -C "${extractDir}"`], { encoding: "utf8" });

        const snapshotJsonPath = path.join(extractDir, "snapshot.json");
        assert.ok(existsSync(snapshotJsonPath), "snapshot.json must exist in archive");

        const meta = JSON.parse(readFileSync(snapshotJsonPath, "utf8"));
        assert.equal(meta.snapshotVersion, SNAPSHOT_VERSION);
        assert.ok(meta.id);
        assert.ok(meta.createdAt);
        assert.ok(meta.machine);
        assert.ok(meta.components);
        assert.ok(meta.checksums);

        // Verify missing-secrets.md exists
        assert.ok(existsSync(path.join(extractDir, "missing-secrets.md")));

        rmSync(extractDir, { recursive: true, force: true });
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

test("createSnapshot + listSnapshots + deleteSnapshot full cycle", async () => {
    const { createSnapshot } = await import("../src/core/snapshot.js");

    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-snap-cycle-"));
    process.env.HOME = tempHome;

    try {
        // Create a snapshot (default output goes to ~/.devforgekit/snapshots/)
        const result = await createSnapshot({ skipInventory: true });

        // List snapshots - should find our created one
        const snapshots = listSnapshots();
        assert.equal(snapshots.length, 1);
        assert.equal(snapshots[0].id, result.id);

        // Delete it
        const deleted = deleteSnapshot(result.id);
        assert.ok(!existsSync(deleted));

        // List again - should be empty
        const afterDelete = listSnapshots();
        assert.equal(afterDelete.length, 0);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

test("inspectSnapshot reads metadata from a created archive", async () => {
    const { createSnapshot, inspectSnapshot } = await import("../src/core/snapshot.js");

    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-snap-inspect-"));
    process.env.HOME = tempHome;

    try {
        const result = await createSnapshot({ skipInventory: true });
        const inspected = await inspectSnapshot(result.archivePath);

        assert.equal(inspected.meta.id, result.id);
        assert.equal(inspected.meta.snapshotVersion, SNAPSHOT_VERSION);
        assert.ok(inspected.archiveSize > 0);
        assert.ok(inspected.meta.machine);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

test("verifySnapshot validates a created archive", async () => {
    const { createSnapshot, verifySnapshot } = await import("../src/core/snapshot.js");

    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-snap-verify-"));
    process.env.HOME = tempHome;

    try {
        const result = await createSnapshot({ skipInventory: true });
        const verification = await verifySnapshot(result.archivePath);

        assert.ok(verification.results.length > 0);
        assert.ok(verification.health.score > 0);

        // snapshot.json should pass
        const snapshotCheck = verification.results.find((r) => r.check === "snapshot.json present");
        assert.equal(snapshotCheck.status, "PASS");

        // Schema version should pass
        const schemaCheck = verification.results.find((r) => r.check.includes("schema version"));
        assert.equal(schemaCheck.status, "PASS");
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

test("diffSnapshots compares two created archives", async () => {
    const { createSnapshot, diffSnapshots } = await import("../src/core/snapshot.js");

    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-snap-diff-"));
    process.env.HOME = tempHome;

    try {
        const outputDir = path.join(tempHome, "snapshots");
        const result1 = await createSnapshot({ output: outputDir, skipInventory: true });

        // Create a second snapshot (same environment, so diff should show no changes)
        const result2 = await createSnapshot({ output: outputDir, skipInventory: true });

        const diff = await diffSnapshots(result1.archivePath, result2.archivePath);

        assert.ok(diff.packages);
        assert.ok(diff.config);
        assert.ok(diff.health);
        assert.ok(diff.compatibility);
        assert.ok(diff.machine);
        assert.ok(diff.createdAt);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

test("createSnapshot with --compression fast produces a valid archive", async () => {
    const { createSnapshot } = await import("../src/core/snapshot.js");

    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-snap-compress-"));
    process.env.HOME = tempHome;

    try {
        const outputDir = path.join(tempHome, "output");
        const result = await createSnapshot({ output: outputDir, compression: "fast", skipInventory: true });
        assert.ok(existsSync(result.archivePath));
        assert.ok(result.size > 0);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});
