import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCollections, getCollection } from "../src/core/registry.js";

test("the real registry/collections directory is all schema-valid", () => {
    const collections = loadCollections();
    assert.ok(collections.length >= 17, "expected at least the 17 documented collections");
    for (const c of collections) {
        assert.ok(c.name && c.description && Array.isArray(c.components) && c.components.length > 0);
    }
});

test("getCollection returns the minimal collection with its real members", () => {
    const minimal = getCollection("minimal");
    assert.ok(minimal.components.includes("git"));
    assert.ok(minimal.components.includes("vscode"));
});

test("getCollection throws a DevForgeError for an unknown collection", () => {
    assert.throws(() => getCollection("does-not-exist"), /Unknown collection/);
});
