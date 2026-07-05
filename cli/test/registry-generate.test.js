import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliBin = fileURLToPath(new URL("../bin/devforgekit.js", import.meta.url));

test("registry generate produces a valid, deterministic registry.json and docs/Registry.md", () => {
    execFileSync(process.execPath, [cliBin, "registry", "generate"], { stdio: "pipe" });

    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
    const registryJsonPath = path.join(repoRoot, "registry", "registry.json");
    const docsPath = path.join(repoRoot, "docs", "Registry.md");

    const first = readFileSync(registryJsonPath, "utf8");
    const firstDocs = readFileSync(docsPath, "utf8");

    execFileSync(process.execPath, [cliBin, "registry", "generate"], { stdio: "pipe" });
    const second = readFileSync(registryJsonPath, "utf8");
    const secondDocs = readFileSync(docsPath, "utf8");

    assert.equal(first, second, "registry.json should be byte-identical across regenerations");
    assert.equal(firstDocs, secondDocs, "docs/Registry.md should be byte-identical across regenerations");

    const parsed = JSON.parse(first);
    assert.ok(Array.isArray(parsed.packages) && parsed.packages.length > 0);
    assert.ok(Array.isArray(parsed.categories) && parsed.categories.length > 0);
    assert.ok(Array.isArray(parsed.collections) && parsed.collections.length > 0);
    assert.ok(Array.isArray(parsed.searchIndex) && parsed.searchIndex.length === parsed.packages.length);

    assert.match(firstDocs, /AUTO-GENERATED/);
});
