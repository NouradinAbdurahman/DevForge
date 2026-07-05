import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadProfiles, getProfile, expandProfile, validateProfileDoc } from "../src/core/registry.js";

const fixturesDir = path.join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "profiles-bad");

test("the real registry/profiles directory is all schema-valid and non-empty", () => {
    const profiles = loadProfiles();
    assert.ok(profiles.length >= 49, "expected at least the ~49 documented profiles");
    for (const p of profiles) {
        assert.ok(p.name && p.description);
        assert.ok((p.collections && p.collections.length > 0) || (p.components && p.components.length > 0));
    }
});

test("a profile declaring neither collections nor components is rejected", () => {
    assert.throws(() => loadProfiles([fixturesDir]), /must declare at least one/);
});

test("getProfile returns the 'ai' profile referencing python-ai and machine-learning", () => {
    const ai = getProfile("ai");
    assert.deepEqual(ai.collections.sort(), ["machine-learning", "python-ai"]);
});

test("getProfile throws a DevForgeError for an unknown profile", () => {
    assert.throws(() => getProfile("does-not-exist"), /Unknown profile/);
});

test("expandProfile resolves a collections-only profile to its collection's components", () => {
    const minimal = getProfile("minimal");
    assert.deepEqual(expandProfile(minimal).sort(), ["git", "vscode"]);
});

test("expandProfile dedupes across overlapping collections and extra components", () => {
    const fixture = {
        name: "fixture",
        description: "x",
        collections: ["minimal"], // -> git, vscode
        components: ["git", "docker"] // git overlaps, docker is new
    };
    assert.deepEqual(expandProfile(fixture).sort(), ["docker", "git", "vscode"]);
});

test("validateProfileDoc accepts a well-formed ad hoc profile and rejects a malformed one", () => {
    assert.doesNotThrow(() => validateProfileDoc({ schemaVersion: 1, name: "x", description: "y", components: ["git"] }));
    assert.throws(() => validateProfileDoc({ schemaVersion: 1, name: "x", description: "y" }), /must declare at least one/);
    assert.throws(() => validateProfileDoc({ name: "bad name with spaces", description: "y", components: ["git"] }));
});
