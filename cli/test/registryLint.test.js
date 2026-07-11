// devforgekit registry lint (Registry Completion, v3.0) - structural
// checks (schema violations, duplicate IDs/binaries/aliases, cyclic
// dependencies, orphans) distinct from `registry doctor`/`registry audit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dump as yamlDump } from "js-yaml";
import { lintRegistry } from "../src/core/registryLint.js";

function withFixtureRegistry(packages, { categories = [{ id: "utilities", label: "Utilities", description: "d" }], collections = [], profiles = [] } = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), "dfk-registry-lint-"));
    for (const kind of ["categories", "packages", "collections", "profiles", "recipes"]) {
        mkdirSync(path.join(dir, "registry", kind), { recursive: true });
    }
    for (const c of categories) {
        writeFileSync(path.join(dir, "registry", "categories", `${c.id}.yaml`), yamlDump(c));
    }
    for (const p of packages) {
        writeFileSync(path.join(dir, "registry", "packages", `${p.name}.yaml`), yamlDump(p));
    }
    for (const c of collections) {
        writeFileSync(path.join(dir, "registry", "collections", `${c.name}.yaml`), yamlDump(c));
    }
    for (const p of profiles) {
        writeFileSync(path.join(dir, "registry", "profiles", `${p.name}.yaml`), yamlDump(p));
    }
    return dir;
}

function basePkg(overrides) {
    return {
        schemaVersion: 1,
        name: "x",
        description: "d",
        category: "utilities",
        platforms: ["macos"],
        install: { method: "shell", command: "echo hi" },
        ...overrides
    };
}

test("lintRegistry() reports zero errors and zero non-orphan warnings for a clean fixture registry", () => {
    const dir = withFixtureRegistry([basePkg({ name: "a" })]);
    try {
        const result = lintRegistry({ root: dir });
        assert.deepEqual(result.errors, []);
        assert.deepEqual(result.warnings.filter((w) => w.type !== "orphan_package"), []);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("lintRegistry() reports a schema violation with the exact file and field", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dfk-registry-lint-"));
    mkdirSync(path.join(dir, "registry", "packages"), { recursive: true });
    mkdirSync(path.join(dir, "registry", "categories"), { recursive: true });
    writeFileSync(path.join(dir, "registry", "packages", "broken.yaml"), "schemaVersion: 1\nname: broken\n");
    try {
        const result = lintRegistry({ root: dir });
        const violation = result.errors.find((e) => e.type === "schema_violation");
        assert.ok(violation, "expected a schema_violation error");
        assert.equal(violation.file, path.join("packages", "broken.yaml"));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("lintRegistry() flags a package whose declared name doesn't match its filename", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dfk-registry-lint-"));
    mkdirSync(path.join(dir, "registry", "packages"), { recursive: true });
    mkdirSync(path.join(dir, "registry", "categories"), { recursive: true });
    writeFileSync(path.join(dir, "registry", "categories", "utilities.yaml"), yamlDump({ id: "utilities", label: "Utilities", description: "d" }));
    writeFileSync(path.join(dir, "registry", "packages", "wrong-file.yaml"), yamlDump(basePkg({ name: "right-name" })));
    try {
        const result = lintRegistry({ root: dir });
        const finding = result.errors.find((e) => e.type === "duplicate_id");
        assert.ok(finding, "expected a duplicate_id (filename mismatch) error");
        assert.match(finding.message, /right-name.*wrong-file\.yaml/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("lintRegistry() detects a circular dependency", () => {
    const dir = withFixtureRegistry([
        basePkg({ name: "a", dependencies: ["b"] }),
        basePkg({ name: "b", dependencies: ["a"] })
    ]);
    try {
        const result = lintRegistry({ root: dir });
        const cycle = result.errors.find((e) => e.type === "cyclic_dependency");
        assert.ok(cycle, "expected a cyclic_dependency error");
        assert.match(cycle.message, /a -> b -> a/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("lintRegistry() warns about a package not referenced by any collection/profile/recipe (orphan)", () => {
    const dir = withFixtureRegistry(
        [basePkg({ name: "referenced" }), basePkg({ name: "orphaned" })],
        { collections: [{ schemaVersion: 1, name: "c", description: "d", components: ["referenced"] }] }
    );
    try {
        const result = lintRegistry({ root: dir });
        const orphan = result.warnings.find((w) => w.type === "orphan_package" && w.message.includes("orphaned"));
        assert.ok(orphan, "expected 'orphaned' to be flagged, 'referenced' should not be");
        assert.ok(!result.warnings.some((w) => w.type === "orphan_package" && w.message.includes("'referenced'")));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("lintRegistry() warns about two packages probing the same binary, naming both owners", () => {
    const dir = withFixtureRegistry([
        basePkg({ name: "tool-a", validate: "shared-binary --version" }),
        basePkg({ name: "tool-b", validate: "shared-binary --help" })
    ]);
    try {
        const result = lintRegistry({ root: dir });
        const dup = result.warnings.find((w) => w.type === "duplicate_binary");
        assert.ok(dup, "expected a duplicate_binary warning");
        assert.match(dup.message, /tool-a/);
        assert.match(dup.message, /tool-b/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("lintRegistry() over the real registry: zero errors, zero non-orphan warnings (locks in Registry Completion's dedup/cycle fixes)", () => {
    const result = lintRegistry();
    assert.deepEqual(result.errors, []);
    const nonOrphan = result.warnings.filter((w) => w.type !== "orphan_package");
    assert.deepEqual(nonOrphan, [], `expected no duplicate-binary/duplicate-alias/cycle warnings, found: ${JSON.stringify(nonOrphan)}`);
});
