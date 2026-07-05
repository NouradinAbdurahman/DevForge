import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceVersion, matchesVersion, findVersionRule } from "../src/core/compatibility/versionMatch.js";

test("coerceVersion loosely parses bare majors, major.minor, and full semver", () => {
    assert.equal(coerceVersion("27").version, "27.0.0");
    assert.equal(coerceVersion("3.44").version, "3.44.0");
    assert.equal(coerceVersion("3.44.2").version, "3.44.2");
    assert.equal(coerceVersion(""), null);
    assert.equal(coerceVersion(null), null);
});

test("matchesVersion: wildcard/empty range always matches", () => {
    assert.equal(matchesVersion("3.44.2", "*"), true);
    assert.equal(matchesVersion("3.44.2", ""), true);
    assert.equal(matchesVersion("3.44.2", undefined), true);
});

test("matchesVersion: minimum, maximum, and range operators", () => {
    assert.equal(matchesVersion("3.44.2", ">=3.8"), true);
    assert.equal(matchesVersion("3.2.0", ">=3.8"), false);
    assert.equal(matchesVersion("3.2.0", "<=3.8"), true);
    assert.equal(matchesVersion("3.9.0", "<=3.8"), false);
    assert.equal(matchesVersion("3.9.0", ">=3.8 <4.0"), true);
    assert.equal(matchesVersion("4.1.0", ">=3.8 <4.0"), false);
});

test("matchesVersion: exact/bare-number ranges compare directly when not a valid semver range", () => {
    assert.equal(matchesVersion("27.2.1", "27"), true);
    assert.equal(matchesVersion("26.9.0", "27"), false);
});

test("matchesVersion returns null (unverifiable) rather than guessing when installed can't be coerced", () => {
    assert.equal(matchesVersion(null, ">=3.8"), null);
    assert.equal(matchesVersion("not-a-version-at-all-!!", ">=3.8"), null);
});

test("findVersionRule prefers the most specific matching key", () => {
    const versions = {
        "3": { recommends: { generic: "*" } },
        "3.44": { requires: { dart: ">=3.8" } }
    };
    const matched = findVersionRule(versions, "3.44.2");
    assert.equal(matched.key, "3.44");
    assert.deepEqual(matched.rule, { requires: { dart: ">=3.8" } });
});

test("findVersionRule respects patch-level keys and returns null for no match", () => {
    const versions = { "3.44.0": { deprecated: true }, "3.44.2": { deprecated: false } };
    assert.equal(findVersionRule(versions, "3.44.2").rule.deprecated, false);
    assert.equal(findVersionRule(versions, "3.45.0"), null);
});

test("findVersionRule returns null for an undetectable installed version or missing versions map", () => {
    assert.equal(findVersionRule({ "3.44": {} }, null), null);
    assert.equal(findVersionRule(undefined, "3.44.0"), null);
});
