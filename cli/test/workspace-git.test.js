import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyWorkspaceGit, captureGitIdentity } from "../src/core/workspace/git.js";

// `git config --global` reads/writes $HOME/.gitconfig, so pointing HOME
// at a scratch directory is what makes these tests safe to run against
// the *real* git binary without touching the developer's actual global
// git identity - no mocking of git itself. Always async and always
// `await`ed (see plugin-sdk.test.js's comment on the un-awaited-callback
// pitfall this would otherwise hit).
async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-workspace-git-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

test("captureGitIdentity returns nulls/empty against a fresh, unconfigured $HOME", async () => {
    await withTempHome(async () => {
        const identity = await captureGitIdentity();
        assert.equal(identity.name, null);
        assert.equal(identity.email, null);
        assert.equal(identity.signingKey, null);
        assert.deepEqual(identity.aliases, {});
    });
});

test("applyWorkspaceGit sets name/email/branch/aliases/credential helper, then captureGitIdentity reads them back", async () => {
    await withTempHome(async () => {
        const results = await applyWorkspaceGit({
            git: {
                name: "Acme Bot", email: "bot@acme.example", signingKey: null, defaultBranch: "main",
                hooksPath: null, aliases: { co: "checkout", st: "status -sb" }, credentialHelper: "cache", lfs: false
            }
        });
        assert.ok(results.every((r) => r.ok), `expected every step to succeed: ${JSON.stringify(results)}`);

        const identity = await captureGitIdentity();
        assert.equal(identity.name, "Acme Bot");
        assert.equal(identity.email, "bot@acme.example");
        assert.equal(identity.defaultBranch, "main");
        assert.equal(identity.credentialHelper, "cache");
        assert.deepEqual(identity.aliases, { co: "checkout", st: "status -sb" });
    });
});

test("a signingKey turns on commit.gpgsign; clearing it turns commit.gpgsign back off", async () => {
    await withTempHome(async () => {
        await applyWorkspaceGit({ git: { name: null, email: null, signingKey: "ABCD1234", aliases: {} } });
        assert.equal((await captureGitIdentity()).signingKey, "ABCD1234");

        await applyWorkspaceGit({ git: { name: null, email: null, signingKey: null, aliases: {} } });
        assert.equal((await captureGitIdentity()).signingKey, null);
    });
});

test("applying null/empty fields unsets previously-set values instead of leaving them stale", async () => {
    await withTempHome(async () => {
        await applyWorkspaceGit({ git: { name: "Acme Bot", email: "bot@acme.example", aliases: {} } });
        await applyWorkspaceGit({ git: { name: null, email: "", aliases: {} } });
        const identity = await captureGitIdentity();
        assert.equal(identity.name, null);
        assert.equal(identity.email, null);
    });
});

test("aliases are additive/update-only: applying a workspace with no aliases never removes a previously-set one", async () => {
    await withTempHome(async () => {
        await applyWorkspaceGit({ git: { aliases: { co: "checkout" } } });
        await applyWorkspaceGit({ git: { aliases: {} } });
        assert.deepEqual((await captureGitIdentity()).aliases, { co: "checkout" });
    });
});

test("values containing shell-special characters (quotes) round-trip exactly", async () => {
    await withTempHome(async () => {
        await applyWorkspaceGit({ git: { name: "O'Brien's Bot", email: null, aliases: {} } });
        assert.equal((await captureGitIdentity()).name, "O'Brien's Bot");
    });
});

test("lfs: true reports a clear failure reason when git-lfs is not installed, without throwing", async () => {
    await withTempHome(async () => {
        const results = await applyWorkspaceGit({ git: { aliases: {}, lfs: true } });
        const lfsResult = results.find((r) => r.key === "lfs");
        // This machine may or may not actually have git-lfs installed;
        // either way applyWorkspaceGit must never throw over it.
        assert.ok(lfsResult.ok === true || lfsResult.reason === "git-lfs is not installed");
    });
});
