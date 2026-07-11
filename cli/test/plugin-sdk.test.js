import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    createPlugin, testPlugin, buildPlugin, packagePlugin, publishPlugin, installPlugin
} from "../src/core/pluginSdk.js";
import { discoverPlugins, registerPluginEventHooks, registerPluginCommands } from "../src/core/plugins.js";
import { isPluginTrusted } from "../src/core/pluginTrust.js";
import { pluginEvents } from "../src/core/events.js";

// A real, local, no-network integration test: every step is exercised
// for real (real tar, real SHA-256, real Ed25519 signature, real
// extraction) - nothing here is mocked. HOME is pointed at a scratch
// directory so the signing key and ~/.devforgekit/plugins destination
// never touch the developer's real machine state (same pattern
// config.test.js/signing.test.js already use).
// `fn` is always async here, so this helper must itself be async and
// `await` the callback before the `finally` block restores HOME/deletes
// the temp dir - `return fn(tempHome)` without awaiting would let
// `finally` run immediately (fn returns a pending Promise synchronously),
// restoring the real HOME and deleting the temp dir *while the callback
// is still mid-flight*. That exact bug briefly leaked real writes to
// this machine's actual ~/.config/devforgekit and ~/.devforgekit during
// development of this test - caught and cleaned up before this shipped.
async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-plugin-sdk-test-"));
    try {
        process.env.HOME = tempHome;
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

test("full plugin lifecycle: create -> test -> build -> package -> install", async () => {
    await withTempHome(async (tempHome) => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-plugin-work-"));
        try {
            // 1. create
            const pluginDir = createPlugin("demo-plugin", workDir);
            assert.ok(existsSync(path.join(pluginDir, "plugin.yml")));
            assert.ok(existsSync(path.join(pluginDir, "commands", "hello.sh")));
            assert.ok(existsSync(path.join(pluginDir, "hooks", "after-install.sh")));
            assert.ok(existsSync(path.join(pluginDir, "tests", "manifest.test.sh")));

            // 2. test - the scaffolded plugin should pass its own tests out of the box
            const testResult = await testPlugin(pluginDir);
            const failed = testResult.results.filter((r) => r.status === "FAIL");
            assert.deepEqual(failed, [], `expected zero failures, got: ${JSON.stringify(failed)}`);
            assert.equal(testResult.score, 100);

            // 3. build
            const { lock } = await buildPlugin(pluginDir);
            assert.ok(existsSync(path.join(pluginDir, "plugin.lock.json")));
            assert.ok(Object.keys(lock.files).length > 0);
            const readme = readFileSync(path.join(pluginDir, "README.md"), "utf8");
            assert.match(readme, /demo-plugin/);

            // 4. package
            const { archivePath, checksum } = await packagePlugin(pluginDir);
            assert.ok(existsSync(archivePath));
            assert.ok(existsSync(`${archivePath}.sha256`));
            assert.ok(existsSync(`${archivePath}.sig`));
            assert.match(checksum, /^[0-9a-f]{64}$/);

            // 5. publish (local staging, not a hosted marketplace)
            const publishDestDir = mkdtempSync(path.join(tmpdir(), "devforgekit-plugin-publish-"));
            const { destArchive, indexPath } = publishPlugin(archivePath, publishDestDir);
            assert.ok(existsSync(destArchive));
            const index = JSON.parse(readFileSync(indexPath, "utf8"));
            assert.equal(index.length, 1);
            assert.equal(index[0].name, "demo-plugin");
            rmSync(publishDestDir, { recursive: true, force: true });

            // 6. install (from the local archive - self-signed, so trusted automatically)
            const { installedDir, manifest } = await installPlugin(archivePath);
            assert.equal(manifest.name, "demo-plugin");
            assert.ok(existsSync(path.join(installedDir, "plugin.yml")));
            assert.equal(installedDir, path.join(tempHome, ".devforgekit", "plugins", "demo-plugin"));

            // Now discoverable through the normal multi-root discovery path.
            const discovered = discoverPlugins().find((p) => p.name === "demo-plugin");
            assert.ok(discovered, "expected the installed plugin to be discoverable");
            assert.equal(discovered.valid, true);
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("installPlugin records trust, so registerPluginEventHooks wires its hooks; a manually-copied plugin of the same content is trusted too, but tampering after install is not", async () => {
    await withTempHome(async (tempHome) => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-plugin-trust-"));
        try {
            const pluginDir = createPlugin("trust-test", workDir);
            const { archivePath } = await packagePlugin(pluginDir);
            const { installedDir } = await installPlugin(archivePath);

            assert.equal(isPluginTrusted("trust-test", installedDir), true);

            const before = pluginEvents.listenerCount("install.afterInstall");
            registerPluginEventHooks([path.join(tempHome, ".devforgekit", "plugins")]);
            const afterTrusted = pluginEvents.listenerCount("install.afterInstall");
            assert.equal(afterTrusted, before + 1, "a trusted plugin's event hook must be wired to the bus");

            // Tampering with the installed plugin's content after the fact
            // (e.g. hand-editing the hook script) must invalidate trust -
            // the whole point is that content, not just the name, is what
            // was reviewed.
            const fs = await import("node:fs");
            fs.appendFileSync(path.join(installedDir, "hooks", "after-install.sh"), "\n# tampered\n");
            assert.equal(isPluginTrusted("trust-test", installedDir), false);

            pluginEvents.removeAllListeners("install.afterInstall");
            registerPluginEventHooks([path.join(tempHome, ".devforgekit", "plugins")]);
            assert.equal(pluginEvents.listenerCount("install.afterInstall"), 0, "a tampered plugin's event hook must not be wired");
        } finally {
            pluginEvents.removeAllListeners("install.afterInstall");
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("a plugin discovered but never installed via 'plugin install' has its event hooks skipped, but its commands still register (with a warning)", async () => {
    await withTempHome(async (tempHome) => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-plugin-untrusted-"));
        try {
            // Simulate bypassing `plugin install` entirely: hand-copy a
            // scaffolded plugin straight into the discovery root, the way
            // a synced dotfiles repo or a manual `cp` would.
            const pluginDir = createPlugin("untrusted-test", workDir);
            const destRoot = path.join(tempHome, ".devforgekit", "plugins");
            const fs = await import("node:fs");
            fs.mkdirSync(destRoot, { recursive: true });
            fs.cpSync(pluginDir, path.join(destRoot, "untrusted-test"), { recursive: true });

            assert.equal(isPluginTrusted("untrusted-test", path.join(destRoot, "untrusted-test")), false);

            const before = pluginEvents.listenerCount("install.afterInstall");
            registerPluginEventHooks([destRoot]);
            assert.equal(pluginEvents.listenerCount("install.afterInstall"), before, "an unreviewed plugin's event hook must never be wired");

            const { Command } = await import("commander");
            const program = new Command();
            registerPluginCommands(program, [destRoot]);
            assert.ok(program.commands.some((c) => c.name() === "hello"), "commands still register - only explicit, user-invoked execution, unlike unattended event hooks");
        } finally {
            pluginEvents.removeAllListeners("install.afterInstall");
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("installPlugin refuses a package whose checksum doesn't match (tampered/corrupted)", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-plugin-tamper-"));
        try {
            const pluginDir = createPlugin("tamper-test", workDir);
            const { archivePath } = await packagePlugin(pluginDir);

            // Corrupt the archive after the checksum was computed.
            const fs = await import("node:fs");
            fs.appendFileSync(archivePath, "corruption");

            await assert.rejects(() => installPlugin(archivePath), /Checksum mismatch/);
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("testPlugin reports a FAIL when a declared command script is missing", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-plugin-broken-"));
        try {
            const pluginDir = createPlugin("broken-plugin", workDir);
            rmSync(path.join(pluginDir, "commands", "hello.sh"));

            const { results } = await testPlugin(pluginDir);
            assert.ok(results.some((r) => r.status === "FAIL" && r.description.includes("hello")));
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});
