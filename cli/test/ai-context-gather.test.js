import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gatherContext } from "../src/core/ai/context/gather.js";

function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-ai-context-test-"));
    process.env.HOME = tempHome;
    return async () => {
        try {
            await fn(tempHome);
        } finally {
            process.env.HOME = originalHome;
            rmSync(tempHome, { recursive: true, force: true });
        }
    };
}

test("gatherContext() reports this real repo as a git repo with a real branch, without any provider/network call", async () => {
    await withTempHome(async () => {
        const context = await gatherContext({ cwd: process.cwd() });
        assert.equal(context.git.isRepo, true);
        assert.equal(typeof context.git.branch, "string");
        assert.ok(context.git.branch.length > 0);
        assert.equal(typeof context.git.changedFiles, "number");
        assert.equal(context.workspace, null); // no active workspace in a fresh temp HOME
        assert.equal(context.config.aiProvider, "none");
    })();
});

test("gatherContext() reports isRepo: false for a directory that isn't a git repo", async () => {
    await withTempHome(async (tempHome) => {
        const plainDir = path.join(tempHome, "not-a-repo");
        await import("node:fs").then((fs) => fs.mkdirSync(plainDir, { recursive: true }));
        const context = await gatherContext({ cwd: plainDir });
        assert.deepEqual(context.git, { isRepo: false });
    })();
});

test("gatherContext({ full: true }) additionally includes installedComponents and a real compatibility scan", async () => {
    await withTempHome(async () => {
        const context = await gatherContext({ full: true, cwd: process.cwd() });
        assert.ok(Array.isArray(context.installedComponents));
        assert.ok(context.compatibility);
        assert.equal(typeof context.compatibility.score, "number");
        assert.equal(typeof context.compatibility.verdict, "string");
    })();
});

test("gatherContext() defaults to a fast, non-full gather (no installedComponents/compatibility fields)", async () => {
    await withTempHome(async () => {
        const context = await gatherContext({ cwd: process.cwd() });
        assert.equal(context.installedComponents, undefined);
        assert.equal(context.compatibility, undefined);
    })();
});
