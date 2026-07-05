import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkspace, saveWorkspace, getWorkspace, getActiveWorkspaceName } from "../src/core/workspace/store.js";
import { captureGitIdentity } from "../src/core/workspace/git.js";
import { createSnapshot, listSnapshots } from "../src/core/workspace/snapshot.js";
import { switchToWorkspace, deactivateWorkspace, rollbackToSnapshot } from "../src/core/workspace/switcher.js";

// Full-stack integration test: switching for real applies real global
// git config (see git.js's own test file for why HOME isolation makes
// this safe) and writes real files under the isolated $HOME - nothing
// here is mocked, matching plugin-sdk.test.js's philosophy.
async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-workspace-switcher-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

test("switchToWorkspace applies git identity live, writes the shell-export file, and moves the active pointer", async () => {
    await withTempHome(async () => {
        let docA = createWorkspace({ name: "acme-backend", description: "A" });
        docA.git = { ...docA.git, name: "Acme Bot", email: "bot@acme.example" };
        docA.shell.aliases = { deploy: "acme-deploy" };
        docA.env.variables = { NODE_ENV: "development" };
        saveWorkspace(docA);

        const { subsystems } = await switchToWorkspace("acme-backend");
        assert.equal(getActiveWorkspaceName(), "acme-backend");
        assert.ok(subsystems.git.every((r) => r.ok));

        const identity = await captureGitIdentity();
        assert.equal(identity.name, "Acme Bot");
        assert.equal(identity.email, "bot@acme.example");

        const shellFile = readFileSync(subsystems.shell.file, "utf8");
        assert.match(shellFile, /export NODE_ENV='development'/);
        assert.match(shellFile, /alias deploy='acme-deploy'/);
    });
});

test("switching workspaces re-applies git identity to match the newly-active one", async () => {
    await withTempHome(async () => {
        let docA = createWorkspace({ name: "acme-backend", description: "A" });
        docA.git = { ...docA.git, name: "Acme Bot", email: "bot@acme.example" };
        saveWorkspace(docA);

        let docB = createWorkspace({ name: "beta-frontend", description: "B" });
        docB.git = { ...docB.git, name: "Beta Bot", email: "bot@beta.example" };
        saveWorkspace(docB);

        await switchToWorkspace("acme-backend");
        assert.equal((await captureGitIdentity()).name, "Acme Bot");

        await switchToWorkspace("beta-frontend");
        assert.equal(getActiveWorkspaceName(), "beta-frontend");
        assert.equal((await captureGitIdentity()).name, "Beta Bot");
        assert.equal((await captureGitIdentity()).email, "bot@beta.example");
    });
});

test("switchToWorkspace throws for an unknown workspace without moving the active pointer", async () => {
    await withTempHome(async () => {
        createWorkspace({ name: "acme-backend", description: "x" });
        await switchToWorkspace("acme-backend");
        await assert.rejects(() => switchToWorkspace("does-not-exist"));
        assert.equal(getActiveWorkspaceName(), "acme-backend", "a failed switch must not disturb who's currently active");
    });
});

test("deactivateWorkspace clears the pointer and resets the shell-export file", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc.env.variables = { NODE_ENV: "development" };
        saveWorkspace(doc);
        const { subsystems } = await switchToWorkspace("acme-backend");

        deactivateWorkspace();
        assert.equal(getActiveWorkspaceName(), null);
        assert.equal(readFileSync(subsystems.shell.file, "utf8"), "# No active DevForgeKit workspace.\n");
    });
});

test("rollbackToSnapshot on the active workspace restores the document AND re-applies live state, with an automatic safety snapshot first", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme-backend", description: "x" });
        doc.git.email = "good@acme.example";
        saveWorkspace(doc);
        const good = createSnapshot("acme-backend", { message: "good state" });

        await switchToWorkspace("acme-backend");
        assert.equal((await captureGitIdentity()).email, "good@acme.example");

        let broken = getWorkspace("acme-backend");
        broken.git.email = "oops@acme.example";
        saveWorkspace(broken);
        await switchToWorkspace("acme-backend"); // simulate having applied the bad state live
        assert.equal((await captureGitIdentity()).email, "oops@acme.example");

        const rollback = await rollbackToSnapshot("acme-backend", good.id);
        assert.equal(rollback.applied, true);
        assert.equal(rollback.workspace.git.email, "good@acme.example");
        assert.equal((await captureGitIdentity()).email, "good@acme.example");

        const snapshots = listSnapshots("acme-backend");
        assert.ok(snapshots.some((s) => s.message.includes("Auto-snapshot before rolling back")));
    });
});

test("rollbackToSnapshot on an inactive workspace only reverts the stored document, leaving live state untouched", async () => {
    await withTempHome(async () => {
        let docA = createWorkspace({ name: "acme-backend", description: "A" });
        docA.git.email = "good@acme.example";
        saveWorkspace(docA);
        const good = createSnapshot("acme-backend");

        createWorkspace({ name: "beta-frontend", description: "B" });
        await switchToWorkspace("beta-frontend"); // acme-backend is now inactive

        let broken = getWorkspace("acme-backend");
        broken.git.email = "oops@acme.example";
        saveWorkspace(broken);

        const rollback = await rollbackToSnapshot("acme-backend", good.id);
        assert.equal(rollback.applied, false);
        assert.equal(rollback.workspace.git.email, "good@acme.example");
        assert.equal(getActiveWorkspaceName(), "beta-frontend", "rolling back an inactive workspace must not change who's active");
    });
});
