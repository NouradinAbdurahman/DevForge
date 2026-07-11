import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { getComponentStatus, getAllComponentStatuses, componentHealthScore } from "../src/core/componentManager.js";
import { saveEnvironmentState } from "../src/core/environment/state.js";

// Everything below is a synthetic package + injected validate/discover/
// capture - no real shell command ever runs, and no real registry
// package name is required, so results are deterministic on any
// machine/CI regardless of what's actually installed there.
async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-componentmanager-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

const FLUTTER = {
    name: "flutter",
    description: "Fake Flutter",
    category: "mobile",
    validate: "true",
    repair: "true",
    update: "true",
    uninstall: { method: "shell", command: "true" },
    dependencies: ["dart", "java", "missing-dep"],
    environment: { path: ["$HOME/flutter/bin"] }
};
const DART = { name: "dart", description: "Fake Dart", category: "languages", validate: "true" };
const JAVA = { name: "java", description: "Fake Java", category: "languages", validate: "false" };
const PACKAGES = [FLUTTER, DART, JAVA];

function resolver(packages) {
    return (name) => {
        const pkg = packages.find((p) => p.name === name);
        if (!pkg) throw new Error(`unknown: ${name}`);
        return pkg;
    };
}

const fakeValidate = async (pkg) => (pkg.validate === "true" ? 0 : 1);
const fakeDiscover = async (pkg) => ({
    binary: pkg.name,
    location: `/fake/bin/${pkg.name}`,
    version: "9.9.9",
    provider: "brew-formula",
    declared: Boolean(pkg.environment),
    verified: true,
    lastVerified: "2026-01-01T00:00:00.000Z"
});
const fakeCaptureNoConflict = async () => ({ code: 0, stdout: "/fake/bin/flutter\n" });

test("getComponentStatus() aggregates install/version/provider/dependencies/environment for an installed component", async () => {
    await withTempHome(async () => {
        const status = await getComponentStatus("flutter", {
            packages: PACKAGES,
            resolvePackage: resolver(PACKAGES),
            validateFn: fakeValidate,
            discover: fakeDiscover,
            capture: fakeCaptureNoConflict,
            outdatedList: []
        });

        assert.equal(status.installed, true);
        assert.equal(status.version, "9.9.9");
        assert.equal(status.provider, "brew-formula");
        assert.equal(status.binary, "/fake/bin/flutter");
        assert.equal(status.conflict, null);
        assert.equal(status.environment.healthy, true);
        assert.deepEqual(
            status.dependencies,
            [
                { name: "dart", installed: true },
                { name: "java", installed: false },
                { name: "missing-dep", installed: false, missing: true }
            ]
        );
        assert.deepEqual(status.capabilities, { repair: true, update: true, uninstall: true, validate: true });
    });
});

test("getComponentStatus() reports a component with no validate command as not installed, never guessed", async () => {
    await withTempHome(async () => {
        const pkg = { name: "no-validate", description: "x", category: "x" };
        const status = await getComponentStatus("no-validate", {
            packages: [pkg],
            resolvePackage: () => pkg,
            validateFn: fakeValidate,
            discover: fakeDiscover,
            outdatedList: []
        });
        assert.equal(status.installed, false);
        assert.equal(status.version, null);
        assert.equal(status.updateAvailable, null, "update status is unknown, not false, for an uninstalled package");
    });
});

test("getComponentStatus() throws a clear error for an unknown component", async () => {
    await withTempHome(async () => {
        await assert.rejects(
            () => getComponentStatus("nope", { packages: [], resolvePackage: resolver([]) }),
            /Unknown component 'nope'/
        );
    });
});

test("getComponentStatus() surfaces a real multi-installation conflict via the injected capture", async () => {
    await withTempHome(async () => {
        const status = await getComponentStatus("flutter", {
            packages: PACKAGES,
            resolvePackage: resolver(PACKAGES),
            validateFn: fakeValidate,
            discover: fakeDiscover,
            capture: async (cmd) => {
                if (cmd.startsWith("which -a")) return { code: 0, stdout: "/opt/homebrew/bin/flutter\n/usr/local/bin/flutter\n" };
                return { code: 0, stdout: "" };
            },
            outdatedList: []
        });
        assert.ok(status.conflict);
        assert.equal(status.conflict.locations.length, 2);
    });
});

test("getComponentStatus() reports updateAvailable from the injected outdated list, matching aliases too", async () => {
    await withTempHome(async () => {
        const aliased = { ...JAVA, aliases: ["jdk"] };
        const status = await getComponentStatus("java", {
            packages: [aliased],
            resolvePackage: () => aliased,
            validateFn: async () => 0,
            discover: fakeDiscover,
            outdatedList: ["jdk"]
        });
        assert.equal(status.updateAvailable, true);
    });
});

test("getComponentStatus() prefers already-tracked environment facts over a fresh discovery probe", async () => {
    await withTempHome(async () => {
        saveEnvironmentState({
            packages: { java: { provider: "mise", binary: "java", location: "/tracked/java", version: "21", declared: false, verified: true, lastVerified: "2026-01-01T00:00:00.000Z" } },
            files: {}, generatedAt: null, version: 2
        });
        let discoverCalled = false;
        const status = await getComponentStatus("java", {
            packages: [JAVA],
            resolvePackage: () => JAVA,
            validateFn: async () => 0,
            discover: async (pkg) => { discoverCalled = true; return fakeDiscover(pkg); },
            outdatedList: []
        });
        assert.equal(status.version, "21");
        assert.equal(status.binary, "/tracked/java");
        assert.equal(discoverCalled, false, "a verified tracked entry short-circuits a redundant discovery probe");
    });
});

test("getAllComponentStatuses() runs every package (bounded concurrency) and can filter to installed only", async () => {
    await withTempHome(async () => {
        const opts = {
            packages: PACKAGES,
            concurrency: 2,
            resolvePackage: resolver(PACKAGES),
            validateFn: fakeValidate,
            discover: fakeDiscover,
            capture: fakeCaptureNoConflict,
            outdatedList: []
        };
        const all = await getAllComponentStatuses(opts);
        assert.equal(all.length, 3);
        const flutterStatus = all.find((s) => s.name === "flutter");
        assert.equal(flutterStatus.installed, true);
        const javaStatus = all.find((s) => s.name === "java");
        assert.equal(javaStatus.installed, false);

        const installedOnly = await getAllComponentStatuses({ ...opts, onlyInstalled: true });
        assert.ok(installedOnly.every((s) => s.installed));
        assert.ok(installedOnly.some((s) => s.name === "flutter"));
        assert.ok(!installedOnly.some((s) => s.name === "java"));
    });
});

test("componentHealthScore() is 100 for a clean install, penalized for environment issues and conflicts", () => {
    assert.equal(componentHealthScore({ installed: true, environment: { issues: [] }, conflict: null }).score, 100);
    assert.equal(componentHealthScore({ installed: false, environment: null, conflict: null }).score, 0);
    const withConflict = componentHealthScore({ installed: true, environment: { issues: [] }, conflict: { locations: [] } });
    assert.ok(withConflict.score < 100 && withConflict.score > 0);
});
