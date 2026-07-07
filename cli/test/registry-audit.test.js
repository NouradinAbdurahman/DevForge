// computeRegistryAudit (v2.1.1 Registry Excellence's "devforgekit registry
// audit" command) - a curated health scorecard distinct from stats/verify/
// doctor, see commands/registry.js's own comment for why a fourth command
// is warranted here rather than overlapping with the other three.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRegistryAudit } from "../src/commands/registry.js";
import { loadRegistry } from "../src/core/registry.js";

test("computeRegistryAudit reports real, internally-consistent coverage percentages for the real registry", () => {
    const audit = computeRegistryAudit(loadRegistry());

    assert.equal(audit.total, audit.verified + audit.untested);
    for (const pctField of [
        "averageQuality", "compatibilityCoverage", "documentationCoverage",
        "validationCoverage", "aliasesCoverage", "architectureCoverage"
    ]) {
        assert.ok(audit[pctField] >= 0 && audit[pctField] <= 100, `${pctField} out of range: ${audit[pctField]}`);
    }
    // Documentation coverage is known to be 100% (every package has a
    // documentation field as of v2.0.8) - a real, current fact worth
    // locking in as a regression check, not a coincidence.
    assert.equal(audit.documentationCoverage, 100);
    assert.ok(Array.isArray(audit.recommendations));
});

test("computeRegistryAudit produces at least one recommendation when compatibility coverage is low", () => {
    // The real registry's compatibility coverage is well under 25% today
    // (24-ish rule files over 261 packages) - this should always surface
    // a recommendation until coverage genuinely improves past that bar.
    const audit = computeRegistryAudit(loadRegistry());
    if (audit.compatibilityCoverage < 25) {
        assert.ok(audit.recommendations.some((r) => r.includes("compatibility rule")));
    }
});

test("computeRegistryAudit: a small, fully-populated fixture registry reports zero gaps", () => {
    const packages = [
        {
            name: "docker", // real registry/compatibility/docker.yaml exists
            category: "containers", documentation: "https://docs.docker.com", validate: "docker --version",
            aliases: ["moby"], tags: ["containers", "cli"], architectures: ["intel", "apple-silicon"],
            stability: "stable", ciVerified: true
        }
    ];
    const data = { categories: [{ id: "containers", label: "Containers" }], packages, collections: [], profiles: [], recipes: [] };
    const audit = computeRegistryAudit(data);
    assert.equal(audit.documentationCoverage, 100);
    assert.equal(audit.validationCoverage, 100);
    assert.equal(audit.aliasesCoverage, 100);
    assert.equal(audit.architectureCoverage, 100);
    assert.equal(audit.compatibilityCoverage, 100);
    assert.equal(audit.deprecated, 0);
});
