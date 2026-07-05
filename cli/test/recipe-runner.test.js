import { test } from "node:test";
import assert from "node:assert/strict";
import { configureActionNames, runConfigureStep, verifyComponents } from "../src/core/recipes.js";

test("configureActionNames returns exactly the recipe schema's known configure actions", () => {
    assert.deepEqual(configureActionNames().sort(), ["cursor", "git", "mise", "shell", "vscode"]);
});

// Deliberately does not exercise a real configure action here: git/vscode/
// cursor/shell/mise all call into scripts/common.sh functions that write
// to the real $HOME (fs_safe_copy) - exactly the kind of live-system
// mutation the rest of this suite avoids too (see installer-timing.test.js's
// "sleep"/"true" fixtures instead of real `brew install`). Only the
// synchronous validation path is safe to assert on here.
test("runConfigureStep throws a clear error for an unknown configure action, before spawning anything", () => {
    assert.throws(() => runConfigureStep("not-a-real-action"), /Unknown configure action/);
});

const fixturePackages = [
    { name: "passes", validate: "true" },
    { name: "fails", validate: "false" },
    { name: "no-health-check" }
];

test("verifyComponents reports pass/fail/skip/unknown for the right components", async () => {
    const { total, passed, failed, results } = await verifyComponents(
        ["passes", "fails", "no-health-check", "does-not-exist"],
        { packages: fixturePackages }
    );
    assert.equal(total, 4);
    assert.equal(passed, 1);
    assert.equal(failed, 1);
    assert.deepEqual(results.map((r) => r.status), ["pass", "fail", "skipped", "unknown"]);
});

test("verifyComponents returns zero totals for an empty component list", async () => {
    const { total, passed, failed, results } = await verifyComponents([], { packages: fixturePackages });
    assert.equal(total, 0);
    assert.equal(passed, 0);
    assert.equal(failed, 0);
    assert.deepEqual(results, []);
});
