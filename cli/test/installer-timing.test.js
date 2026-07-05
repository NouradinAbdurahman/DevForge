import { test } from "node:test";
import assert from "node:assert/strict";
import { installPlan } from "../src/core/installer.js";

// Fixture packages only - no real installs. "install time" is measured
// live (see docs/PlatformArchitecture.md's Package Quality System
// section) rather than stored as a static, fabricated field, so these
// tests exercise the timing itself rather than any manifest data.
const fixturePackages = [
    { name: "slow-thing", install: { method: "shell", command: "sleep 0.05" } },
    { name: "already-installed-thing", install: { method: "shell", command: "true" }, validate: "true" }
];

test("installPlan reports a positive elapsed duration for a real (fixture) install", async () => {
    const { results } = await installPlan(["slow-thing"], { packages: fixturePackages });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "installed");
    assert.ok(results[0].durationMs >= 40, `expected at least ~50ms, got ${results[0].durationMs}ms`);
});

test("installPlan reports durationMs: 0 for an already-satisfied (skipped) step", async () => {
    const { results } = await installPlan(["already-installed-thing"], { packages: fixturePackages });
    assert.equal(results[0].status, "skipped");
    assert.equal(results[0].durationMs, 0);
});
