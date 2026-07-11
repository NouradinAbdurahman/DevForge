// devforgekit registry format (Registry Completion, v3.0) - deterministic
// YAML normalization so the registry always regenerates byte-identically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { load as yamlLoad } from "js-yaml";
import { reorderKeys, formatYamlDoc, formatRegistryFile, formatRegistry } from "../src/core/registryFormat.js";

const PACKAGE_ORDER = [
    "schemaVersion", "name", "description", "category", "platforms", "architectures",
    "variants", "install", "binary", "dependencies", "conflicts",
    "validate", "versionCommand", "repair", "update", "uninstall", "post_install",
    "recommendedAlternatives",
    "homepage", "repository", "license", "documentation", "maintainer",
    "tags", "aliases", "stability", "lastVerified", "ciVerified",
    "platformInstall", "environment"
];

function withTempRegistry(fn) {
    const dir = mkdtempSync(path.join(tmpdir(), "dfk-registry-format-"));
    try {
        for (const kind of ["categories", "packages", "collections", "profiles", "recipes"]) {
            mkdirSync(path.join(dir, "registry", kind), { recursive: true });
        }
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test("reorderKeys() reorders known keys and appends unknown keys alphabetically at the end", () => {
    const result = reorderKeys({ zzz: 1, name: "x", description: "y" }, ["name", "description"]);
    assert.deepEqual(Object.keys(result), ["name", "description", "zzz"]);
});

test("formatYamlDoc() collapses short scalar arrays (platforms/architectures/tags/aliases) to flow style", () => {
    const text = formatYamlDoc({ name: "x", platforms: ["macos", "linux", "windows"], tags: ["a", "b"] }, ["name", "platforms", "tags"]);
    assert.match(text, /^platforms: \[macos, linux, windows\]$/m);
    assert.match(text, /^tags: \[a, b\]$/m);
});

test("formatYamlDoc() never changes the parsed meaning of a document, only its formatting", () => {
    const doc = {
        name: "x", schemaVersion: 1,
        install: { method: "npm", id: "x" },
        dependencies: ["a", "b"],
        platforms: ["macos", "linux"],
        environment: { path: ["$HOME/.x/bin"], variables: { X_HOME: { value: "$HOME/.x" } } }
    };
    const text = formatYamlDoc(doc, PACKAGE_ORDER);
    assert.deepStrictEqual(yamlLoad(text), doc);
});

test("formatRegistryFile() reports changed:false for an already-canonical file (idempotency)", () => {
    withTempRegistry((dir) => {
        const filePath = path.join(dir, "registry", "packages", "x.yaml");
        writeFileSync(filePath, formatYamlDoc({ schemaVersion: 1, name: "x", description: "d", category: "utilities" }, PACKAGE_ORDER));
        const result = formatRegistryFile(filePath, PACKAGE_ORDER);
        assert.equal(result.changed, false);
    });
});

test("formatRegistryFile() detects and fixes out-of-order fields, flow-style-eligible arrays, and inconsistent quoting", () => {
    withTempRegistry((dir) => {
        const filePath = path.join(dir, "registry", "packages", "x.yaml");
        writeFileSync(filePath, [
            'name: "x"',
            "schemaVersion: 1",
            "description: d",
            "category: utilities",
            "platforms:",
            "  - macos",
            "  - linux",
            ""
        ].join("\n"));
        const result = formatRegistryFile(filePath, PACKAGE_ORDER);
        assert.equal(result.changed, true);
        assert.match(result.after, /^schemaVersion: 1\nname: x\n/);
        assert.match(result.after, /^platforms: \[macos, linux\]$/m);
    });
});

test("formatRegistry() only writes files that actually changed, and --check mode never writes", () => {
    withTempRegistry((dir) => {
        const canonicalPath = path.join(dir, "registry", "packages", "canonical.yaml");
        const canonicalText = formatYamlDoc({ schemaVersion: 1, name: "canonical", description: "d", category: "utilities" }, PACKAGE_ORDER);
        writeFileSync(canonicalPath, canonicalText);

        const messyPath = path.join(dir, "registry", "packages", "messy.yaml");
        writeFileSync(messyPath, "name: messy\nschemaVersion: 1\ndescription: d\ncategory: utilities\n");

        const checkResults = formatRegistry({ check: true, root: dir });
        assert.equal(readFileSync(messyPath, "utf8"), "name: messy\nschemaVersion: 1\ndescription: d\ncategory: utilities\n", "check mode must not write");
        const messyCheck = checkResults.find((r) => r.file.endsWith("messy.yaml"));
        const canonicalCheck = checkResults.find((r) => r.file.endsWith("canonical.yaml"));
        assert.equal(messyCheck.changed, true);
        assert.equal(canonicalCheck.changed, false);

        formatRegistry({ check: false, root: dir });
        assert.equal(readFileSync(canonicalPath, "utf8"), canonicalText, "an already-canonical file must not be rewritten");
        assert.notEqual(readFileSync(messyPath, "utf8"), "name: messy\nschemaVersion: 1\ndescription: d\ncategory: utilities\n");
    });
});

test("the real registry is already fully canonical (locks in the Registry Completion formatting pass)", () => {
    const results = formatRegistry({ check: true });
    const changed = results.filter((r) => r.changed);
    assert.deepEqual(changed, [], `expected zero unformatted files, found: ${changed.map((c) => c.file).join(", ")}`);
});
