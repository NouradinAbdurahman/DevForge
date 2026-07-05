import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCategories, loadPackages, loadCollections, loadProfiles, checkIntegrity, loadRegistry } from "../src/core/registry.js";

test("the whole real registry is referentially consistent (categories/dependencies/collections/profiles)", () => {
    // loadRegistry() throws with every problem listed at once if not -
    // asserting it doesn't throw is the actual integrity check; doNotThrow
    // isn't a real assert method, so call it and let a throw fail the test.
    const data = loadRegistry();
    assert.ok(data.packages.length > 0);
    assert.ok(data.categories.length > 0);
    assert.ok(data.collections.length > 0);
    assert.ok(data.profiles.length > 0);
});

test("checkIntegrity reports every problem in a deliberately broken fixture, not just the first", () => {
    const categories = [{ id: "languages", label: "Languages", description: "x" }];
    const packages = [
        { name: "foo", category: "does-not-exist-category", dependencies: ["missing-dep"], conflicts: ["missing-conflict"] }
    ];
    const collections = [
        { name: "bundle", description: "x", components: ["missing-member"] }
    ];
    const profiles = [
        { name: "myprofile", description: "x", collections: ["missing-collection"], components: ["missing-component"] }
    ];

    const problems = checkIntegrity({ categories, packages, collections, profiles });
    assert.equal(problems.length, 6);
    assert.ok(problems.some((p) => p.includes("unknown category")));
    assert.ok(problems.some((p) => p.includes("depends on unknown package")));
    assert.ok(problems.some((p) => p.includes("conflicts with unknown package")));
    assert.ok(problems.some((p) => p.includes("Collection 'bundle' references unknown package")));
    assert.ok(problems.some((p) => p.includes("Profile 'myprofile' references unknown collection")));
    assert.ok(problems.some((p) => p.includes("Profile 'myprofile' references unknown package")));
});

test("a clean fixture has zero integrity problems", () => {
    const categories = [{ id: "languages", label: "Languages", description: "x" }];
    const packages = [
        { name: "foo", category: "languages", dependencies: [], conflicts: [] },
        { name: "bar", category: "languages", dependencies: ["foo"], conflicts: [] }
    ];
    const collections = [{ name: "bundle", description: "x", components: ["foo", "bar"] }];
    const profiles = [{ name: "myprofile", description: "x", collections: ["bundle"], components: ["foo"] }];

    assert.deepEqual(checkIntegrity({ categories, packages, collections, profiles }), []);
});

test("every real category, package, collection, and profile loads independently too", () => {
    assert.ok(loadCategories().length >= 35);
    assert.ok(loadPackages().length >= 250);
    assert.ok(loadCollections().length >= 17);
    assert.ok(loadProfiles().length >= 49);
});
