import { test } from "node:test";
import assert from "node:assert/strict";
import { planRepair, executeRepairPlan } from "../src/core/compatibility/repair.js";

test("planRepair turns a missing-dependency issue into an install action, and a variantConflict into a manual (non-executable) one", () => {
    const scanResult = {
        issues: [
            { severity: "CRITICAL", tool: "flutter", dependency: "dart", message: "flutter requires dart, not installed", recommendation: "devforgekit component install dart" },
            { severity: "CRITICAL", tool: "docker", variantConflict: { a: "docker-desktop", b: "colima" }, message: "conflict" },
            { severity: "PASS", tool: "git", message: "fine, nothing to do here" }
        ]
    };
    const actions = planRepair(scanResult);
    assert.equal(actions.length, 2);
    assert.deepEqual(actions[0], { type: "install", name: "dart", reason: "flutter requires dart, not installed" });
    assert.equal(actions[1].type, "manual");
});

test("planRepair turns a conflictWith issue into a conflict action, and a 'Run: ...' recommendation into a shell action", () => {
    const scanResult = {
        issues: [
            { severity: "CRITICAL", tool: "a", conflictWith: "b", message: "a conflicts with b" },
            { severity: "WARNING", tool: "node", message: "node 18 is deprecated", recommendation: "Run: mise upgrade node" }
        ]
    };
    const actions = planRepair(scanResult);
    assert.deepEqual(actions[0], { type: "conflict", tool: "a", conflictWith: "b", message: "a conflicts with b" });
    assert.deepEqual(actions[1], { type: "shell", tool: "node", command: "mise upgrade node", reason: "node 18 is deprecated" });
});

test("planRepair produces nothing for a clean scan", () => {
    assert.deepEqual(planRepair({ issues: [{ severity: "PASS", tool: "git", message: "ok" }] }), []);
});

test("executeRepairPlan: install/shell actions run for real (trivial commands); manual actions are always skipped", async () => {
    const actions = [
        { type: "shell", tool: "x", command: "true", reason: "r" },
        { type: "manual", tool: "docker", message: "cannot auto-repair" }
    ];
    const results = await executeRepairPlan(actions, { assumeYes: true });
    assert.equal(results[0].ok, true);
    assert.equal(results[1].skipped, true);
    assert.equal(results[1].ok, false);
});

// A conflict action without assumeYes goes through lib/prompts.js's real
// interactive confirm() - deliberately not exercised here, the same reason
// no other test in this suite drives an interactive prompt directly (it
// would block on real stdin instead of a fast, deterministic assertion).
// planRepair's own tests above already cover the conflict action's shape;
// the "requires confirmation unless assumeYes" behavior is the same
// confirm()-gated pattern core/workspace's destructive commands already use.
