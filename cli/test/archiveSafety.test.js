// Regression tests for the tar "zip-slip" path-traversal fix:
// assertSafeTarArchive() lists an archive's entries (read-only) and
// refuses to proceed if any entry would escape the destination
// directory, before the real `tar -xzf` extraction ever runs. Every
// caller (workspace bundle import, plugin install, snapshot
// restore/diff/preview) used to extract straight to disk first and
// validate afterward, by which point a malicious entry had already been
// written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assertSafeTarArchive } from "../src/core/archiveSafety.js";

async function withTempDir(fn) {
    const dir = mkdtempSync(path.join(tmpdir(), "devforgekit-archive-safety-test-"));
    try {
        return await fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// buildTarWithEntry(entryName, content) -> path to a real .tar.gz built
// with GNU/BSD tar directly, containing exactly one entry with the given
// (possibly traversal) name. Using the real `tar` binary rather than a
// hand-rolled archive format keeps this test honest about what tools
// like `tar -tzf` actually report for a crafted entry name.
function buildTarWithEntry(workDir, entryName, content = "x") {
    const srcDir = path.join(workDir, "src");
    mkdirSync(srcDir, { recursive: true });
    const safeFileName = "payload.txt";
    writeFileSync(path.join(srcDir, safeFileName), content);

    const archivePath = path.join(workDir, "archive.tar.gz");
    // Build uncompressed first via `tar --transform` to rename the entry
    // to the traversal path we want to test, then gzip it - simpler and
    // more portable across GNU/BSD tar than trying to construct a tree
    // with literal ".." path segments on disk.
    const rawTar = path.join(workDir, "archive.tar");
    execFileSync("tar", ["-cf", rawTar, "-C", srcDir, safeFileName]);
    // Rewrite the single entry's name inside the tar header directly is
    // fiddly and non-portable; instead use `tar --transform` if available
    // (GNU tar) - macOS ships BSD tar which lacks --transform, so fall
    // back to building the archive from a real on-disk relative path
    // that already contains the traversal segments (tar happily stores
    // whatever relative path it's given).
    try {
        execFileSync("tar", ["--transform", `s,^${safeFileName}$,${entryName},`, "-czf", archivePath, "-C", srcDir, safeFileName]);
    } catch {
        // BSD tar fallback: create the traversal path for real on disk
        // (inside workDir, never touching anything outside it) and tar
        // that relative path directly.
        const fullTraversalPath = path.join(workDir, "layout", entryName);
        mkdirSync(path.dirname(fullTraversalPath), { recursive: true });
        writeFileSync(fullTraversalPath, content);
        execFileSync("tar", ["-czf", archivePath, "-C", path.join(workDir, "layout"), entryName]);
    }
    return archivePath;
}

test("assertSafeTarArchive accepts a normal, well-formed archive", async () => {
    await withTempDir(async (workDir) => {
        const archivePath = buildTarWithEntry(workDir, "payload.txt");
        const entries = await assertSafeTarArchive(archivePath);
        assert.ok(entries.includes("payload.txt"));
    });
});

test("assertSafeTarArchive rejects an entry with a '../' path-traversal segment", async () => {
    await withTempDir(async (workDir) => {
        const archivePath = buildTarWithEntry(workDir, "../../../../tmp/devforgekit-traversal-pwned.txt");
        await assert.rejects(
            () => assertSafeTarArchive(archivePath),
            /path-traversal|absolute path/
        );
    });
});

test("assertSafeTarArchive rejects an absolute path entry", async () => {
    await withTempDir(async (workDir) => {
        const archivePath = buildTarWithEntry(workDir, "/tmp/devforgekit-absolute-pwned.txt");
        await assert.rejects(
            () => assertSafeTarArchive(archivePath),
            /path-traversal|absolute path/
        );
    });
});

test("assertSafeTarArchive throws a clear error for a non-existent/corrupt archive", async () => {
    await withTempDir(async (workDir) => {
        const missing = path.join(workDir, "does-not-exist.tar.gz");
        await assert.rejects(() => assertSafeTarArchive(missing), /Could not read archive contents/);
    });
});

test("importWorkspaceBundle refuses a malicious bundle before extracting anything to disk", async () => {
    await withTempDir(async (workDir) => {
        const { importWorkspaceBundle } = await import("../src/core/workspace/bundle.js");
        const archivePath = buildTarWithEntry(workDir, "../../../../tmp/devforgekit-bundle-traversal-pwned.txt");
        const canaryPath = "/tmp/devforgekit-bundle-traversal-pwned.txt";
        await assert.rejects(() => importWorkspaceBundle(archivePath), /path-traversal|absolute path/);
        assert.equal(existsSync(canaryPath), false, "the traversal entry must never reach disk outside the extraction dir");
    });
});
