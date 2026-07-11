// computeRegistryAudit (v2.1.1 Registry Excellence's "devforgekit registry
// audit" command) - a curated health scorecard distinct from stats/verify/
// doctor, see commands/registry.js's own comment for why a fourth command
// is warranted here rather than overlapping with the other three.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRegistryAudit, computeCrossPlatformAudit, baselineFromAudit, compareCrossPlatformBaseline, computeRegistryInventory } from "../src/commands/registry.js";
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

// ─── Registry Completion (v3.0): computeCrossPlatformAudit ────────────

test("computeCrossPlatformAudit: macOS always counts a package with a top-level install as handled, even with no explicit platformInstall.macos", () => {
    const packages = [{ name: "x", category: "utilities", install: { method: "brew-formula", id: "x" } }];
    const audit = computeCrossPlatformAudit(packages);
    assert.equal(audit.crossPlatform.macos.handled, 1);
});

test("computeCrossPlatformAudit: Linux/Windows are gaps (not silently 'fine') when platformInstall omits them entirely", () => {
    const packages = [{ name: "x", category: "utilities", install: { method: "brew-formula", id: "x" } }];
    const audit = computeCrossPlatformAudit(packages);
    assert.equal(audit.crossPlatform.linux.handled, 0);
    assert.deepEqual(audit.crossPlatform.linux.gaps, ["x"]);
    assert.equal(audit.crossPlatform.windows.handled, 0);
});

test("computeCrossPlatformAudit: an explicit real installStep counts as handled", () => {
    const packages = [{
        name: "x", category: "utilities",
        install: { method: "brew-formula", id: "x" },
        platformInstall: { linux: { method: "apt", id: "x" } }
    }];
    const audit = computeCrossPlatformAudit(packages);
    assert.equal(audit.crossPlatform.linux.handled, 1);
    assert.deepEqual(audit.crossPlatform.linux.gaps, []);
});

test("computeCrossPlatformAudit: an explicit { unsupported: true } counts as handled, not a gap, and is tallied separately", () => {
    const packages = [{
        name: "xcode-only-tool", category: "apple-development",
        install: { method: "brew-formula", id: "x" },
        platformInstall: {
            linux: { unsupported: true, reason: "macOS/Xcode-only toolchain" },
            windows: { unsupported: true, reason: "macOS/Xcode-only toolchain" }
        }
    }];
    const audit = computeCrossPlatformAudit(packages);
    assert.equal(audit.crossPlatform.linux.handled, 1);
    assert.equal(audit.crossPlatform.linux.gaps.length, 0);
    assert.equal(audit.unsupportedPackages, 1);
});

test("computeCrossPlatformAudit: missing validate/uninstall/version are counted directly from field presence", () => {
    const packages = [{ name: "bare", category: "utilities", install: { method: "shell", command: "echo hi" } }];
    const audit = computeCrossPlatformAudit(packages);
    assert.equal(audit.missing.validate, 1);
    assert.equal(audit.missing.uninstall, 1);
    assert.equal(audit.missing.version, 1);
    assert.deepEqual(audit.missingDetail.validate, ["bare"]);
});

test("computeCrossPlatformAudit: missing binary is only flagged when nothing is derivable (no explicit binary, validate, or versionCommand)", () => {
    const withValidate = [{ name: "a", category: "utilities", install: { method: "shell", command: "x" }, validate: "a --version" }];
    const withNothing = [{ name: "b", category: "utilities", install: { method: "shell", command: "x" } }];
    assert.equal(computeCrossPlatformAudit(withValidate).missing.binary, 0);
    assert.equal(computeCrossPlatformAudit(withNothing).missing.binary, 1);
});

test("computeCrossPlatformAudit: missing environment only flags packages in env-needing categories (languages/mobile-development/apple-development), not every package", () => {
    const utilityPkg = [{ name: "a", category: "utilities", install: { method: "shell", command: "x" } }];
    const languagePkg = [{ name: "b", category: "languages", install: { method: "shell", command: "x" } }];
    const languagePkgWithEnv = [{ name: "c", category: "languages", install: { method: "shell", command: "x" }, environment: { path: ["$HOME/.b/bin"] } }];
    assert.equal(computeCrossPlatformAudit(utilityPkg).missing.environment, 0, "a utility with no SDK-style env need is not a gap");
    assert.equal(computeCrossPlatformAudit(languagePkg).missing.environment, 1);
    assert.equal(computeCrossPlatformAudit(languagePkgWithEnv).missing.environment, 0);
});

test("computeCrossPlatformAudit over the real registry: macOS is fully handled, Linux/Windows report the known Registry Completion gap", () => {
    const audit = computeCrossPlatformAudit(loadRegistry().packages);
    assert.equal(audit.total, 261);
    assert.equal(audit.crossPlatform.macos.handled, 261, "every real package has always had a top-level (implicitly macOS) install step");
    // Not asserting exact linux/windows counts here (the whole point of
    // this milestone is to drive them up over time) - just that the
    // shape is sane and gaps are tracked by name for follow-up.
    assert.ok(audit.crossPlatform.linux.handled <= 261);
    assert.ok(Array.isArray(audit.crossPlatform.linux.gaps));
    assert.ok(audit.crossPlatform.windows.handled <= 261);
});

// ─── Registry Completion: install/upgrade/repair/dependencies/conflicts ───

test("computeCrossPlatformAudit: missing install/upgrade/repair are counted directly from field presence (install/update/repair)", () => {
    const packages = [{ name: "bare", category: "utilities", install: { method: "shell", command: "x" }, validate: "x --version" }];
    const audit = computeCrossPlatformAudit(packages);
    assert.equal(audit.missing.install, 0, "has an install step");
    assert.equal(audit.missing.upgrade, 1, "no `update` field");
    assert.equal(audit.missing.repair, 1, "no `repair` field");
});

test("computeCrossPlatformAudit: missing dependencies/conflicts means the field was never explicitly declared, not that it's empty", () => {
    const withEmptyArrays = [{ name: "a", category: "utilities", install: { method: "shell", command: "x" }, dependencies: [], conflicts: [] }];
    const withoutFields = [{ name: "b", category: "utilities", install: { method: "shell", command: "x" } }];
    assert.equal(computeCrossPlatformAudit(withEmptyArrays).missing.dependencies, 0, "an explicit empty array is complete, not missing");
    assert.equal(computeCrossPlatformAudit(withEmptyArrays).missing.conflicts, 0);
    assert.equal(computeCrossPlatformAudit(withoutFields).missing.dependencies, 1, "an absent key is a real gap");
    assert.equal(computeCrossPlatformAudit(withoutFields).missing.conflicts, 1);
});

test("computeCrossPlatformAudit over the real registry: every required field (install/validate/uninstall/upgrade) and dependencies/conflicts is fully declared", () => {
    const audit = computeCrossPlatformAudit(loadRegistry().packages);
    for (const field of ["install", "validate", "uninstall", "upgrade", "repair", "version", "binary", "dependencies", "conflicts"]) {
        assert.equal(audit.missing[field], 0, `expected zero packages missing '${field}', got ${audit.missing[field]}`);
    }
});

// ─── Registry Completion: baseline / CI regression gate ───────────────

test("baselineFromAudit() captures counts only (no per-package gap lists) and compareCrossPlatformBaseline() passes against its own baseline", () => {
    const audit = computeCrossPlatformAudit(loadRegistry().packages);
    const baseline = baselineFromAudit(audit);
    assert.equal(baseline.crossPlatform.linux, audit.crossPlatform.linux.handled);
    assert.ok(!("gaps" in baseline.crossPlatform), "baseline should not carry per-package gap lists");
    const result = compareCrossPlatformBaseline(audit, baseline);
    assert.equal(result.ok, true);
    assert.deepEqual(result.regressions, []);
});

test("compareCrossPlatformBaseline() fails when current coverage is lower than the baseline, and when a missing-field count increased", () => {
    const audit = { total: 10, crossPlatform: { macos: { handled: 10 }, linux: { handled: 5 }, windows: { handled: 5 } }, missing: { validate: 0 } };
    const baseline = { total: 10, crossPlatform: { macos: 10, linux: 8, windows: 5 }, missing: { validate: 0 } };
    const result = compareCrossPlatformBaseline(audit, baseline);
    assert.equal(result.ok, false);
    assert.match(result.regressions.join("\n"), /linux coverage regressed: 8 -> 5/);

    const auditWorseValidate = { total: 10, crossPlatform: { macos: { handled: 10 }, linux: { handled: 8 }, windows: { handled: 5 } }, missing: { validate: 2 } };
    const result2 = compareCrossPlatformBaseline(auditWorseValidate, baseline);
    assert.equal(result2.ok, false);
    assert.match(result2.regressions.join("\n"), /Missing validate increased: 0 -> 2/);
});

// ─── Registry Completion: computeRegistryInventory ─────────────────────

test("computeRegistryInventory() counts package managers, categories, and platforms from real fields", () => {
    const packages = [
        { name: "a", category: "utilities", platforms: ["macos", "linux"], install: { method: "npm", id: "a" } },
        { name: "b", category: "utilities", platforms: ["macos"], install: { method: "brew-formula", id: "b" } },
        { name: "c", category: "languages", platforms: ["macos", "linux", "windows"], install: { method: "npm", id: "c" }, tags: ["language"] }
    ];
    const inventory = computeRegistryInventory(packages);
    assert.deepEqual(inventory.packageManagers, { npm: 2, "brew-formula": 1 });
    assert.deepEqual(inventory.byCategory, { utilities: 2, languages: 1 });
    assert.deepEqual(inventory.byPlatform, { macos: 3, linux: 2, windows: 1 });
    assert.deepEqual(inventory.languagePackages, ["c"]);
});

test("computeRegistryInventory() computes dependency depth as the longest chain, memoized and cycle-safe", () => {
    const packages = [
        { name: "leaf", category: "utilities", install: { method: "shell", command: "x" } },
        { name: "mid", category: "utilities", install: { method: "shell", command: "x" }, dependencies: ["leaf"] },
        { name: "top", category: "utilities", install: { method: "shell", command: "x" }, dependencies: ["mid"] }
    ];
    const inventory = computeRegistryInventory(packages);
    assert.equal(inventory.maxDependencyDepth, 2, "top -> mid -> leaf is a chain of depth 2");
    assert.ok(inventory.averageDependencyDepth > 0 && inventory.averageDependencyDepth <= 2);

    // A cycle must never hang (the `visiting` guard breaks the recursion
    // by returning 0 at the point the cycle closes) - the registry is
    // already lint-verified acyclic, so this is a defensive bound-check,
    // not a claim about what "correct" depth a cycle should report.
    const cyclic = [
        { name: "a", category: "utilities", install: { method: "shell", command: "x" }, dependencies: ["b"] },
        { name: "b", category: "utilities", install: { method: "shell", command: "x" }, dependencies: ["a"] }
    ];
    const cyclicInventory = computeRegistryInventory(cyclic);
    assert.ok(Number.isFinite(cyclicInventory.maxDependencyDepth), "must terminate with a finite number, never hang or return NaN/Infinity");
});

test("computeRegistryInventory() lists environment contributors and unsupported-on-some-platform packages", () => {
    const packages = [
        { name: "with-env", category: "languages", install: { method: "shell", command: "x" }, environment: { path: ["$HOME/.x/bin"] } },
        { name: "no-env", category: "utilities", install: { method: "shell", command: "x" } },
        {
            name: "mac-only", category: "utilities", install: { method: "brew-cask", id: "mac-only" },
            platformInstall: { linux: { unsupported: true, reason: "no Linux port" } }
        }
    ];
    const inventory = computeRegistryInventory(packages);
    assert.deepEqual(inventory.environmentContributors, ["with-env"]);
    assert.deepEqual(inventory.unsupportedPackages, ["mac-only"]);
});

test("computeRegistryInventory() over the real registry produces sane, internally-consistent totals", () => {
    const inventory = computeRegistryInventory(loadRegistry().packages);
    const totalByManager = Object.values(inventory.packageManagers).reduce((a, b) => a + b, 0);
    assert.equal(totalByManager, 261, "every package has exactly one top-level install method");
    assert.equal(inventory.byPlatform.macos, 261, "every package has always supported macOS");
    assert.ok(inventory.averageDependencyDepth >= 0);
    assert.ok(inventory.maxDependencyDepth >= 0);
});
