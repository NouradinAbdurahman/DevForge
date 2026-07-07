import { test } from "node:test";
import assert from "node:assert/strict";
import { getRegistryStats, loadRegistry } from "../src/core/registry.js";

const categories = [{ id: "languages", label: "Languages", description: "x" }];

test("detects two packages claiming the same alias", () => {
    const packages = [
        { name: "foo", category: "languages", aliases: ["shared"] },
        { name: "bar", category: "languages", aliases: ["shared"] },
        { name: "baz", category: "languages", aliases: [] }
    ];
    const stats = getRegistryStats({ categories, packages, collections: [], profiles: [] });
    assert.equal(stats.duplicateAliases.length, 1);
    assert.equal(stats.duplicateAliases[0].alias, "shared");
    assert.deepEqual(stats.duplicateAliases[0].owners.sort(), ["bar", "foo"]);
});

test("flags packages not referenced by any collection or profile as orphaned", () => {
    const packages = [
        { name: "foo", category: "languages" },
        { name: "bar", category: "languages" }
    ];
    const collections = [{ name: "bundle", description: "x", components: ["foo"] }];
    const stats = getRegistryStats({ categories, packages, collections, profiles: [] });
    assert.deepEqual(stats.orphaned, ["bar"]);
});

test("a package referenced only via a profile is not orphaned", () => {
    const packages = [{ name: "foo", category: "languages" }];
    const profiles = [{ name: "p", description: "x", components: ["foo"] }];
    const stats = getRegistryStats({ categories, packages, collections: [], profiles });
    assert.deepEqual(stats.orphaned, []);
});

test("computes dependency edge count and the most-depended-upon package", () => {
    const packages = [
        { name: "a", category: "languages", dependencies: [] },
        { name: "b", category: "languages", dependencies: ["a"] },
        { name: "c", category: "languages", dependencies: ["a"] }
    ];
    const stats = getRegistryStats({ categories, packages, collections: [], profiles: [] });
    assert.equal(stats.dependencyEdges, 2);
    assert.equal(stats.mostDependedUpon.name, "a");
    assert.equal(stats.mostDependedUpon.count, 2);
});

test("finds the largest bundle across collections and profiles", () => {
    const packages = [
        { name: "a", category: "languages" }, { name: "b", category: "languages" }, { name: "c", category: "languages" }
    ];
    const collections = [{ name: "small", description: "x", components: ["a"] }];
    const profiles = [{ name: "big", description: "x", components: ["a", "b", "c"] }];
    const stats = getRegistryStats({ categories, packages, collections, profiles });
    assert.equal(stats.largestBundle.kind, "profile");
    assert.equal(stats.largestBundle.name, "big");
    assert.equal(stats.largestBundle.size, 3);
});

test("metadata completeness score reflects homepage/license/tags presence", () => {
    const packages = [
        { name: "a", category: "languages", homepage: "x", license: "MIT", tags: ["x"] },
        { name: "b", category: "languages" }
    ];
    const stats = getRegistryStats({ categories, packages, collections: [], profiles: [] });
    assert.equal(stats.metadataCompletenessScore, 50);
});

test("the real registry has zero duplicate aliases and reports a sensible metadata score", () => {
    const data = loadRegistry();
    const stats = getRegistryStats(data);
    assert.deepEqual(stats.duplicateAliases, []);
    assert.ok(stats.metadataCompletenessScore > 0);
});

test("quality score is the average per-package Manifest Quality Score (core/quality.js's scoreManifest)", () => {
    const packages = [
        // 2 of 13 checks pass: schema valid (always) + documentation exists -> round(2/13*100) = 15
        { name: "a", category: "languages", documentation: "x" },
        // 1 of 13 checks pass: schema valid only -> round(1/13*100) = 8
        { name: "b", category: "languages" }
    ];
    const stats = getRegistryStats({ categories, packages, collections: [], profiles: [] });
    assert.equal(stats.qualityScore, 12); // round(average of 15 and 8)
});

test("ciVerifiedCount counts only packages explicitly marked ciVerified", () => {
    const packages = [
        { name: "a", category: "languages", ciVerified: true },
        { name: "b", category: "languages", ciVerified: false },
        { name: "c", category: "languages" }
    ];
    const stats = getRegistryStats({ categories, packages, collections: [], profiles: [] });
    assert.equal(stats.ciVerifiedCount, 1);
});

test("the real registry reports a quality score and exactly 5 CI-verified components (the registry-smoke.yml allowlist)", () => {
    const data = loadRegistry();
    const stats = getRegistryStats(data);
    assert.ok(stats.qualityScore >= 0 && stats.qualityScore <= 100);
    assert.equal(stats.ciVerifiedCount, 5);
});
