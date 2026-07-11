import { test } from "node:test";
import assert from "node:assert/strict";
import { runComponentChecks } from "../src/commands/check.js";
import { loadPackages } from "../src/core/registry.js";

test("runComponentChecks validates every package with a `validate` command in bounded time, not one at a time", async () => {
    const expected = loadPackages().filter((pkg) => pkg.validate).length;
    assert.ok(expected > 100, "expected the real registry to have well over 100 validate-able packages");

    const start = Date.now();
    const results = await runComponentChecks();
    const elapsedMs = Date.now() - start;

    assert.equal(results.length, expected);
    for (const r of results) {
        assert.ok(r.status === "PASS" || r.status === "WARNING");
        assert.match(r.description, /^Component check: /);
    }

    // Regression guard: this previously ran every package's validate
    // command strictly sequentially, which made `check --json` hang for
    // minutes (observed directly). A bounded worker pool over 260+
    // packages should comfortably finish well under a minute even on a
    // slow CI machine; a sequential regression would blow well past this.
    assert.ok(elapsedMs < 60_000, `expected bounded-concurrency validation to finish in well under 60s, took ${elapsedMs}ms`);
});
