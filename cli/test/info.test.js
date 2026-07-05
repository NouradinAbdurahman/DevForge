import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPackages, getPackage } from "../src/core/registry.js";
import { findAlternatives, computeInstallSize } from "../src/commands/info.js";

test("findAlternatives returns other packages in the same category, excluding itself", () => {
    const allPackages = loadPackages();
    const postgres = getPackage("postgres");
    const alternatives = findAlternatives(postgres, allPackages);

    assert.ok(!alternatives.includes("postgres"));
    assert.ok(alternatives.length > 0, "expected at least one alternative in the (large) databases category");
    assert.ok(alternatives.length <= 5);
    for (const name of alternatives) {
        assert.equal(getPackage(name).category, "databases");
    }
});

test("findAlternatives returns an empty list for a package alone in its category", () => {
    const fixturePkg = { name: "solo", category: "solo-category" };
    const allPackages = [fixturePkg, { name: "other", category: "languages" }];
    assert.deepEqual(findAlternatives(fixturePkg, allPackages), []);
});

test("computeInstallSize returns null for a package with no brew-based install step", async () => {
    const fixturePkg = { install: { method: "shell", command: "true" } };
    assert.equal(await computeInstallSize(fixturePkg), null);
});

test("computeInstallSize returns null (not fabricated) for a real formula that isn't installed here", async () => {
    // Picks an obscure-enough formula that it's very unlikely to be
    // installed on the machine running this test, to exercise the
    // "not installed" path without depending on real install state.
    const fixturePkg = { install: { method: "brew-formula", id: "this-formula-does-not-exist-devforgekit-test" } };
    assert.equal(await computeInstallSize(fixturePkg), null);
});
