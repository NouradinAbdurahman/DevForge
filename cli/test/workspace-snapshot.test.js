import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkspace, saveWorkspace, getWorkspace } from "../src/core/workspace/store.js";
import {
    createSnapshot, listSnapshots, getSnapshotDoc, restoreSnapshot,
    deleteSnapshot, exportSnapshot, compareSnapshots, compareWithCurrent
} from "../src/core/workspace/snapshot.js";

async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-workspace-snapshot-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

test("createSnapshot records the document verbatim plus metadata, and listSnapshots sorts newest-first", async () => {
    await withTempHome(async () => {
        createWorkspace({ name: "acme-backend", description: "v1" });
        const s1 = createSnapshot("acme-backend", { message: "first" });

        // A snapshot id/createdAt only has millisecond resolution (real,
        // human-triggered snapshots are never this close together) - wait
        // for the clock to actually advance so "newest first" has an
        // unambiguous answer to sort by.
        await new Promise((resolve) => setTimeout(resolve, 5));
        let doc = getWorkspace("acme-backend");
        doc.tags.push("staging");
        saveWorkspace(doc);
        const s2 = createSnapshot("acme-backend", { message: "second" });

        assert.equal(s1.message, "first");
        assert.deepEqual(getSnapshotDoc("acme-backend", s1.id).tags, []);
        assert.deepEqual(getSnapshotDoc("acme-backend", s2.id).tags, ["staging"]);

        const list = listSnapshots("acme-backend");
        assert.deepEqual(list.map((s) => s.id), [s2.id, s1.id]);
    });
});

test("listSnapshots returns [] for a workspace with no snapshots yet", async () => {
    await withTempHome(async () => {
        createWorkspace({ name: "acme-backend", description: "x" });
        assert.deepEqual(listSnapshots("acme-backend"), []);
    });
});

test("getSnapshotDoc/restoreSnapshot/deleteSnapshot throw a clear error for an unknown id", async () => {
    await withTempHome(async () => {
        createWorkspace({ name: "acme-backend", description: "x" });
        assert.throws(() => getSnapshotDoc("acme-backend", "nope"), /Unknown snapshot/);
        assert.throws(() => restoreSnapshot("acme-backend", "nope"), /Unknown snapshot/);
        assert.throws(() => deleteSnapshot("acme-backend", "nope"), /Unknown snapshot/);
    });
});

test("restoreSnapshot reverts fields but always keeps the workspace's real name/createdAt", async () => {
    await withTempHome(async () => {
        const original = createWorkspace({ name: "acme-backend", description: "x" });
        const s1 = createSnapshot("acme-backend");

        let doc = getWorkspace("acme-backend");
        doc.git.email = "changed@acme.example";
        doc.tags.push("oops");
        saveWorkspace(doc);

        const restored = restoreSnapshot("acme-backend", s1.id);
        assert.equal(restored.name, "acme-backend");
        assert.equal(restored.createdAt, original.createdAt);
        assert.equal(restored.git.email, null);
        assert.deepEqual(restored.tags, []);
        // saveWorkspace() always re-stamps modifiedAt - already covered
        // (with a real clock-advance delay) by workspace-store.test.js.
    });
});

test("deleteSnapshot removes exactly that snapshot", async () => {
    await withTempHome(async () => {
        createWorkspace({ name: "acme-backend", description: "x" });
        const s1 = createSnapshot("acme-backend", { message: "keep" });
        const s2 = createSnapshot("acme-backend", { message: "delete-me" });

        deleteSnapshot("acme-backend", s2.id);
        assert.deepEqual(listSnapshots("acme-backend").map((s) => s.id), [s1.id]);
    });
});

test("exportSnapshot writes the recorded document to an arbitrary file path", async () => {
    await withTempHome(async (tempHome) => {
        createWorkspace({ name: "acme-backend", description: "x" });
        const s1 = createSnapshot("acme-backend");
        const dest = path.join(tempHome, "export.json");

        exportSnapshot("acme-backend", s1.id, dest);
        const exported = JSON.parse(readFileSync(dest, "utf8"));
        assert.equal(exported.name, "acme-backend");
    });
});

test("compareSnapshots/compareWithCurrent report added/removed/changed top-level keys", async () => {
    await withTempHome(async () => {
        createWorkspace({ name: "acme-backend", description: "x" });
        const s1 = createSnapshot("acme-backend");

        let doc = getWorkspace("acme-backend");
        doc.tags.push("staging");
        doc.git.email = "dev@acme.example";
        saveWorkspace(doc);
        const s2 = createSnapshot("acme-backend");

        const diff = compareSnapshots("acme-backend", s1.id, s2.id);
        assert.deepEqual(diff.added, []);
        assert.deepEqual(diff.removed, []);
        // Not asserting on 'modifiedAt' here - whether it differs between
        // s1/s2 depends on whether real wall-clock time crossed a
        // millisecond boundary between the two saveWorkspace() calls
        // above, which this test doesn't control.
        assert.ok(diff.changed.includes("git"));
        assert.ok(diff.changed.includes("tags"));

        doc = getWorkspace("acme-backend");
        doc.tags.push("prod");
        saveWorkspace(doc);
        const liveDiff = compareWithCurrent("acme-backend", s2.id);
        assert.ok(liveDiff.changed.includes("tags"));
        assert.ok(!liveDiff.changed.includes("git"), "git wasn't touched since s2");
    });
});
