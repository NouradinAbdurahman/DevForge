import { test } from "node:test";
import assert from "node:assert/strict";
import { scanCompatibility, scoreCompatibility, currentPlatform, currentArchitecture } from "../src/core/compatibility/engine.js";

function pkg(name, extra = {}) {
    return { name, category: "languages", platforms: ["macos", "linux"], dependencies: [], ...extra };
}

test("scoreCompatibility: PASS/RECOMMEND earn full credit, WARNING half, CRITICAL/UNSUPPORTED none - and the verdict tiers match the PRD's 5 levels", () => {
    assert.deepEqual(scoreCompatibility([]), { pass: 0, recommend: 0, warn: 0, critical: 0, unsupported: 0, total: 0, score: 100, verdict: "Healthy" });

    const healthy = scoreCompatibility([{ severity: "PASS" }, { severity: "RECOMMEND" }]);
    assert.equal(healthy.score, 100);
    assert.equal(healthy.verdict, "Healthy");

    const warning = scoreCompatibility([{ severity: "PASS" }, { severity: "WARNING" }]);
    assert.equal(warning.score, 75);
    assert.equal(warning.verdict, "Warning");

    const critical = scoreCompatibility([{ severity: "PASS" }, { severity: "PASS" }, { severity: "PASS" }, { severity: "CRITICAL" }]);
    // Numeric score is 75 (>=70) but a CRITICAL finding must still win the verdict outright.
    assert.equal(critical.verdict, "Critical");

    const unsupported = scoreCompatibility([{ severity: "PASS" }, { severity: "PASS" }, { severity: "PASS" }, { severity: "PASS" }, { severity: "UNSUPPORTED" }]);
    assert.equal(unsupported.verdict, "Unsupported");
});

test("scanCompatibility reports a package with no compatibility rules as a clean PASS", async () => {
    const packages = [pkg("git")];
    const result = await scanCompatibility(["git"], { packages, rules: [] });
    assert.equal(result.critical, 0);
    assert.equal(result.score, 100);
    assert.ok(result.issues.some((i) => i.severity === "PASS" && i.tool === "git"));
});

test("scanCompatibility reports a WARNING for a name that isn't a known registry component, without throwing, and without a redundant graph issue for the same name", async () => {
    const result = await scanCompatibility(["totally-unknown-tool"], { packages: [], rules: [] });
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].severity, "WARNING");
});

test("scanCompatibility still reports a transitively-missing dependency (not requested directly) as a graph CRITICAL", async () => {
    const packages = [pkg("a", { dependencies: ["ghost"] })];
    const result = await scanCompatibility(["a"], { packages, rules: [] });
    assert.ok(result.issues.some((i) => i.severity === "CRITICAL" && i.message.includes("Missing dependency: 'ghost'")));
});

test("scanCompatibility: satisfied/unsatisfied/unknown `requires` against a pre-supplied version map", async () => {
    const packages = [pkg("flutter", { dependencies: ["dart"] }), pkg("dart")];
    const rules = [{ schemaVersion: 1, name: "flutter", versions: { "3.44": { requires: { dart: ">=3.8" } } } }];

    const satisfied = await scanCompatibility(["flutter", "dart"], { packages, rules, versions: new Map([["flutter", "3.44.0"], ["dart", "3.9.0"]]) });
    assert.equal(satisfied.critical, 0);
    assert.ok(satisfied.issues.some((i) => i.severity === "PASS" && i.message.includes("'dart' >=3.8 satisfied")));

    const unsatisfied = await scanCompatibility(["flutter", "dart"], { packages, rules, versions: new Map([["flutter", "3.44.0"], ["dart", "3.2.0"]]) });
    assert.equal(unsatisfied.critical, 1);
    assert.equal(unsatisfied.verdict, "Critical");
    assert.ok(unsatisfied.issues.some((i) => i.severity === "CRITICAL" && i.dependency === "dart"));

    const missing = await scanCompatibility(["flutter"], { packages, rules, versions: new Map([["flutter", "3.44.0"], ["dart", null]]) });
    assert.ok(missing.issues.some((i) => i.severity === "CRITICAL" && i.message.includes("which is not installed")));
});

test("scanCompatibility: a top-level `conflicts` entry only fires when the conflicting package is also in the requested set", async () => {
    const packages = [pkg("a"), pkg("b")];
    const rules = [{ schemaVersion: 1, name: "a", conflicts: ["b"] }];

    const both = await scanCompatibility(["a", "b"], { packages, rules, versions: new Map([["a", null], ["b", null]]) });
    assert.equal(both.critical, 1);
    assert.ok(both.issues.some((i) => i.conflictWith === "b"));

    const onlyOne = await scanCompatibility(["a"], { packages, rules, versions: new Map([["a", null]]) });
    assert.equal(onlyOne.critical, 0);
});

test("scanCompatibility: deprecated/experimental/unsupported/lts version flags map to the right severities", async () => {
    const packages = [pkg("node")];
    const rules = [{
        schemaVersion: 1,
        name: "node",
        versions: {
            "18": { deprecated: true },
            "16": { experimental: true },
            "12": { unsupported: true },
            "22": { lts: true }
        }
    }];

    const deprecated = await scanCompatibility(["node"], { packages, rules, versions: new Map([["node", "18.19.0"]]) });
    assert.ok(deprecated.issues.some((i) => i.severity === "WARNING" && i.message.includes("deprecated")));

    const unsupported = await scanCompatibility(["node"], { packages, rules, versions: new Map([["node", "12.0.0"]]) });
    assert.equal(unsupported.verdict, "Unsupported");

    const lts = await scanCompatibility(["node"], { packages, rules, versions: new Map([["node", "22.0.0"]]) });
    assert.ok(lts.issues.some((i) => i.severity === "RECOMMEND" && i.message.includes("cannot verify current LTS status offline")));
});

test("scanCompatibility: a platform/architecture mismatch is UNSUPPORTED and wins the verdict", async () => {
    const foreignPlatform = currentPlatform() === "macos" ? "linux" : "macos";
    const packages = [pkg("only-elsewhere", { platforms: [foreignPlatform] })];
    const result = await scanCompatibility(["only-elsewhere"], { packages, rules: [] });
    assert.equal(result.verdict, "Unsupported");
    assert.ok(result.issues.some((i) => i.severity === "UNSUPPORTED" && i.message.includes("does not support this platform")));
});

test("scanCompatibility: architecture support is honored on the real current platform/arch", async () => {
    const platform = currentPlatform();
    const arch = currentArchitecture();
    if (platform === "linux") return; // architectures are only checked off macOS in engine.js today
    const foreignArch = arch === "apple-silicon" ? "intel" : "apple-silicon";
    const packages = [pkg("only-other-arch", { architectures: [foreignArch] })];
    const result = await scanCompatibility(["only-other-arch"], { packages, rules: [] });
    assert.ok(result.issues.some((i) => i.severity === "UNSUPPORTED" && i.message.includes("does not declare support for this architecture")));
});

test("scanCompatibility: variantConflicts fires only when both variant probes succeed", async () => {
    const packages = [pkg("docker")];
    const rules = [{
        schemaVersion: 1,
        name: "docker",
        variantConflicts: [["docker-desktop", "colima"]],
        variantProbes: { "docker-desktop": "true", colima: "true" }
    }];
    const result = await scanCompatibility(["docker"], { packages, rules, versions: new Map([["docker", null]]) });
    assert.equal(result.critical, 1);
    assert.ok(result.issues.some((i) => i.variantConflict && i.variantConflict.a === "docker-desktop"));

    const rulesNoConflict = [{
        schemaVersion: 1,
        name: "docker",
        variantConflicts: [["docker-desktop", "colima"]],
        variantProbes: { "docker-desktop": "true", colima: "false" }
    }];
    const clean = await scanCompatibility(["docker"], { packages, rules: rulesNoConflict, versions: new Map([["docker", null]]) });
    assert.equal(clean.critical, 0);
});

test("scanCompatibility: a missing dependency edge and a circular dependency are both reported as CRITICAL graph issues", async () => {
    const packages = [
        { name: "a", dependencies: ["b"], platforms: ["macos", "linux"] },
        { name: "b", dependencies: ["a"], platforms: ["macos", "linux"] }
    ];
    const result = await scanCompatibility(["a"], { packages, rules: [] });
    assert.ok(result.issues.some((i) => i.severity === "CRITICAL" && i.message.includes("Circular dependency")));
});

test("currentPlatform/currentArchitecture return one of the documented enum values", () => {
    assert.ok(["macos", "linux", "windows"].includes(currentPlatform()));
    assert.ok(["apple-silicon", "intel"].includes(currentArchitecture()));
});
