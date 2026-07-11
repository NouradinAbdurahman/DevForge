import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectionsContaining, profilesContaining } from "../src/commands/explain.js";
import { dependentsOf } from "../src/core/environment/graph.js";

// collectionsContaining/profilesContaining read static, versioned repo
// YAML (registry/collections/, registry/profiles/) - not live machine
// state - so testing them against the real registry is safe and
// deterministic, the same reasoning registry-generate.test.js already
// relies on. dependentsOf() below still uses a scratch $HOME since it
// touches ~/.config/devforgekit/environment.json.
async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-explain-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

test("collectionsContaining() finds a real collection that lists a given component", () => {
    // The registry's own flutter collection is expected to list dart -
    // a stable fact about this repo's checked-in registry data.
    const collections = collectionsContaining("dart");
    assert.ok(Array.isArray(collections));
    assert.ok(collections.includes("flutter"), "the flutter collection should list dart as a component");
});

test("collectionsContaining() is injectable and returns [] for a name nothing references", () => {
    const fakeCollections = [{ name: "a", components: ["x", "y"] }, { name: "b", components: ["z"] }];
    assert.deepEqual(collectionsContaining("x", { collections: fakeCollections }), ["a"]);
    assert.deepEqual(collectionsContaining("nothing-references-this", { collections: fakeCollections }), []);
});

test("profilesContaining() resolves through collections, not just direct components", () => {
    // expandProfile() (used internally, not re-implemented here) resolves
    // a profile's `collections` via the REAL registry's getCollection(),
    // which isn't itself injectable - so this test wraps a synthetic
    // profile around the real, stable "flutter" collection (already
    // confirmed above to list "dart") rather than a synthetic collection
    // name expandProfile could never resolve.
    const fakeProfiles = [
        { name: "mobile-via-collection", collections: ["flutter"], components: [] },
        { name: "backend", collections: [], components: ["postgres"] }
    ];
    const forDart = profilesContaining("dart", { profiles: fakeProfiles });
    assert.ok(forDart.includes("mobile-via-collection"), "resolving through a real collection should surface its components");
    assert.ok(!forDart.includes("backend"));
});

test("profilesContaining() tolerates a profile that fails to expand (dangling reference) without throwing", () => {
    const brokenProfile = { name: "broken", collections: ["does-not-exist"], components: [] };
    assert.doesNotThrow(() => profilesContaining("dart", { profiles: [brokenProfile] }));
});

test("dependentsOf() (reused by explain's 'removing X will affect' section) reports the real flutter->dart edge", async () => {
    await withTempHome(() => {
        const state = { packages: { flutter: {}, dart: {} }, files: {}, generatedAt: null, version: 2 };
        const affected = dependentsOf("dart", state);
        assert.ok(affected.includes("flutter"), "flutter depends on dart in the real registry, so removing dart should list it");
    });
});
