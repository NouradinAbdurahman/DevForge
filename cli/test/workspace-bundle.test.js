import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkspace, saveWorkspace, getWorkspace, workspaceDir, workspaceExists } from "../src/core/workspace/store.js";
import { setSecret, getSecret } from "../src/core/workspace/env.js";
import { createSnapshot } from "../src/core/workspace/snapshot.js";
import { exportWorkspaceBundle, importWorkspaceBundle, repairWorkspace } from "../src/core/workspace/bundle.js";
import { captureShellCommand } from "../src/core/shell.js";

// A real, no-mocks integration test - real `tar`, real filesystem,
// nothing faked - same philosophy as plugin-sdk.test.js's packaging
// tests. HOME is isolated so nothing touches the developer's real
// ~/.config/devforgekit/workspaces.
async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-workspace-bundle-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

test("exportWorkspaceBundle produces a real tar.gz that excludes secrets and snapshot history", async () => {
    await withTempHome(async (tempHome) => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc.components = ["git"];
        doc = setSecret(doc, "API_KEY", "sk-super-secret");
        saveWorkspace(doc);
        createSnapshot("acme-backend", { message: "before export" });

        const outDir = path.join(tempHome, "exports");
        const { archivePath, meta } = await exportWorkspaceBundle("acme-backend", outDir);
        assert.ok(existsSync(archivePath));
        assert.equal(meta.name, "acme-backend");
        assert.equal(meta.workspaceSchemaVersion, 2); // bumped by the Compatibility Engine's `compatibility` field (v1.2.5)

        const { stdout } = await captureShellCommand(`tar -tzf "${archivePath}"`);
        assert.ok(!stdout.includes("secrets.enc.json"));
        assert.ok(!stdout.includes("secret.key"));
        assert.ok(!stdout.includes("snapshots/"));
        assert.ok(stdout.includes("acme-backend/workspace.json"));
        assert.ok(stdout.includes("acme-backend/bundle.json"));
    });
});

test("importWorkspaceBundle restores configuration but never secret values, and auto-repairs dangling references", async () => {
    await withTempHome(async (tempHome) => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc.profile = "figma";
        doc.collections = ["minimal", "totally-fake-collection"];
        doc = setSecret(doc, "API_KEY", "sk-super-secret");
        saveWorkspace(doc);

        const outDir = path.join(tempHome, "exports");
        const { archivePath } = await exportWorkspaceBundle("acme-backend", outDir);

        const result = await importWorkspaceBundle(archivePath, { newName: "acme-backend-restored" });
        assert.deepEqual(result.repairs, ["Removed unknown collection reference(s): totally-fake-collection"]);
        assert.equal(result.workspace.name, "acme-backend-restored");
        assert.equal(result.workspace.profile, "figma");
        assert.deepEqual(result.workspace.collections, ["minimal"]);
        assert.deepEqual(result.workspace.env.secretKeys, ["API_KEY"]);
        assert.equal(getSecret(result.workspace, "API_KEY"), null, "secret values must never travel in a bundle");

        assert.ok(!existsSync(path.join(workspaceDir("acme-backend-restored"), "bundle.json")), "the sidecar bundle.json must not linger in the imported workspace dir");
    });
});

test("importWorkspaceBundle refuses to clobber an existing workspace unless overwrite: true", async () => {
    await withTempHome(async (tempHome) => {
        createWorkspace({ name: "acme-backend", description: "x" });
        const { archivePath } = await exportWorkspaceBundle("acme-backend", path.join(tempHome, "exports"));

        await assert.rejects(() => importWorkspaceBundle(archivePath, {}), /already exists/);

        const overwritten = await importWorkspaceBundle(archivePath, { overwrite: true });
        assert.equal(overwritten.workspace.name, "acme-backend");
    });
});

test("importWorkspaceBundle throws a clear error for a missing archive", async () => {
    await withTempHome(async (tempHome) => {
        await assert.rejects(() => importWorkspaceBundle(path.join(tempHome, "nope.tar.gz"), {}), /No such file/);
    });
});

test("repairWorkspace drops dangling profile/recipe/component/plugin references from a live workspace and reports them", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc.profile = "totally-fake-profile-xyz";
        doc.recipes = ["totally-fake-recipe-xyz"];
        doc.components = ["git", "totally-fake-component-xyz"];
        doc.plugins = ["totally-fake-plugin-xyz"];
        saveWorkspace(doc);

        const { workspace, repairs } = repairWorkspace("acme-backend");
        assert.equal(workspace.profile, null);
        assert.deepEqual(workspace.recipes, []);
        assert.deepEqual(workspace.components, ["git"]);
        assert.deepEqual(workspace.plugins, []);
        assert.equal(repairs.length, 4);

        // Persisted, not just returned in-memory.
        assert.deepEqual(getWorkspace("acme-backend").components, ["git"]);
    });
});

test("repairWorkspace is a no-op (no save, empty repairs) when every reference is already valid", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc.components = ["git"];
        saveWorkspace(doc);
        const before = getWorkspace("acme-backend").modifiedAt;

        const { workspace, repairs } = repairWorkspace("acme-backend");
        assert.deepEqual(repairs, []);
        assert.equal(workspace.modifiedAt, before, "a no-op repair should not even re-save the document");
        assert.ok(workspaceExists("acme-backend"));
    });
});
