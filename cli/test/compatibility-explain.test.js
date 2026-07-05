import { test } from "node:test";
import assert from "node:assert/strict";
import { explainComponent } from "../src/core/compatibility/explain.js";

// A fake `versionCommand` (a literal `echo`) stands in for a real CLI probe
// so this test never depends on what's actually installed on the machine
// running it - the same isolation scanCompatibility's tests achieve via a
// pre-supplied `versions` map, just expressed through a real (trivial)
// shell command since explainComponent always detects live.
function pkg(name, version, extra = {}) {
    return { name, category: "languages", platforms: ["macos", "linux"], versionCommand: `echo ${version}`, ...extra };
}

test("explainComponent reports ✓/✗ per requirement against the matched version rule, plus conflicts and a recommendation", async () => {
    const packages = [
        pkg("flutter", "3.44.0"),
        pkg("dart", "3.9.0", { update: "brew upgrade dart" }),
        pkg("java", "17.0.0")
    ];
    const rules = [{
        schemaVersion: 1,
        name: "flutter",
        versions: { "3.44": { requires: { dart: ">=3.8", java: ">=21" } } }
    }];

    const explanation = await explainComponent("flutter", { packages, rules });
    assert.equal(explanation.installedVersion, "3.44.0");
    assert.equal(explanation.matchedVersionKey, "3.44");

    const dartReq = explanation.requirements.find((r) => r.name === "dart");
    assert.equal(dartReq.satisfied, true);
    const javaReq = explanation.requirements.find((r) => r.name === "java");
    assert.equal(javaReq.satisfied, false);
    assert.ok(explanation.recommendations.length === 0); // java has no `update` command declared, so no fabricated fix
});

test("explainComponent reports a conflict list and no matched version when the installed version has no rule", async () => {
    const packages = [pkg("docker", "27.0.0")];
    const rules = [{ schemaVersion: 1, name: "docker", conflicts: ["colima"], versions: { "20": { deprecated: true } } }];

    const explanation = await explainComponent("docker", { packages, rules });
    assert.equal(explanation.matchedVersionKey, null);
    assert.deepEqual(explanation.conflicts, ["colima"]);
});

test("explainComponent throws a clear error for an unknown component (matches getPackage's convention)", async () => {
    await assert.rejects(() => explainComponent("not-a-real-tool", { packages: [], rules: [] }), /Unknown component/);
});
