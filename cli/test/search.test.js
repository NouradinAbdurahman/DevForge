import { test } from "node:test";
import assert from "node:assert/strict";
import { searchPackages } from "../src/core/registry.js";

test("an exact name match ranks first", () => {
    const results = searchPackages("docker");
    assert.equal(results[0].pkg.name, "docker");
    assert.equal(results[0].matchedOn, "name");
});

test("an alias match finds the package by its alternate name", () => {
    const results = searchPackages("psql");
    assert.ok(results.some((r) => r.pkg.name === "postgres" && r.matchedOn === "alias"));
});

test("results are sorted by descending score", () => {
    const results = searchPackages("git");
    for (let i = 1; i < results.length; i++) {
        assert.ok(results[i - 1].score >= results[i].score);
    }
});

test("an unmatched query returns an empty array", () => {
    assert.deepEqual(searchPackages("zzz-does-not-exist-zzz"), []);
});
