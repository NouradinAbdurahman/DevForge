import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreManifest, checkLiveReachability, applyLiveReachability } from "../src/core/quality.js";

// "docker" is a real registry/compatibility/docker.yaml - used deliberately
// so the "Compatibility rule declared" check has a real file to find
// rather than a fixture the test would have to fake a directory for.
const fullyCompletePkg = {
    name: "docker",
    homepage: "https://example.com",
    repository: "https://github.com/example/example",
    license: "MIT",
    ciVerified: true,
    uninstall: { method: "brew-formula", id: "example" },
    validate: "example --version",
    documentation: "https://example.com/docs",
    aliases: ["ex"],
    tags: ["containers", "cli"],
    platforms: ["macos", "linux"],
    architectures: ["intel", "apple-silicon"]
};

const bareMinimumPkg = { name: "definitely-not-a-real-registry-package" };

test("a fully-complete manifest scores 100/100 with every check passing", () => {
    const result = scoreManifest(fullyCompletePkg);
    assert.equal(result.score, 100);
    assert.equal(result.passCount, result.total);
    assert.ok(result.checks.every((c) => c.pass));
});

test("a bare-minimum manifest only passes the always-true schema check", () => {
    const result = scoreManifest(bareMinimumPkg);
    assert.equal(result.passCount, 1);
    const schemaCheck = result.checks.find((c) => c.label === "Schema valid");
    assert.equal(schemaCheck.pass, true);
    for (const check of result.checks) {
        if (check.label !== "Schema valid") assert.equal(check.pass, false, check.label);
    }
});

test("CI-verified is one honest check tied to ciVerified, not three inflated copies of it", () => {
    const withCi = scoreManifest({ ...bareMinimumPkg, ciVerified: true });
    assert.equal(withCi.checks.find((c) => c.label.startsWith("CI-verified")).pass, true);
    const withoutCi = scoreManifest(bareMinimumPkg);
    assert.equal(withoutCi.checks.find((c) => c.label.startsWith("CI-verified")).pass, false);
});

test("Aliases/Tags present reflect real array contents, not just field existence", () => {
    assert.equal(scoreManifest({ ...bareMinimumPkg, aliases: [] }).checks.find((c) => c.label === "Aliases present").pass, false);
    assert.equal(scoreManifest({ ...bareMinimumPkg, aliases: ["x"] }).checks.find((c) => c.label === "Aliases present").pass, true);
    assert.equal(scoreManifest({ ...bareMinimumPkg, tags: ["one"] }).checks.find((c) => c.label === "Tags present").pass, false);
    assert.equal(scoreManifest({ ...bareMinimumPkg, tags: ["one", "two"] }).checks.find((c) => c.label === "Tags present").pass, true);
});

test("Compatibility rule declared checks for a real registry/compatibility/<name>.yaml file", () => {
    assert.equal(scoreManifest({ name: "docker" }).checks.find((c) => c.label === "Compatibility rule declared").pass, true);
    assert.equal(scoreManifest(bareMinimumPkg).checks.find((c) => c.label === "Compatibility rule declared").pass, false);
});

test("Multi-platform support and Architecture declared are independent checks", () => {
    const oneMacOnly = scoreManifest({ ...bareMinimumPkg, platforms: ["macos"], architectures: ["intel"] });
    assert.equal(oneMacOnly.checks.find((c) => c.label === "Multi-platform support").pass, false);
    assert.equal(oneMacOnly.checks.find((c) => c.label === "Architecture declared").pass, true);

    const twoPlatforms = scoreManifest({ ...bareMinimumPkg, platforms: ["macos", "linux"] });
    assert.equal(twoPlatforms.checks.find((c) => c.label === "Multi-platform support").pass, true);
});

test("breakdown groups checks by category with a per-category score", () => {
    const result = scoreManifest(bareMinimumPkg);
    const categories = result.breakdown.map((b) => b.category);
    assert.deepEqual(categories, ["Metadata", "Documentation", "Reliability", "Discoverability", "Compatibility", "Platform Support"]);
    for (const group of result.breakdown) {
        assert.equal(group.score, Math.round((group.passCount / group.total) * 100));
    }
    const metadata = result.breakdown.find((b) => b.category === "Metadata");
    // Schema valid always passes, homepage/repository/license don't for a bare package.
    assert.equal(metadata.passCount, 1);
});

test("checkLiveReachability returns null (not false) when there's no URL to check", async () => {
    const result = await checkLiveReachability({ name: "no-urls" });
    assert.equal(result.homepageReachable, null);
    assert.equal(result.repositoryReachable, null);
});

test("checkLiveReachability reports a well-known stable URL as reachable", async () => {
    // github.com is the same "is there internet" probe scripts/common.sh's
    // net_has_internet() already uses - consistent with existing precedent
    // for real-network checks in this repo's own tooling.
    const result = await checkLiveReachability({ homepage: "https://github.com" }, { timeoutMs: 8000 });
    assert.equal(result.homepageReachable, true);
});

test("applyLiveReachability upgrades 'present' checks to 'reachable' and recomputes the score", () => {
    const structuralOnly = scoreManifest({ name: "x", homepage: "https://example.com" });
    const upgraded = applyLiveReachability(structuralOnly, { homepageReachable: true, repositoryReachable: null });

    assert.ok(upgraded.checks.some((c) => c.label === "Homepage reachable" && c.pass === true));
    assert.ok(!upgraded.checks.some((c) => c.label === "Homepage present"));
    // repositoryReachable: null (no repository URL) leaves that check untouched
    assert.ok(upgraded.checks.some((c) => c.label === "Repository present" && c.pass === false));
    // The category tag survives the relabel, so the breakdown still groups it correctly.
    assert.ok(upgraded.checks.find((c) => c.label === "Homepage reachable").category === "Metadata");
});
