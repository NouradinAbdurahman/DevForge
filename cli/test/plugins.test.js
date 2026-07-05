import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { discoverPlugins, validatePluginManifest } from "../src/core/plugins.js";

const fixturesRoot = path.join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "plugin-bad-engine");

test("the real plugins/hello-world example is discovered and valid", () => {
    const plugins = discoverPlugins();
    const helloWorld = plugins.find((p) => p.name === "hello-world");
    assert.ok(helloWorld, "expected plugins/hello-world to be discovered");
    assert.equal(helloWorld.valid, true);
    assert.equal(helloWorld.manifest.commands[0].name, "hello");
});

test("a plugin requiring an incompatible engine range is marked invalid", () => {
    const plugins = discoverPlugins([fixturesRoot]);
    const incompatible = plugins.find((p) => p.name === "incompatible-plugin");
    assert.ok(incompatible, "expected incompatible-plugin fixture to be discovered");
    assert.equal(incompatible.valid, false);
    assert.match(incompatible.reason, /Requires DevForgeKit/);
});

test("a plugin manifest missing required fields is marked invalid", () => {
    const plugins = discoverPlugins([fixturesRoot]);
    const malformed = plugins.find((p) => p.name === "malformed-plugin");
    assert.ok(malformed, "expected malformed-plugin fixture to be discovered");
    assert.equal(malformed.valid, false);
    assert.match(malformed.reason, /Invalid manifest/);
});

// --- Compatibility Engine integration (v1.2.5): plugins may contribute
// rules instead of (or alongside) commands/events -----------------------

test("a plugin declaring only `rules` (no commands/events) is a valid manifest", () => {
    const manifest = {
        schemaVersion: 1,
        name: "docker-plus",
        version: "0.1.0",
        description: "Adds a docker version requirement",
        engine: ">=1.0.0",
        rules: { requires: { docker: ">=29" } }
    };
    assert.deepEqual(validatePluginManifest(manifest), { valid: true });
});

test("a plugin declaring none of commands/events/rules is still invalid", () => {
    const manifest = { schemaVersion: 1, name: "empty-plugin", version: "0.1.0", description: "x", engine: ">=1.0.0" };
    const result = validatePluginManifest(manifest);
    assert.equal(result.valid, false);
    assert.match(result.reason, /commands', 'events', or 'rules'/);
});

test("a plugin's `rules.requires` accepts both the plain-string and { version } shapes (rejects anything else)", () => {
    const ok = validatePluginManifest({
        schemaVersion: 1, name: "x", version: "0.1.0", description: "x", engine: ">=1.0.0",
        rules: { requires: { docker: ">=29", node: { version: ">=18" } } }
    });
    assert.equal(ok.valid, true);

    const bad = validatePluginManifest({
        schemaVersion: 1, name: "x", version: "0.1.0", description: "x", engine: ">=1.0.0",
        rules: { requires: { docker: 123 } }
    });
    assert.equal(bad.valid, false);
});
