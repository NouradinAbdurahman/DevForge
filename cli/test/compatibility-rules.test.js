import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    loadCompatibilityRuleFiles,
    checkRuleIntegrity,
    loadCompatibilityRules,
    getRulesForPackage,
    pluginContributedRules
} from "../src/core/compatibility/rules.js";
import { compatibilityCoverage } from "../src/commands/registry.js";
import { loadPackages } from "../src/core/registry.js";

function tempRuleDir(files) {
    const dir = mkdtempSync(path.join(tmpdir(), "devforgekit-compat-rules-test-"));
    for (const [name, content] of Object.entries(files)) {
        writeFileSync(path.join(dir, name), content);
    }
    return dir;
}

test("the whole real registry/compatibility/*.yaml set is schema-valid and integrity-clean", () => {
    // loadCompatibilityRules() throws with every problem listed at once if
    // not - the real, shipped assertion is that this doesn't throw.
    const rules = loadCompatibilityRules();
    assert.ok(rules.length >= 5);
    assert.ok(rules.some((r) => r.name === "flutter"));
});

test("loadCompatibilityRuleFiles throws a single error listing every schema problem at once", () => {
    const dir = tempRuleDir({
        "bad.yaml": "schemaVersion: 1\nname: Not-Valid-Name\n"
    });
    try {
        assert.throws(() => loadCompatibilityRuleFiles(dir), /Invalid compatibility rule manifest/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("checkRuleIntegrity flags an unknown rule name, unknown requires/conflicts/recommends targets, and unknown variant ids", () => {
    const packages = [
        { name: "foo", variants: [{ id: "a", label: "A", install: { method: "shell", command: "true" } }] }
    ];
    const rules = [
        { schemaVersion: 1, name: "not-a-real-package", conflicts: ["also-missing"], recommends: ["still-missing"] },
        { schemaVersion: 1, name: "foo", variantConflicts: [["a", "b"]] }
    ];
    const problems = checkRuleIntegrity(rules, packages);
    assert.ok(problems.some((p) => p.includes("does not match any registry package")));
    assert.ok(problems.some((p) => p.includes("conflicts references unknown package 'also-missing'")));
    assert.ok(problems.some((p) => p.includes("recommends references unknown package 'still-missing'")));
    assert.ok(problems.some((p) => p.includes("variantConflicts references unknown variant 'b'")));
});

test("checkRuleIntegrity is clean for a well-formed rule set, and plugin-contributed rules are exempt from the name check", () => {
    const packages = [{ name: "docker" }];
    const rules = [
        { schemaVersion: 1, name: "docker", versions: { "27": { requires: { docker: "*" } } } },
        { schemaVersion: 1, name: "my-plugin", source: "plugin", requires: { docker: ">=27" } }
    ];
    assert.deepEqual(checkRuleIntegrity(rules, packages), []);
});

test("getRulesForPackage returns every rule targeting a name, including multiple plugin contributions", () => {
    const rules = [
        { schemaVersion: 1, name: "docker" },
        { schemaVersion: 1, name: "docker", source: "plugin" },
        { schemaVersion: 1, name: "node" }
    ];
    assert.equal(getRulesForPackage("docker", rules).length, 2);
    assert.equal(getRulesForPackage("node", rules).length, 1);
    assert.equal(getRulesForPackage("unknown", rules).length, 0);
});

test("compatibilityCoverage: 100% for an empty registry, and a plausible fraction for the real one", () => {
    assert.equal(compatibilityCoverage([]), 100);
    const coverage = compatibilityCoverage(loadPackages());
    assert.ok(coverage > 0 && coverage < 100, `expected a real, partial coverage percentage, got ${coverage}`);
});

test("compatibilityCoverage counts only packages with a dedicated rule file, on a small fixture", () => {
    const packages = [{ name: "flutter" }, { name: "totally-uncovered-package" }];
    // flutter has a real registry/compatibility/flutter.yaml; the other name doesn't.
    assert.equal(compatibilityCoverage(packages), 50);
});

test("pluginContributedRules normalizes both string and { version } requirement shapes, and skips invalid/rule-less plugins", () => {
    const discovered = [
        { valid: true, name: "plugin-a", manifest: { rules: { requires: { docker: ">=29" }, conflicts: ["colima"] } } },
        { valid: true, name: "plugin-b", manifest: { rules: { requires: { node: { version: ">=18" } }, recommends: { pnpm: ">=9" } } } },
        { valid: true, name: "plugin-c", manifest: {} },
        { valid: false, name: "plugin-d", manifest: { rules: { requires: { docker: ">=1" } } } }
    ];
    const rules = pluginContributedRules(discovered);
    assert.equal(rules.length, 2);
    assert.equal(rules[0].name, "plugin-a");
    assert.equal(rules[0].requires.docker, ">=29");
    assert.equal(rules[1].requires.node, ">=18");
    assert.deepEqual(rules[1].recommends, ["pnpm"]);
});
