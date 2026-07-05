import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeBlock, readBlock, hasBlock, removeBlock } from "../src/core/workspace/markerBlock.js";

function withTempFile(fn) {
    const dir = mkdtempSync(path.join(tmpdir(), "devforgekit-marker-block-test-"));
    try {
        return fn(path.join(dir, "config"));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test("writeBlock creates the file (and parent dir) with the block content", () => {
    withTempFile((file) => {
        writeBlock(file, "id-a", ["line one", "line two"]);
        const content = readFileSync(file, "utf8");
        assert.match(content, /# >>> DevForgeKit id-a >>>/);
        assert.match(content, /line one\nline two/);
        assert.match(content, /# <<< DevForgeKit id-a <<</);
    });
});

test("writeBlock preserves pre-existing, unrelated file content", () => {
    withTempFile((file) => {
        writeFileSync(file, "# user's own line\nHost foo\n");
        writeBlock(file, "id-a", ["Host bar"]);
        const content = readFileSync(file, "utf8");
        assert.match(content, /Host foo/);
        assert.match(content, /Host bar/);
    });
});

test("re-writing the same id is idempotent (never duplicates, always replaces)", () => {
    withTempFile((file) => {
        writeBlock(file, "id-a", ["v1"]);
        writeBlock(file, "id-a", ["v1"]);
        writeBlock(file, "id-a", ["v2"]);
        const content = readFileSync(file, "utf8");
        assert.equal((content.match(/# >>> DevForgeKit id-a >>>/g) || []).length, 1);
        assert.ok(!content.includes("v1"));
        assert.match(content, /v2/);
    });
});

test("multiple distinct ids coexist independently in the same file", () => {
    withTempFile((file) => {
        writeBlock(file, "id-a", ["a-content"]);
        writeBlock(file, "id-b", ["b-content"]);
        assert.equal(readBlock(file, "id-a"), "a-content");
        assert.equal(readBlock(file, "id-b"), "b-content");

        removeBlock(file, "id-a");
        assert.equal(readBlock(file, "id-a"), null);
        assert.equal(readBlock(file, "id-b"), "b-content");
    });
});

test("hasBlock/readBlock return false/null for a nonexistent file or id", () => {
    withTempFile((file) => {
        assert.equal(hasBlock(file, "id-a"), false);
        assert.equal(readBlock(file, "id-a"), null);
        writeBlock(file, "id-a", ["x"]);
        assert.equal(hasBlock(file, "id-a"), true);
        assert.equal(hasBlock(file, "id-b"), false);
    });
});

test("writeBlock includes header lines right after the begin marker", () => {
    withTempFile((file) => {
        writeBlock(file, "id-a", ["body"], { header: ["# managed, do not edit"] });
        const content = readFileSync(file, "utf8");
        assert.match(content, /# >>> DevForgeKit id-a >>>\n# managed, do not edit\nbody/);
    });
});

test("writeBlock({ backup: true }) backs up a pre-existing file only on its first-ever DevForgeKit edit", () => {
    withTempFile((file) => {
        writeFileSync(file, "original content\n");
        writeBlock(file, "id-a", ["x"], { backup: true });
        assert.ok(existsSync(`${file}.devforgekit-backup`));
        assert.equal(readFileSync(`${file}.devforgekit-backup`, "utf8"), "original content\n");

        rmSync(`${file}.devforgekit-backup`);
        writeBlock(file, "id-a", ["y"], { backup: true });
        assert.ok(!existsSync(`${file}.devforgekit-backup`), "should not re-backup once the file already has a DevForgeKit block");
    });
});

test("removeBlock returns false when there is nothing to remove", () => {
    withTempFile((file) => {
        assert.equal(removeBlock(file, "id-a"), false);
        writeFileSync(file, "no blocks here\n");
        assert.equal(removeBlock(file, "id-a"), false);
    });
});
