import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreManifest, checkLiveReachability, applyLiveReachability } from "../src/core/quality.js";

const fullyCompletePkg = {
    name: "complete",
    homepage: "https://example.com",
    repository: "https://github.com/example/example",
    license: "MIT",
    ciVerified: true,
    uninstall: { method: "brew-formula", id: "example" },
    validate: "example --version",
    documentation: "https://example.com/docs"
};

const bareMinimumPkg = { name: "bare" };

test("a fully-complete manifest scores 100/100 with every check passing", () => {
    const result = scoreManifest(fullyCompletePkg);
    assert.equal(result.score, 100);
    assert.equal(result.passCount, 10);
    assert.equal(result.total, 10);
    assert.ok(result.checks.every((c) => c.pass));
});

test("a bare-minimum manifest only passes the always-true schema check", () => {
    const result = scoreManifest(bareMinimumPkg);
    assert.equal(result.passCount, 1);
    assert.equal(result.score, 10);
    const schemaCheck = result.checks.find((c) => c.label === "Schema valid");
    assert.equal(schemaCheck.pass, true);
    for (const check of result.checks) {
        if (check.label !== "Schema valid") assert.equal(check.pass, false, check.label);
    }
});

test("Install/Verify/Uninstall tested all key off ciVerified together", () => {
    const withCi = scoreManifest({ ...bareMinimumPkg, ciVerified: true });
    const testedLabels = ["Install tested", "Verify tested", "Uninstall tested"];
    for (const label of testedLabels) {
        assert.equal(withCi.checks.find((c) => c.label === label).pass, true);
    }
    const withoutCi = scoreManifest(bareMinimumPkg);
    for (const label of testedLabels) {
        assert.equal(withoutCi.checks.find((c) => c.label === label).pass, false);
    }
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
});
