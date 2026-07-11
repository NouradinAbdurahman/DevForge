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

test("registry generate also produces a deterministic Brewfile category manifest for the install wizard", () => {
    execFileSync(process.execPath, [cliBin, "registry", "generate"], { stdio: "pipe" });

    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
    const categoriesPath = path.join(repoRoot, "profiles", "generated", "brewfile-categories.txt");

    const first = readFileSync(categoriesPath, "utf8");
    execFileSync(process.execPath, [cliBin, "registry", "generate"], { stdio: "pipe" });
    const second = readFileSync(categoriesPath, "utf8");
    assert.equal(first, second, "brewfile-categories.txt should be byte-identical across regenerations");

    const brewfile = readFileSync(path.join(repoRoot, "Brewfile"), "utf8");
    const brewfileIds = [...brewfile.matchAll(/^\s*(?:brew|cask)\s+"([^"]+)"/gm)].map((m) => m[1]);

    const allLines = first.split("\n").filter((l) => l && !l.startsWith("#"));
    const categoryLines = allLines.filter((l) => l.startsWith("@category|"));
    const packageLines = allLines.filter((l) => !l.startsWith("@category|"));
    assert.ok(packageLines.length > 0);
    assert.ok(categoryLines.length > 0);

    const knownCategoryIds = new Set();
    for (const line of categoryLines) {
        const [, id, label, description] = line.split("|");
        assert.match(id, /^[a-z][a-z0-9-]*$/, `malformed category id on line: ${line}`);
        assert.ok(label && label.length > 0, `missing label on line: ${line}`);
        assert.ok(description && description.length > 0, `missing description on line: ${line}`);
        knownCategoryIds.add(id);
    }

    const seenIds = new Set();
    for (const line of packageLines) {
        const [category, type, id] = line.split("|");
        assert.match(category, /^[a-z][a-z0-9-]*$/, `malformed category on line: ${line}`);
        assert.ok(knownCategoryIds.has(category), `package line references undeclared category "${category}": ${line}`);
        assert.ok(type === "brew" || type === "cask", `unexpected type on line: ${line}`);
        assert.ok(id && id.length > 0, `missing id on line: ${line}`);
        seenIds.add(id);
    }

    // Every brew/cask line in the root Brewfile must appear exactly once
    // in the generated manifest - categorized or filed under "other",
    // never silently dropped.
    for (const id of brewfileIds) {
        assert.ok(seenIds.has(id), `Brewfile package "${id}" is missing from the generated category manifest`);
    }

    // No duplicate (type, id) pairs - the manifest unions the root
    // Brewfile with every profiles/*/Brewfile (a package like "git"
    // appears in several), and must dedupe rather than emit repeats.
    const seenTypeId = new Set();
    for (const line of packageLines) {
        const [, type, id] = line.split("|");
        const key = `${type}|${id}`;
        assert.ok(!seenTypeId.has(key), `duplicate (type, id) in manifest: ${key}`);
        seenTypeId.add(key);
    }
});

test("registry generate's category manifest covers packages that only appear in a profiles/*/Brewfile, not just the root Brewfile", () => {
    execFileSync(process.execPath, [cliBin, "registry", "generate"], { stdio: "pipe" });

    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
    const categoriesPath = path.join(repoRoot, "profiles", "generated", "brewfile-categories.txt");
    const manifest = readFileSync(categoriesPath, "utf8");

    // profiles/recommended/Brewfile has `cask "docker"`, which the root
    // Brewfile does not - this package must still resolve to its real
    // registry category ("containers"), not silently fall through to
    // "other" for lack of scanning profile Brewfiles too.
    const dockerLine = manifest.split("\n").find((l) => l.match(/^\w[\w-]*\|cask\|docker\|/));
    assert.ok(dockerLine, "expected a cask|docker line in the generated manifest");
    assert.ok(!dockerLine.startsWith("other|"), `expected docker to resolve to a real category, got: ${dockerLine}`);
});
