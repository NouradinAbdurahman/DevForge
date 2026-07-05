import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyWorkspaceSsh, removeWorkspaceSsh, readWorkspaceSshBlock, PROVIDER_DEFAULT_HOSTS } from "../src/core/workspace/ssh.js";

// ssh.js writes to $HOME/.ssh/config and reads/writes $HOME/.ssh/known_hosts
// via the real ssh-keygen/ssh-keyscan binaries - HOME is pointed at a
// scratch directory so these tests never touch the developer's real
// ~/.ssh. Always async/awaited (see plugin-sdk.test.js's note on this).
async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-workspace-ssh-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

test("PROVIDER_DEFAULT_HOSTS exposes the three well-known providers", () => {
    assert.deepEqual(PROVIDER_DEFAULT_HOSTS, { github: "github.com", gitlab: "gitlab.com", bitbucket: "bitbucket.org" });
});

test("applyWorkspaceSsh writes a Host block per identity, mode 0600, preserving pre-existing config content", async () => {
    await withTempHome(async (tempHome) => {
        const configPath = path.join(tempHome, ".ssh", "config");
        mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
        writeFileSync(configPath, "Host myhost\n  User me\n");

        const result = await applyWorkspaceSsh({
            name: "acme-backend",
            ssh: {
                identities: [
                    { provider: "github", host: "github.com", hostAlias: "github.com-acme", user: "git", identityFile: "~/.ssh/id_acme", port: null }
                ],
                knownHosts: []
            }
        });

        assert.equal(result.identities, 1);
        const content = readFileSync(configPath, "utf8");
        assert.match(content, /Host myhost/); // untouched
        assert.match(content, /Host github\.com-acme/);
        assert.match(content, /HostName github\.com/);
        assert.match(content, /IdentityFile ~\/\.ssh\/id_acme/);
        assert.equal((statSync(configPath).mode & 0o777).toString(8), "600");
    });
});

test("re-applying the same workspace is idempotent (no duplicate Host blocks)", async () => {
    await withTempHome(async () => {
        const workspace = { name: "acme-backend", ssh: { identities: [{ host: "github.com", hostAlias: "gh-acme", user: "git" }], knownHosts: [] } };
        await applyWorkspaceSsh(workspace);
        await applyWorkspaceSsh(workspace);
        const block = readWorkspaceSshBlock("acme-backend");
        assert.equal((block.match(/Host gh-acme/g) || []).length, 1);
    });
});

test("a workspace with no identities removes its own block instead of leaving a stale one", async () => {
    await withTempHome(async () => {
        await applyWorkspaceSsh({ name: "acme-backend", ssh: { identities: [{ host: "github.com", hostAlias: "gh-acme" }], knownHosts: [] } });
        assert.ok(readWorkspaceSshBlock("acme-backend"));
        await applyWorkspaceSsh({ name: "acme-backend", ssh: { identities: [], knownHosts: [] } });
        assert.equal(readWorkspaceSshBlock("acme-backend"), null);
    });
});

test("two workspaces' SSH blocks coexist independently", async () => {
    await withTempHome(async () => {
        await applyWorkspaceSsh({ name: "acme-backend", ssh: { identities: [{ host: "github.com", hostAlias: "gh-acme" }], knownHosts: [] } });
        await applyWorkspaceSsh({ name: "beta-frontend", ssh: { identities: [{ host: "gitlab.com", hostAlias: "gl-beta" }], knownHosts: [] } });

        assert.match(readWorkspaceSshBlock("acme-backend"), /gh-acme/);
        assert.match(readWorkspaceSshBlock("beta-frontend"), /gl-beta/);

        removeWorkspaceSsh("acme-backend");
        assert.equal(readWorkspaceSshBlock("acme-backend"), null);
        assert.ok(readWorkspaceSshBlock("beta-frontend"), "removing one workspace's block must not touch another's");
    });
});

test("ensureKnownHost recognizes an already-known host without shelling out to ssh-keyscan (no network)", async () => {
    await withTempHome(async (tempHome) => {
        const sshDir = path.join(tempHome, ".ssh");
        mkdirSync(sshDir, { recursive: true, mode: 0o700 });
        writeFileSync(path.join(sshDir, "known_hosts"), "internal.example.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAABAQCfakefakefakefake\n");

        const result = await applyWorkspaceSsh({ name: "acme-backend", ssh: { identities: [], knownHosts: ["internal.example.com"] } });
        assert.deepEqual(result.knownHosts, [{ host: "internal.example.com", status: "already-known" }]);
    });
});

test("removeWorkspaceSsh returns false when the workspace never had a block", async () => {
    await withTempHome(async () => {
        assert.equal(removeWorkspaceSsh("never-existed"), false);
    });
});
