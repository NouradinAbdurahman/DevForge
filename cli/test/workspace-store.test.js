import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    createWorkspace, getWorkspace, saveWorkspace, listWorkspaces, deleteWorkspace,
    renameWorkspace, cloneWorkspace, getActiveWorkspaceName, getActiveWorkspace,
    setActiveWorkspaceName, searchWorkspaces, workspaceExists, workspacesRoot
} from "../src/core/workspace/store.js";

// Every store.js function resolves paths from userConfigDir() (HOME-
// based, see core/paths.js), so pointing HOME at a scratch directory
// isolates these tests from the developer's real
// ~/.config/devforgekit/workspaces - same pattern config.test.js/
// plugin-sdk.test.js already use.
// Async (even though most bodies below are sync) and always `await`ed by
// its callers - see plugin-sdk.test.js's comment on this exact pitfall:
// an un-awaited `fn(tempHome)` would let `finally` restore the real HOME
// and delete the temp dir while an async callback is still mid-flight.
async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-workspace-store-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

test("createWorkspace persists a workspace.json under ~/.config/devforgekit/workspaces/<name>/", async () => {
    await withTempHome((tempHome) => {
        const doc = createWorkspace({ name: "acme-backend", description: "Acme backend", owner: "nouradin" });
        assert.equal(doc.name, "acme-backend");
        assert.ok(workspacesRoot().startsWith(tempHome));
        assert.ok(workspaceExists("acme-backend"));
        assert.deepEqual(getWorkspace("acme-backend"), doc);
    });
});

test("createWorkspace rejects a duplicate name and an invalid name", async () => {
    await withTempHome(() => {
        createWorkspace({ name: "acme-backend", description: "x" });
        assert.throws(() => createWorkspace({ name: "acme-backend", description: "y" }), /already exists/);
        assert.throws(() => createWorkspace({ name: "Not Valid" }), /Invalid workspace name/);
    });
});

test("getWorkspace throws a clear error for an unknown workspace", async () => {
    await withTempHome(() => {
        assert.throws(() => getWorkspace("does-not-exist"), /Unknown workspace/);
    });
});

test("saveWorkspace re-validates, persists changes, and stamps a fresh modifiedAt", async () => {
    await withTempHome(async () => {
        const doc = createWorkspace({ name: "acme-backend", description: "x" });
        const originalModifiedAt = doc.modifiedAt;
        doc.tags.push("client-acme");
        doc.git.email = "dev@acme.example";

        // Ensure the millisecond clock actually advances so modifiedAt is observably different.
        await new Promise((resolve) => setTimeout(resolve, 5));
        const saved = saveWorkspace(doc);

        assert.deepEqual(saved.tags, ["client-acme"]);
        assert.equal(saved.git.email, "dev@acme.example");
        assert.notEqual(saved.modifiedAt, originalModifiedAt);
        assert.deepEqual(getWorkspace("acme-backend"), saved);
    });
});

test("saveWorkspace refuses to save a workspace that was never created", async () => {
    await withTempHome(() => {
        const doc = createWorkspace({ name: "acme-backend", description: "x" });
        assert.throws(() => saveWorkspace({ ...doc, name: "never-created" }), /Cannot save unknown workspace/);
    });
});

test("listWorkspaces returns every workspace sorted by name, invalid ones included", async () => {
    await withTempHome(() => {
        createWorkspace({ name: "beta", description: "x" });
        createWorkspace({ name: "acme", description: "x" });
        mkdirSync(path.join(workspacesRoot(), "corrupt"), { recursive: true });
        writeFileSync(path.join(workspacesRoot(), "corrupt", "workspace.json"), "{ not valid json");

        const list = listWorkspaces();
        assert.deepEqual(list.map((w) => w.name), ["acme", "beta", "corrupt"]);
        assert.equal(list.find((w) => w.name === "corrupt").valid, false);
        assert.ok(list.find((w) => w.name === "corrupt").reason.includes("Failed to parse"));
    });
});

test("active-workspace pointer: get/set round-trip, and getActiveWorkspace resolves the full document", async () => {
    await withTempHome(() => {
        assert.equal(getActiveWorkspaceName(), null);
        assert.equal(getActiveWorkspace(), null);

        createWorkspace({ name: "acme-backend", description: "x" });
        setActiveWorkspaceName("acme-backend");
        assert.equal(getActiveWorkspaceName(), "acme-backend");
        assert.equal(getActiveWorkspace().name, "acme-backend");
    });
});

test("setActiveWorkspaceName rejects an unknown workspace and accepts null to clear", async () => {
    await withTempHome(() => {
        assert.throws(() => setActiveWorkspaceName("does-not-exist"), /Unknown workspace/);
        createWorkspace({ name: "acme-backend", description: "x" });
        setActiveWorkspaceName("acme-backend");
        setActiveWorkspaceName(null);
        assert.equal(getActiveWorkspaceName(), null);
    });
});

test("deleteWorkspace refuses to delete the active workspace unless forced", async () => {
    await withTempHome(() => {
        createWorkspace({ name: "acme-backend", description: "x" });
        setActiveWorkspaceName("acme-backend");
        assert.throws(() => deleteWorkspace("acme-backend"), /is the active workspace/);

        deleteWorkspace("acme-backend", { force: true });
        assert.equal(workspaceExists("acme-backend"), false);
        assert.equal(getActiveWorkspaceName(), null, "the pointer should clear once its target is force-deleted");
    });
});

test("renameWorkspace moves the directory, updates the document, and follows the active pointer", async () => {
    await withTempHome(() => {
        createWorkspace({ name: "old-name", description: "x" });
        setActiveWorkspaceName("old-name");
        const renamed = renameWorkspace("old-name", "new-name");
        assert.equal(renamed.name, "new-name");
        assert.equal(workspaceExists("old-name"), false);
        assert.equal(workspaceExists("new-name"), true);
        assert.equal(getActiveWorkspaceName(), "new-name");
    });
});

test("cloneWorkspace copies configuration but never secrets or snapshot history", async () => {
    await withTempHome(() => {
        const doc = createWorkspace({ name: "source", description: "x" });
        doc.tags = ["shared-tag"];
        saveWorkspace(doc);

        // Simulate what env.js/snapshot.js would have written, without importing them here.
        mkdirSync(path.join(workspacesRoot(), "source", "env"), { recursive: true });
        writeFileSync(path.join(workspacesRoot(), "source", "env", "secrets.enc.json"), "{}");
        writeFileSync(path.join(workspacesRoot(), "source", "env", "secret.key"), "fake-key");
        mkdirSync(path.join(workspacesRoot(), "source", "snapshots", "snap-1"), { recursive: true });

        const cloned = cloneWorkspace("source", "clone", { description: "a clone" });
        assert.deepEqual(cloned.tags, ["shared-tag"]);
        assert.equal(cloned.description, "a clone");
        assert.notEqual(cloned.createdAt, doc.createdAt);

        assert.ok(!existsSync(path.join(workspacesRoot(), "clone", "env", "secrets.enc.json")));
        assert.ok(!existsSync(path.join(workspacesRoot(), "clone", "env", "secret.key")));
        assert.ok(!existsSync(path.join(workspacesRoot(), "clone", "snapshots")));
    });
});

test("searchWorkspaces matches name, tag, git email, and cloud reference (invalid workspaces excluded)", async () => {
    await withTempHome(() => {
        let a = createWorkspace({ name: "acme-backend", description: "x" });
        a.tags = ["client-acme"];
        a.git.email = "dev@acme.example";
        a.cloud.aws.ref = "acme-prod";
        saveWorkspace(a);
        createWorkspace({ name: "beta-frontend", description: "y" });

        assert.deepEqual(searchWorkspaces("client-acme").map((d) => d.name), ["acme-backend"]);
        assert.deepEqual(searchWorkspaces("dev@acme.example").map((d) => d.name), ["acme-backend"]);
        assert.deepEqual(searchWorkspaces("acme-prod").map((d) => d.name), ["acme-backend"]);
        assert.deepEqual(searchWorkspaces("").map((d) => d.name).sort(), ["acme-backend", "beta-frontend"]);
        assert.deepEqual(searchWorkspaces("no-such-token"), []);
    });
});
