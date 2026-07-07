// Plugin validation (v2.1.9). Comprehensive structural and integrity
// checks beyond the basic manifest schema validation in plugins.js.
// Checks: manifest schema, command/event scripts exist + executable,
// README exists, LICENSE exists (if declared), icon exists (if declared),
// engine compatible, dependency graph resolvable, no duplicate command
// names, platform/architecture compatibility.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import semver from "semver";
import { validatePluginManifest, discoverPlugins } from "./plugins.js";
import { getVersion } from "../version.js";

// validatePluginDir(dir) -> { valid, checks: [{ name, status, detail }],
// score, verdict } - runs all validation checks against a plugin
// directory and returns structured results.
export function validatePluginDir(dir) {
    const manifestPath = path.join(dir, "plugin.yml");
    const checks = [];

    // 1. Manifest exists and parses
    if (!existsSync(manifestPath)) {
        checks.push({ name: "manifest-exists", status: "FAIL", detail: "No plugin.yml found" });
        return { valid: false, checks, score: 0, verdict: "FAIL" };
    }

    let manifest;
    try {
        manifest = yaml.load(readFileSync(manifestPath, "utf8"));
        checks.push({ name: "manifest-parses", status: "PASS", detail: "plugin.yml parsed successfully" });
    } catch (err) {
        checks.push({ name: "manifest-parses", status: "FAIL", detail: `Failed to parse plugin.yml: ${err.message}` });
        return { valid: false, checks, score: 0, verdict: "FAIL" };
    }

    // 2. Manifest schema valid
    const validation = validatePluginManifest(manifest);
    checks.push({
        name: "manifest-schema",
        status: validation.valid ? "PASS" : "FAIL",
        detail: validation.valid ? "Manifest schema valid" : validation.reason
    });

    if (!validation.valid) {
        return { valid: false, checks, score: scoreChecks(checks), verdict: "FAIL" };
    }

    // 3. Engine compatibility
    const version = getVersion();
    const engineOk = semver.satisfies(version, manifest.engine, { includePrerelease: true });
    checks.push({
        name: "engine-compat",
        status: engineOk ? "PASS" : "FAIL",
        detail: engineOk ? `Engine ${manifest.engine} satisfied by ${version}` : `Requires DevForgeKit ${manifest.engine}, but this is ${version}`
    });

    // 4. Command scripts exist
    for (const cmd of manifest.commands || []) {
        const scriptPath = path.join(dir, cmd.run);
        const exists = existsSync(scriptPath);
        checks.push({
            name: `command-${cmd.name}-exists`,
            status: exists ? "PASS" : "FAIL",
            detail: exists ? `Command '${cmd.name}' script exists (${cmd.run})` : `Command '${cmd.name}' script missing (${cmd.run})`
        });
        if (exists) {
            const executable = isExecutable(scriptPath);
            checks.push({
                name: `command-${cmd.name}-executable`,
                status: executable ? "PASS" : "WARNING",
                detail: executable ? `Command '${cmd.name}' script is executable` : `Command '${cmd.name}' script is not executable`
            });
        }
    }

    // 5. Event scripts exist
    for (const evt of manifest.events || []) {
        const scriptPath = path.join(dir, evt.run);
        const exists = existsSync(scriptPath);
        checks.push({
            name: `event-${evt.event}-exists`,
            status: exists ? "PASS" : "FAIL",
            detail: exists ? `Event '${evt.event}' script exists (${evt.run})` : `Event '${evt.event}' script missing (${evt.run})`
        });
        if (exists) {
            const executable = isExecutable(scriptPath);
            checks.push({
                name: `event-${evt.event}-executable`,
                status: executable ? "PASS" : "WARNING",
                detail: executable ? `Event '${evt.event}' script is executable` : `Event '${evt.event}' script is not executable`
            });
        }
    }

    // 6. README exists
    const readmeExists = existsSync(path.join(dir, "README.md"));
    checks.push({
        name: "readme-exists",
        status: readmeExists ? "PASS" : "WARNING",
        detail: readmeExists ? "README.md present" : "No README.md found (recommended for documentation)"
    });

    // 7. LICENSE exists (if declared)
    if (manifest.license) {
        const licenseExists = existsSync(path.join(dir, "LICENSE")) || existsSync(path.join(dir, "LICENSE.md"));
        checks.push({
            name: "license-file",
            status: licenseExists ? "PASS" : "WARNING",
            detail: licenseExists ? "LICENSE file present" : `License declared as '${manifest.license}' but no LICENSE file found`
        });
    }

    // 8. Icon exists (if declared)
    if (manifest.icon) {
        const iconPath = path.join(dir, manifest.icon);
        const iconExists = existsSync(iconPath);
        checks.push({
            name: "icon-exists",
            status: iconExists ? "PASS" : "WARNING",
            detail: iconExists ? "Icon file present" : `Icon declared but file not found at ${manifest.icon}`
        });
    }

    // 9. Platform compatibility
    if (manifest.compatibility?.platforms?.length) {
        const currentPlatform = process.platform;
        const platformOk = manifest.compatibility.platforms.includes(currentPlatform);
        checks.push({
            name: "platform-compat",
            status: platformOk ? "PASS" : "FAIL",
            detail: platformOk ? `Platform ${currentPlatform} supported` : `Plugin supports ${manifest.compatibility.platforms.join(", ")}, but this is ${currentPlatform}`
        });
    }

    // 10. Architecture compatibility
    if (manifest.compatibility?.architectures?.length) {
        const currentArch = process.arch;
        const archOk = manifest.compatibility.architectures.includes(currentArch);
        checks.push({
            name: "arch-compat",
            status: archOk ? "PASS" : "FAIL",
            detail: archOk ? `Architecture ${currentArch} supported` : `Plugin supports ${manifest.compatibility.architectures.join(", ")}, but this is ${currentArch}`
        });
    }

    // 11. Dependencies resolvable
    if (manifest.dependencies?.length) {
        const allPlugins = discoverPlugins();
        for (const depName of manifest.dependencies) {
            const dep = allPlugins.find((p) => p.name === depName);
            checks.push({
                name: `dep-${depName}`,
                status: dep?.valid ? "PASS" : "WARNING",
                detail: dep?.valid ? `Dependency '${depName}' found and valid` : dep ? `Dependency '${depName}' found but invalid: ${dep.reason}` : `Dependency '${depName}' not found`
            });
        }
    }

    // 12. No duplicate command names within this plugin
    if (manifest.commands?.length) {
        const names = manifest.commands.map((c) => c.name);
        const dupes = names.filter((n, i) => names.indexOf(n) !== i);
        checks.push({
            name: "no-duplicate-commands",
            status: dupes.length === 0 ? "PASS" : "FAIL",
            detail: dupes.length === 0 ? "No duplicate command names" : `Duplicate command names: ${dupes.join(", ")}`
        });
    }

    // 13. Version is valid semver
    const versionValid = semver.valid(manifest.version);
    checks.push({
        name: "version-semver",
        status: versionValid ? "PASS" : "WARNING",
        detail: versionValid ? `Version ${manifest.version} is valid semver` : `Version '${manifest.version}' is not valid semver`
    });

    // 14. Test directory exists
    const testsDirExists = existsSync(path.join(dir, "tests"));
    checks.push({
        name: "tests-dir",
        status: testsDirExists ? "PASS" : "WARNING",
        detail: testsDirExists ? "tests/ directory present" : "No tests/ directory found (recommended for quality)"
    });

    const score = scoreChecks(checks);
    const hasFail = checks.some((c) => c.status === "FAIL");
    return { valid: !hasFail, checks, score, verdict: hasFail ? "FAIL" : score >= 80 ? "PASS" : "WARNING" };
}

// validateAllPlugins() -> [{ name, dir, ...validatePluginDir() }] -
// validates every discovered plugin and returns structured results.
export function validateAllPlugins() {
    const plugins = discoverPlugins();
    return plugins.map((p) => {
        if (!p.manifest) {
            return { name: p.name, dir: p.dir, valid: false, checks: [{ name: "manifest-parses", status: "FAIL", detail: p.reason }], score: 0, verdict: "FAIL" };
        }
        const result = validatePluginDir(p.dir);
        return { name: p.name, dir: p.dir, ...result };
    });
}

// formatValidationResult(result) -> string[] of lines for CLI output.
export function formatValidationResult(result) {
    const lines = [];
    const pass = result.checks.filter((c) => c.status === "PASS").length;
    const warn = result.checks.filter((c) => c.status === "WARNING").length;
    const fail = result.checks.filter((c) => c.status === "FAIL").length;

    lines.push(`Plugin Validation: ${result.checks.length} checks — ${pass} pass, ${warn} warn, ${fail} fail`);
    lines.push(`Score: ${result.score}% — Verdict: ${result.verdict}`);
    lines.push("");
    lines.push("  Check                          Status  Detail");
    lines.push("  ──────────────────────────────────────────────────────────────");

    for (const c of result.checks) {
        const name = c.name.padEnd(30).slice(0, 30);
        const status = c.status === "PASS" ? "✓ pass" : c.status === "WARNING" ? "⚠ warn" : "✗ fail";
        const detail = c.detail.slice(0, 50);
        lines.push(`  ${name}  ${status}  ${detail}`);
    }

    return lines;
}

// ─── Plugin Quality Score (Phase 4) ────────────────────────────────

// scorePlugin(dir) -> { score, categories: [{ name, score, checks }],
// verdict } - multi-dimensional quality assessment.
export function scorePlugin(dir) {
    const manifestPath = path.join(dir, "plugin.yml");
    let manifest = null;
    try {
        manifest = yaml.load(readFileSync(manifestPath, "utf8"));
    } catch { /* handled below */ }

    const categories = [];

    // Documentation
    const docChecks = [];
    docChecks.push(check(existsSync(path.join(dir, "README.md")), "README.md present"));
    if (manifest?.description) docChecks.push(check(true, "Description provided"));
    if (manifest?.license) docChecks.push(check(existsSync(path.join(dir, "LICENSE")) || existsSync(path.join(dir, "LICENSE.md")), "LICENSE file present"));
    if (manifest?.homepage) docChecks.push(check(true, "Homepage provided"));
    if (manifest?.repository) docChecks.push(check(true, "Repository provided"));
    categories.push(categoryScore("Documentation", docChecks));

    // Architecture
    const archChecks = [];
    if (manifest?.capabilities?.length) archChecks.push(check(true, `Capabilities declared: ${manifest.capabilities.join(", ")}`));
    if (manifest?.permissions?.length) archChecks.push(check(true, `Permissions declared: ${manifest.permissions.join(", ")}`));
    if (manifest?.compatibility) archChecks.push(check(true, "Compatibility constraints declared"));
    const cmdCount = manifest?.commands?.length || 0;
    const evtCount = manifest?.events?.length || 0;
    archChecks.push(check(cmdCount + evtCount > 0, "At least one command or event declared"));
    if (manifest?.dependencies?.length) archChecks.push(check(true, `Dependencies declared: ${manifest.dependencies.length}`));
    categories.push(categoryScore("Architecture", archChecks));

    // Testing
    const testChecks = [];
    testChecks.push(check(existsSync(path.join(dir, "tests")), "tests/ directory present"));
    if (existsSync(path.join(dir, "tests"))) {
        const testFiles = readdirSync(path.join(dir, "tests")).filter((f) => f.endsWith(".sh"));
        testChecks.push(check(testFiles.length > 0, `${testFiles.length} test script(s) found`));
    }
    categories.push(categoryScore("Testing", testChecks));

    // Signing
    const signChecks = [];
    signChecks.push(check(existsSync(path.join(dir, "plugin.lock.json")), "plugin.lock.json present (built)"));
    categories.push(categoryScore("Signing", signChecks));

    // Compatibility
    const compatChecks = [];
    if (manifest?.engine) {
        const version = getVersion();
        const engineOk = semver.satisfies(version, manifest.engine, { includePrerelease: true });
        compatChecks.push(check(engineOk, `Engine ${manifest.engine} satisfied by ${version}`));
    }
    if (manifest?.compatibility?.platforms?.length) {
        compatChecks.push(check(manifest.compatibility.platforms.includes(process.platform), `Platform ${process.platform} supported`));
    }
    if (manifest?.compatibility?.architectures?.length) {
        compatChecks.push(check(manifest.compatibility.architectures.includes(process.arch), `Architecture ${process.arch} supported`));
    }
    categories.push(categoryScore("Compatibility", compatChecks));

    // Versioning
    const versionChecks = [];
    if (manifest?.version) {
        versionChecks.push(check(Boolean(semver.valid(manifest.version)), `Version ${manifest.version} is valid semver`));
    }
    if (manifest?.schemaVersion) {
        versionChecks.push(check(manifest.schemaVersion >= 2, `Schema version ${manifest.schemaVersion} (v2+ recommended)`));
    }
    categories.push(categoryScore("Versioning", versionChecks));

    // Manifest
    const manifestChecks = [];
    if (manifest) {
        const validation = validatePluginManifest(manifest);
        manifestChecks.push(check(validation.valid, validation.valid ? "Manifest schema valid" : validation.reason));
    } else {
        manifestChecks.push(check(false, "No plugin.yml found"));
    }
    categories.push(categoryScore("Manifest", manifestChecks));

    // Permissions
    const permChecks = [];
    if (manifest?.permissions?.length) {
        const knownPerms = ["filesystem", "network", "env", "shell", "subprocess"];
        const allKnown = manifest.permissions.every((p) => knownPerms.includes(p));
        permChecks.push(check(allKnown, `All permissions recognized: ${manifest.permissions.join(", ")}`));
    } else {
        permChecks.push(check(true, "No special permissions required"));
    }
    categories.push(categoryScore("Permissions", permChecks));

    // Examples
    const exampleChecks = [];
    exampleChecks.push(check(existsSync(path.join(dir, "commands")), "commands/ directory present"));
    if (manifest?.commands?.length) {
        for (const cmd of manifest.commands) {
            exampleChecks.push(check(existsSync(path.join(dir, cmd.run)), `Command script exists: ${cmd.run}`));
        }
    }
    categories.push(categoryScore("Examples", exampleChecks));

    const overallScore = Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length);
    const verdict = overallScore >= 80 ? "PASS" : overallScore >= 50 ? "WARNING" : "FAIL";

    return { score: overallScore, categories, verdict };
}

// formatQualityScore(result) -> string[] of lines for CLI output.
export function formatQualityScore(result) {
    const lines = [];
    lines.push(`Plugin Quality Score: ${result.score}% — ${result.verdict}`);
    lines.push("");
    lines.push("  Category          Score  Checks");
    lines.push("  ─────────────────────────────────────");

    for (const cat of result.categories) {
        const name = cat.name.padEnd(16).slice(0, 16);
        const score = `${cat.score}%`.padStart(5);
        const passed = cat.checks.filter((c) => c.status === "PASS").length;
        lines.push(`  ${name}  ${score}   ${passed}/${cat.checks.length} passed`);
    }

    lines.push("");
    for (const cat of result.categories) {
        const failed = cat.checks.filter((c) => c.status !== "PASS");
        if (failed.length > 0) {
            lines.push(`  ${cat.name}:`);
            for (const f of failed) {
                const icon = f.status === "WARNING" ? "⚠" : "✗";
                lines.push(`    ${icon} ${f.detail}`);
            }
        }
    }

    return lines;
}

// ─── Plugin Diagnostics (Phase 5) ──────────────────────────────────

// diagnosePlugins() -> { issues: [{ severity, plugin, issue, detail }],
// summary: { total, valid, invalid, warnings, errors } } - scans all
// discovered plugins for common problems.
export function diagnosePlugins() {
    const plugins = discoverPlugins();
    const issues = [];
    const seenCommands = new Map();

    for (const p of plugins) {
        if (!p.valid) {
            issues.push({ severity: "error", plugin: p.name, issue: "invalid-plugin", detail: p.reason });
            continue;
        }

        const m = p.manifest;

        // Check for duplicate command names across plugins
        for (const cmd of m.commands || []) {
            if (seenCommands.has(cmd.name)) {
                issues.push({
                    severity: "warning",
                    plugin: p.name,
                    issue: "duplicate-command",
                    detail: `Command '${cmd.name}' also declared by '${seenCommands.get(cmd.name)}'`
                });
            } else {
                seenCommands.set(cmd.name, p.name);
            }
        }

        // Check for missing command scripts
        for (const cmd of m.commands || []) {
            if (!existsSync(path.join(p.dir, cmd.run))) {
                issues.push({ severity: "error", plugin: p.name, issue: "missing-script", detail: `Command '${cmd.name}' script missing: ${cmd.run}` });
            }
        }

        // Check for missing event scripts
        for (const evt of m.events || []) {
            if (!existsSync(path.join(p.dir, evt.run))) {
                issues.push({ severity: "error", plugin: p.name, issue: "missing-script", detail: `Event '${evt.event}' script missing: ${evt.run}` });
            }
        }

        // Check for missing dependencies
        for (const dep of m.dependencies || []) {
            const depPlugin = plugins.find((pp) => pp.name === dep);
            if (!depPlugin) {
                issues.push({ severity: "warning", plugin: p.name, issue: "missing-dependency", detail: `Dependency '${dep}' not found` });
            } else if (!depPlugin.valid) {
                issues.push({ severity: "warning", plugin: p.name, issue: "invalid-dependency", detail: `Dependency '${dep}' is invalid: ${depPlugin.reason}` });
            }
        }

        // Check for missing signature (no .sig file in plugin dir)
        // This is informational — unsigned plugins are allowed
        if (!existsSync(path.join(p.dir, "plugin.lock.json"))) {
            issues.push({ severity: "info", plugin: p.name, issue: "not-built", detail: "No plugin.lock.json — plugin has not been built" });
        }

        // Check for deprecated schemaVersion
        if (m.schemaVersion === 1) {
            issues.push({ severity: "info", plugin: p.name, issue: "deprecated-schema", detail: "Schema version 1 is deprecated — upgrade to v2 for metadata fields" });
        }

        // Check for missing README
        if (!existsSync(path.join(p.dir, "README.md"))) {
            issues.push({ severity: "info", plugin: p.name, issue: "missing-readme", detail: "No README.md found" });
        }

        // Check for missing LICENSE
        if (m.license && !existsSync(path.join(p.dir, "LICENSE")) && !existsSync(path.join(p.dir, "LICENSE.md"))) {
            issues.push({ severity: "info", plugin: p.name, issue: "missing-license-file", detail: `License '${m.license}' declared but no LICENSE file found` });
        }

        // Check platform compatibility
        if (m.compatibility?.platforms?.length && !m.compatibility.platforms.includes(process.platform)) {
            issues.push({
                severity: "warning",
                plugin: p.name,
                issue: "platform-incompatible",
                detail: `Plugin supports ${m.compatibility.platforms.join(", ")}, but this is ${process.platform}`
            });
        }

        // Check architecture compatibility
        if (m.compatibility?.architectures?.length && !m.compatibility.architectures.includes(process.arch)) {
            issues.push({
                severity: "warning",
                plugin: p.name,
                issue: "arch-incompatible",
                detail: `Plugin supports ${m.compatibility.architectures.join(", ")}, but this is ${process.arch}`
            });
        }
    }

    const errors = issues.filter((i) => i.severity === "error").length;
    const warnings = issues.filter((i) => i.severity === "warning").length;
    const valid = plugins.filter((p) => p.valid).length;
    const invalid = plugins.length - valid;

    return {
        issues,
        summary: { total: plugins.length, valid, invalid, warnings, errors }
    };
}

// formatDiagnostics(result) -> string[] of lines for CLI output.
export function formatDiagnostics(result) {
    const lines = [];
    const s = result.summary;
    lines.push(`Plugin Diagnostics: ${s.total} plugin(s) — ${s.valid} valid, ${s.invalid} invalid, ${s.warnings} warnings, ${s.errors} errors`);
    lines.push("");

    if (result.issues.length === 0) {
        lines.push("  No issues found — all plugins healthy.");
        return lines;
    }

    const errors = result.issues.filter((i) => i.severity === "error");
    const warnings = result.issues.filter((i) => i.severity === "warning");
    const infos = result.issues.filter((i) => i.severity === "info");

    if (errors.length > 0) {
        lines.push("  Errors:");
        for (const i of errors) {
            lines.push(`    ✗ [${i.plugin}] ${i.issue}: ${i.detail}`);
        }
        lines.push("");
    }

    if (warnings.length > 0) {
        lines.push("  Warnings:");
        for (const i of warnings) {
            lines.push(`    ⚠ [${i.plugin}] ${i.issue}: ${i.detail}`);
        }
        lines.push("");
    }

    if (infos.length > 0) {
        lines.push("  Info:");
        for (const i of infos) {
            lines.push(`    ℹ [${i.plugin}] ${i.issue}: ${i.detail}`);
        }
    }

    return lines;
}

// ─── Helpers ───────────────────────────────────────────────────────

function isExecutable(filePath) {
    try {
        const stat = statSync(filePath);
        return Boolean(stat.mode & 0o111);
    } catch {
        return false;
    }
}

function scoreChecks(checks) {
    if (checks.length === 0) return 0;
    const pass = checks.filter((c) => c.status === "PASS").length;
    const warn = checks.filter((c) => c.status === "WARNING").length;
    return Math.round(((pass + warn * 0.5) / checks.length) * 100);
}

function check(ok, detail) {
    return { status: ok ? "PASS" : "FAIL", detail };
}

function categoryScore(name, checks) {
    if (checks.length === 0) return { name, score: 0, checks };
    const pass = checks.filter((c) => c.status === "PASS").length;
    return { name, score: Math.round((pass / checks.length) * 100), checks };
}
