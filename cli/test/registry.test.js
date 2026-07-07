import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadCategories, loadPackages, getPackage } from "../src/core/registry.js";

const fixturesDir = path.join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "registry-bad");

test("the real registry/categories directory is all schema-valid", () => {
    const categories = loadCategories();
    assert.ok(categories.length >= 9, "expected at least the 9 documented categories");
    for (const c of categories) {
        assert.ok(c.id && c.label && c.description);
    }
});

test("the real registry/packages directory is all schema-valid", () => {
    const packages = loadPackages();
    assert.ok(packages.length >= 10, "expected at least the 10 seeded packages");
    for (const p of packages) {
        assert.equal(p.schemaVersion, 1);
        assert.ok(p.install || p.variants, `${p.name} must have install or variants`);
    }
});

test("a category missing a required field is rejected with a clear error", () => {
    assert.throws(
        () => loadCategories(path.join(fixturesDir, "categories")),
        /Invalid category manifest/
    );
});

test("a package missing install/variants is rejected with a clear error", () => {
    assert.throws(
        () => loadPackages(path.join(fixturesDir, "packages")),
        /Invalid package manifest/
    );
});

test("getPackage returns the docker manifest with all variants", () => {
    const docker = getPackage("docker");
    assert.equal(docker.name, "docker");
    assert.ok(docker.variants.length >= 2, "docker should have at least 2 variants");
    const variantIds = docker.variants.map(v => v.id);
    assert.ok(variantIds.includes("docker-desktop"));
    assert.ok(variantIds.includes("colima"));
});

test("getPackage throws a DevForgeError for an unknown component", () => {
    assert.throws(() => getPackage("does-not-exist"), /Unknown component/);
});
