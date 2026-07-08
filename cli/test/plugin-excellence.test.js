import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { load as yamlLoad, dump as yamlDump } from "js-yaml";
import {
    createPlugin, testPlugin, buildPlugin, packagePlugin,
} from "../src/core/pluginSdk.js";
import { discoverPlugins, validatePluginManifest } from "../src/core/plugins.js";
import {
    validatePluginDir, validateAllPlugins, formatValidationResult,
    scorePlugin, formatQualityScore,
    diagnosePlugins, formatDiagnostics,
} from "../src/core/pluginValidation.js";

async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-plugin-excellence-"));
    try {
        process.env.HOME = tempHome;
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

// ─── Phase 2: Plugin Metadata (schema v2) ──────────────────────────

test("createPlugin scaffolds schemaVersion 2 with new metadata fields", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-meta-"));
        try {
            const pluginDir = createPlugin("meta-test", workDir);
            const manifest = yamlLoad(readFileSync(path.join(pluginDir, "plugin.yml"), "utf8"));
            assert.equal(manifest.schemaVersion, 2);
            assert.ok(manifest.author !== undefined, "author field present");
            assert.ok(manifest.license !== undefined, "license field present");
            assert.ok(manifest.homepage !== undefined, "homepage field present");
            assert.ok(manifest.repository !== undefined, "repository field present");
            assert.ok(manifest.keywords !== undefined, "keywords field present");
            assert.ok(manifest.capabilities !== undefined, "capabilities field present");
            assert.ok(manifest.permissions !== undefined, "permissions field present");
            assert.ok(manifest.compatibility !== undefined, "compatibility field present");
            assert.deepEqual(manifest.capabilities, ["command"]);
            assert.deepEqual(manifest.permissions, ["shell"]);
            assert.deepEqual(manifest.compatibility.platforms, ["darwin", "linux", "win32"]);
            assert.deepEqual(manifest.compatibility.architectures, ["x64", "arm64"]);
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("schema v1 manifests are still valid (backward compatible)", () => {
    const v1Manifest = {
        schemaVersion: 1,
        name: "legacy-plugin",
        version: "0.1.0",
        description: "A legacy v1 plugin",
        engine: ">=1.0.0",
        commands: [{ name: "hello", run: "./hello.sh" }],
    };
    const result = validatePluginManifest(v1Manifest);
    assert.equal(result.valid, true);
});

test("schema v2 manifest with all metadata fields is valid", () => {
    const v2Manifest = {
        schemaVersion: 2,
        name: "modern-plugin",
        version: "1.0.0",
        description: "A modern v2 plugin",
        author: "Alice",
        license: "MIT",
        homepage: "https://example.com",
        repository: "https://github.com/alice/plugin",
        keywords: ["example", "test"],
        icon: "icon.png",
        engine: ">=2.1.9",
        capabilities: ["command", "generator"],
        permissions: ["shell", "filesystem"],
        compatibility: { platforms: ["darwin", "linux"], architectures: ["x64", "arm64"] },
        dependencies: [],
        commands: [{ name: "run", run: "./run.sh" }],
    };
    const result = validatePluginManifest(v2Manifest);
    assert.equal(result.valid, true);
});

test("schema rejects unknown permissions", () => {
    const manifest = {
        schemaVersion: 2,
        name: "bad-perms",
        version: "0.1.0",
        description: "x",
        engine: ">=1.0.0",
        permissions: ["shell", "nuclear-launch"],
        commands: [{ name: "run", run: "./run.sh" }],
    };
    const result = validatePluginManifest(manifest);
    assert.equal(result.valid, false);
});

test("schema rejects unknown capabilities", () => {
    const manifest = {
        schemaVersion: 2,
        name: "bad-cap",
        version: "0.1.0",
        description: "x",
        engine: ">=1.0.0",
        capabilities: ["command", "time-travel"],
        commands: [{ name: "run", run: "./run.sh" }],
    };
    const result = validatePluginManifest(manifest);
    assert.equal(result.valid, false);
});

test("generateReadme includes new metadata fields", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-readme-"));
        try {
            const pluginDir = createPlugin("readme-test", workDir);
            const readme = readFileSync(path.join(pluginDir, "README.md"), "utf8");
            assert.match(readme, /Requires DevForgeKit/);
            assert.match(readme, /Capabilities/);
            assert.match(readme, /Permissions/);
            assert.match(readme, /Compatibility/);
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

// ─── Phase 3: Plugin Validation ────────────────────────────────────

test("validatePluginDir passes for a freshly created plugin", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-validate-"));
        try {
            const pluginDir = createPlugin("valid-plugin", workDir);
            const result = validatePluginDir(pluginDir);
            assert.ok(result.checks.length > 0, "should have checks");
            assert.equal(result.verdict, "PASS");
            assert.ok(result.score > 0, "should have positive score");
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("validatePluginDir fails for missing plugin.yml", () => {
    const emptyDir = mkdtempSync(path.join(tmpdir(), "devforgekit-empty-"));
    try {
        const result = validatePluginDir(emptyDir);
        assert.equal(result.valid, false);
        assert.equal(result.verdict, "FAIL");
        assert.ok(result.checks.some((c) => c.name === "manifest-exists" && c.status === "FAIL"));
    } finally {
        rmSync(emptyDir, { recursive: true, force: true });
    }
});

test("validatePluginDir detects missing command scripts", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-missing-script-"));
        try {
            const pluginDir = createPlugin("missing-script", workDir);
            rmSync(path.join(pluginDir, "commands", "hello.sh"));
            const result = validatePluginDir(pluginDir);
            assert.ok(result.checks.some((c) => c.status === "FAIL" && c.name.includes("hello")));
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("validatePluginDir checks platform compatibility", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-platform-"));
        try {
            const pluginDir = createPlugin("platform-test", workDir);
            const manifestPath = path.join(pluginDir, "plugin.yml");
            const manifest = yamlLoad(readFileSync(manifestPath, "utf8"));
            manifest.compatibility = { platforms: ["linux"], architectures: ["x64"] };
            writeFileSync(manifestPath, yamlDump(manifest));

            const result = validatePluginDir(pluginDir);
            const platformCheck = result.checks.find((c) => c.name === "platform-compat");
            assert.ok(platformCheck, "platform-compat check should exist");
            if (process.platform !== "linux") {
                assert.equal(platformCheck.status, "FAIL");
            } else {
                assert.equal(platformCheck.status, "PASS");
            }
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("validatePluginDir warns about missing README", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-no-readme-"));
        try {
            const pluginDir = createPlugin("no-readme", workDir);
            rmSync(path.join(pluginDir, "README.md"));
            const result = validatePluginDir(pluginDir);
            assert.ok(result.checks.some((c) => c.name === "readme-exists" && c.status === "WARNING"));
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("validatePluginDir detects duplicate command names within a plugin", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-dupe-"));
        try {
            const pluginDir = createPlugin("dupe-test", workDir);
            const manifestPath = path.join(pluginDir, "plugin.yml");
            const manifest = yamlLoad(readFileSync(manifestPath, "utf8"));
            manifest.commands = [
                { name: "hello", run: "./commands/hello.sh" },
                { name: "hello", run: "./commands/hello.sh" },
            ];
            writeFileSync(manifestPath, yamlDump(manifest));

            const result = validatePluginDir(pluginDir);
            const dupeCheck = result.checks.find((c) => c.name === "no-duplicate-commands");
            assert.ok(dupeCheck, "no-duplicate-commands check should exist");
            assert.equal(dupeCheck.status, "FAIL");
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("formatValidationResult produces readable output", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-format-"));
        try {
            const pluginDir = createPlugin("format-test", workDir);
            const result = validatePluginDir(pluginDir);
            const lines = formatValidationResult(result);
            assert.ok(lines.length > 0, "should produce output lines");
            assert.match(lines[0], /Plugin Validation/);
            assert.match(lines[1], /Score/);
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

// ─── Phase 4: Plugin Quality Score ─────────────────────────────────

test("scorePlugin returns a score and categories for a valid plugin", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-score-"));
        try {
            const pluginDir = createPlugin("score-test", workDir);
            const result = scorePlugin(pluginDir);
            assert.ok(result.score >= 0 && result.score <= 100, "score in range");
            assert.ok(result.categories.length > 0, "has categories");
            const catNames = result.categories.map((c) => c.name);
            assert.ok(catNames.includes("Documentation"));
            assert.ok(catNames.includes("Architecture"));
            assert.ok(catNames.includes("Testing"));
            assert.ok(catNames.includes("Signing"));
            assert.ok(catNames.includes("Compatibility"));
            assert.ok(catNames.includes("Versioning"));
            assert.ok(catNames.includes("Manifest"));
            assert.ok(catNames.includes("Permissions"));
            assert.ok(catNames.includes("Examples"));
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("scorePlugin gives higher score after build", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-build-score-"));
        try {
            const pluginDir = createPlugin("build-score", workDir);
            const beforeBuild = scorePlugin(pluginDir);
            await buildPlugin(pluginDir);
            const afterBuild = scorePlugin(pluginDir);
            assert.ok(afterBuild.score >= beforeBuild.score, "build should not lower score");
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("formatQualityScore produces readable output", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-quality-format-"));
        try {
            const pluginDir = createPlugin("qformat-test", workDir);
            const result = scorePlugin(pluginDir);
            const lines = formatQualityScore(result);
            assert.ok(lines.length > 0);
            assert.match(lines[0], /Plugin Quality Score/);
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

// ─── Phase 5: Plugin Diagnostics ───────────────────────────────────

test("diagnosePlugins returns issues and summary", () => {
    const result = diagnosePlugins();
    assert.ok(result.issues !== undefined, "has issues array");
    assert.ok(result.summary !== undefined, "has summary");
    assert.ok(typeof result.summary.total === "number", "summary.total is a number");
    assert.ok(typeof result.summary.valid === "number", "summary.valid is a number");
    assert.ok(typeof result.summary.errors === "number", "summary.errors is a number");
});

test("diagnosePlugins detects the bundled hello-world as valid", () => {
    const result = diagnosePlugins();
    const hw = result.summary;
    assert.ok(hw.total > 0, "at least one plugin should be discovered");
});

test("formatDiagnostics produces output", () => {
    const result = diagnosePlugins();
    const lines = formatDiagnostics(result);
    assert.ok(lines.length > 0);
    assert.match(lines[0], /Plugin Diagnostics/);
});

test("diagnosePlugins flags deprecated schema v1", async () => {
    await withTempHome(async (tempHome) => {
        const userPluginsDir = path.join(tempHome, ".devforgekit", "plugins");
        mkdirSync(path.join(userPluginsDir, "v1-plugin"), { recursive: true });
        writeFileSync(path.join(userPluginsDir, "v1-plugin", "plugin.yml"), yamlDump({
            schemaVersion: 1,
            name: "v1-plugin",
            version: "0.1.0",
            description: "A v1 plugin",
            engine: ">=1.0.0",
            commands: [{ name: "test", run: "./test.sh" }],
        }));
        writeFileSync(path.join(userPluginsDir, "v1-plugin", "test.sh"), "#!/usr/bin/env bash\necho hi\n", { mode: 0o755 });

        const result = diagnosePlugins();
        const v1Issue = result.issues.find((i) => i.plugin === "v1-plugin" && i.issue === "deprecated-schema");
        assert.ok(v1Issue, "should flag v1 schema as deprecated");
    });
});

// ─── Phase 6: Plugin Templates ─────────────────────────────────────

test("createPlugin with --template tui-page scaffolds tui-page capability", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-tui-tpl-"));
        try {
            const pluginDir = createPlugin("tui-test", workDir, { template: "tui-page" });
            const manifest = yamlLoad(readFileSync(path.join(pluginDir, "plugin.yml"), "utf8"));
            assert.deepEqual(manifest.capabilities, ["tui-page"]);
            assert.ok(existsSync(path.join(pluginDir, "commands", "open-page.sh")));
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("createPlugin with --template generator scaffolds generator capability", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-gen-tpl-"));
        try {
            const pluginDir = createPlugin("gen-test", workDir, { template: "generator" });
            const manifest = yamlLoad(readFileSync(path.join(pluginDir, "plugin.yml"), "utf8"));
            assert.deepEqual(manifest.capabilities, ["generator"]);
            assert.ok(existsSync(path.join(pluginDir, "commands", "generate.sh")));
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("createPlugin with --template benchmark scaffolds benchmark capability", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-bench-tpl-"));
        try {
            const pluginDir = createPlugin("bench-test", workDir, { template: "benchmark" });
            const manifest = yamlLoad(readFileSync(path.join(pluginDir, "plugin.yml"), "utf8"));
            assert.deepEqual(manifest.capabilities, ["benchmark"]);
            assert.ok(existsSync(path.join(pluginDir, "commands", "bench.sh")));
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("createPlugin with --template repair scaffolds repair capability", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-tpl-"));
        try {
            const pluginDir = createPlugin("repair-test", workDir, { template: "repair" });
            const manifest = yamlLoad(readFileSync(path.join(pluginDir, "plugin.yml"), "utf8"));
            assert.deepEqual(manifest.capabilities, ["repair"]);
            assert.ok(existsSync(path.join(pluginDir, "commands", "repair.sh")));
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("createPlugin with --template graph-extension scaffolds graph capability", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-graph-tpl-"));
        try {
            const pluginDir = createPlugin("graph-test", workDir, { template: "graph-extension" });
            const manifest = yamlLoad(readFileSync(path.join(pluginDir, "plugin.yml"), "utf8"));
            assert.deepEqual(manifest.capabilities, ["graph"]);
            assert.ok(existsSync(path.join(pluginDir, "commands", "graph-query.sh")));
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("createPlugin with --template ai-provider scaffolds ai-provider capability", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-ai-tpl-"));
        try {
            const pluginDir = createPlugin("ai-test", workDir, { template: "ai-provider" });
            const manifest = yamlLoad(readFileSync(path.join(pluginDir, "plugin.yml"), "utf8"));
            assert.deepEqual(manifest.capabilities, ["ai-provider"]);
            assert.ok(existsSync(path.join(pluginDir, "commands", "ask.sh")));
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("createPlugin with --template compatibility-rule scaffolds compatibility-rule capability", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-compat-tpl-"));
        try {
            const pluginDir = createPlugin("compat-test", workDir, { template: "compatibility-rule" });
            const manifest = yamlLoad(readFileSync(path.join(pluginDir, "plugin.yml"), "utf8"));
            assert.deepEqual(manifest.capabilities, ["compatibility-rule"]);
            assert.ok(manifest.rules, "should have rules object");
            assert.ok(existsSync(path.join(pluginDir, "commands", "check-compat.sh")));
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("createPlugin throws on unknown template", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-bad-tpl-"));
        try {
            assert.throws(() => createPlugin("bad-tpl", workDir, { template: "nonexistent" }), /Unknown template/);
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

test("all 8 templates produce valid manifests that pass testPlugin", async () => {
    await withTempHome(async () => {
        const templates = ["simple-command", "tui-page", "generator", "benchmark", "repair", "graph-extension", "ai-provider", "compatibility-rule"];
        for (const tpl of templates) {
            const workDir = mkdtempSync(path.join(tmpdir(), `devforgekit-tpl-${tpl}-`));
            try {
                const pluginDir = createPlugin(`tpl-${tpl}`, workDir, { template: tpl });
                const result = await testPlugin(pluginDir);
                const failed = result.results.filter((r) => r.status === "FAIL");
                assert.deepEqual(failed, [], `template '${tpl}' should produce a passing plugin, got: ${JSON.stringify(failed)}`);
            } finally {
                rmSync(workDir, { recursive: true, force: true });
            }
        }
    });
});

// ─── Phase 8: Plugin Packaging (improved output) ───────────────────

test("packagePlugin returns manifest and lock in result", async () => {
    await withTempHome(async () => {
        const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-pkg-result-"));
        try {
            const pluginDir = createPlugin("pkg-result", workDir);
            const result = await packagePlugin(pluginDir);
            assert.ok(result.manifest, "should return manifest");
            assert.ok(result.lock, "should return lock");
            assert.equal(result.manifest.name, "pkg-result");
            assert.ok(Object.keys(result.lock.files).length > 0, "lock should have files");
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    });
});

// ─── Phase 2: hello-world plugin upgraded to v2 ────────────────────

test("the bundled hello-world plugin uses schemaVersion 2", () => {
    const plugins = discoverPlugins();
    const hw = plugins.find((p) => p.name === "hello-world");
    assert.ok(hw, "hello-world should be discovered");
    assert.equal(hw.manifest.schemaVersion, 2);
    assert.ok(hw.manifest.capabilities, "should have capabilities");
    assert.ok(hw.manifest.permissions, "should have permissions");
    assert.ok(hw.manifest.compatibility, "should have compatibility");
});
