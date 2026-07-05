import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
    loadRecipes,
    getRecipe,
    expandRecipe,
    validateRecipeDoc,
    checkIntegrity,
    loadRegistry,
    getRegistryStats
} from "../src/core/registry.js";

const fixturesDir = path.join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "recipes-bad");

test("the real registry/recipes directory is all schema-valid and non-empty", () => {
    const recipes = loadRecipes();
    assert.ok(recipes.length >= 8, "expected at least the 8 documented recipes");
    for (const r of recipes) {
        assert.ok(r.name && r.description);
        assert.ok((r.collections && r.collections.length > 0) || (r.components && r.components.length > 0));
    }
});

test("a recipe declaring neither collections nor components is rejected", () => {
    assert.throws(() => loadRecipes([fixturesDir]), /must declare at least one/);
});

test("getRecipe returns the 'ai-engineer' recipe with its collections and configure/verify steps", () => {
    const r = getRecipe("ai-engineer");
    assert.deepEqual(r.collections.sort(), ["machine-learning", "python-ai"]);
    assert.ok(r.configure.includes("git"));
    assert.equal(r.verify, true);
});

test("getRecipe throws a DevForgeError for an unknown recipe", () => {
    assert.throws(() => getRecipe("does-not-exist"), /Unknown recipe/);
});

test("expandRecipe resolves a recipe's collections and ad hoc components (shared expandProfile logic)", () => {
    const r = getRecipe("devops-engineer");
    const components = expandRecipe(r);
    assert.ok(components.includes("terraform"), "expected a component from the 'devops' collection");
    assert.ok(components.includes("helm"), "expected an ad hoc component");
});

test("expandRecipe dedupes across overlapping collections and extra components", () => {
    const fixture = {
        name: "fixture",
        description: "x",
        collections: ["minimal"], // -> git, vscode
        components: ["git", "docker"] // git overlaps, docker is new
    };
    assert.deepEqual(expandRecipe(fixture).sort(), ["docker", "git", "vscode"]);
});

test("validateRecipeDoc accepts a well-formed ad hoc recipe and rejects malformed ones", () => {
    assert.doesNotThrow(() => validateRecipeDoc({ schemaVersion: 1, name: "x", description: "y", components: ["git"] }));
    assert.throws(() => validateRecipeDoc({ schemaVersion: 1, name: "x", description: "y" }), /must declare at least one/);
    assert.throws(() => validateRecipeDoc({ name: "bad name with spaces", description: "y", components: ["git"] }));
});

test("validateRecipeDoc rejects a configure step outside the known enum", () => {
    assert.throws(
        () => validateRecipeDoc({ schemaVersion: 1, name: "x", description: "y", components: ["git"], configure: ["not-a-real-action"] }),
        /Invalid recipe/
    );
});

test("checkIntegrity flags a recipe referencing an unknown collection/component, alongside profile problems", () => {
    const categories = [{ id: "languages", label: "Languages", description: "x" }];
    const packages = [{ name: "git", category: "languages", dependencies: [], conflicts: [] }];
    const collections = [{ name: "bundle", description: "x", components: ["git"] }];
    const recipes = [
        { name: "myrecipe", description: "x", collections: ["missing-collection"], components: ["missing-component"] }
    ];

    const problems = checkIntegrity({ categories, packages, collections, recipes });
    assert.equal(problems.length, 2);
    assert.ok(problems.some((p) => p.includes("Recipe 'myrecipe' references unknown collection 'missing-collection'")));
    assert.ok(problems.some((p) => p.includes("Recipe 'myrecipe' references unknown package 'missing-component'")));
});

test("a clean recipe fixture has zero integrity problems", () => {
    const categories = [{ id: "languages", label: "Languages", description: "x" }];
    const packages = [{ name: "git", category: "languages", dependencies: [], conflicts: [] }];
    const collections = [{ name: "bundle", description: "x", components: ["git"] }];
    const recipes = [{ name: "myrecipe", description: "x", components: ["git"] }];
    assert.deepEqual(checkIntegrity({ categories, packages, collections, recipes }), []);
});

test("the whole real registry (including recipes) is referentially consistent", () => {
    const data = loadRegistry();
    assert.ok(data.recipes.length >= 8);
});

test("registry stats include recipe totals and count recipes toward the largest-bundle/orphan computations", () => {
    const data = loadRegistry();
    const stats = getRegistryStats(data);
    assert.equal(stats.totalRecipes, data.recipes.length);
    assert.ok(stats.totalRecipes > 0);
});
