// The Compatibility Engine's scan/score entry point (see
// docs/CompatibilityEngine.md). scanCompatibility() is the one function
// every integration point (Doctor, Recipe Engine, Profiles, Project
// Generator, Workspace Manager, Dashboard) calls into.
import os from "node:os";
import { loadPackages } from "../registry.js";
import { captureShellCommand } from "../shell.js";
import { getPlatform } from "../platform/index.js";
import { loadCompatibilityRules, getRulesForPackage } from "./rules.js";
import { detectInstalledVersion } from "./versions.js";
import { matchesVersion, findVersionRule } from "./versionMatch.js";
import { buildDependencyGraph, detectCycles } from "./graph.js";

export function currentPlatform() {
    return getPlatform().id;
}

// currentArchitecture() intentionally stays in the registry schema's own
// "intel"/"apple-silicon" vocabulary (package.schema.json's
// `architectures` enum only defines intel/apple-silicon/linux) rather
// than delegating to Platform.architecture()'s generic arm64/x64/arm -
// this function's contract is "match what a package manifest declares",
// not "describe the CPU", and scanCompatibility() below already exempts
// Linux from this check entirely (`platform !== "linux"`).
export function currentArchitecture() {
    return os.arch() === "arm64" ? "apple-silicon" : "intel";
}

// evaluateRequirements - shared by a rule's top-level `requires` (plugin-
// contributed rules only) and a matched version rule's `requires`/
// `recommends`. `severity` is the tier assigned when the requirement is
// unmet in any way (unknown package, not installed, version mismatch);
// an unverifiable version always reports as WARNING regardless, since
// "cannot tell" is never the same as "definitely broken".
async function evaluateRequirements(issues, toolName, versionLabel, requirements, severity, byName, requested, getVersion) {
    const label = versionLabel ? `${toolName} ${versionLabel}` : toolName;
    for (const [depName, range] of Object.entries(requirements || {})) {
        const depPkg = byName.get(depName);
        if (!depPkg) {
            issues.push({ severity, tool: toolName, message: `${label} requires '${depName}' (${range}), which is not a known registry component` });
            continue;
        }
        const depVersion = await getVersion(depName);
        if (!requested.has(depName) && depVersion === null) {
            issues.push({
                severity,
                tool: toolName,
                dependency: depName,
                message: `${label} requires '${depName}' ${range}, which is not installed`,
                recommendation: `devforgekit component install ${depName}`
            });
            continue;
        }
        const satisfied = matchesVersion(depVersion, range);
        if (satisfied === false) {
            issues.push({
                severity,
                tool: toolName,
                dependency: depName,
                message: `${label} requires '${depName}' ${range}, found ${depVersion}`,
                recommendation: depPkg.update ? `Run: ${depPkg.update}` : undefined
            });
        } else if (satisfied === null) {
            issues.push({ severity: "WARNING", tool: toolName, message: `${label} requires '${depName}' ${range}, but its installed version could not be verified` });
        } else {
            issues.push({ severity: "PASS", tool: toolName, message: `${label}: '${depName}' ${range} satisfied (${depVersion})` });
        }
    }
}

async function evaluateVariantConflicts(issues, rule) {
    if (!rule.variantConflicts?.length) return;
    for (const [a, b] of rule.variantConflicts) {
        const probeA = rule.variantProbes?.[a];
        const probeB = rule.variantProbes?.[b];
        if (!probeA || !probeB) continue;
        const [resultA, resultB] = await Promise.all([captureShellCommand(probeA), captureShellCommand(probeB)]);
        if (resultA.code === 0 && resultB.code === 0) {
            issues.push({
                severity: "CRITICAL",
                tool: rule.name,
                variantConflict: { a, b },
                message: `Both '${a}' and '${b}' variants of ${rule.name} appear installed on this machine - they conflict`,
                recommendation: `Manually remove one of them (they compete for the same resource) - the registry only tracks '${rule.name}' as one package, so this can't be auto-repaired`
            });
        }
    }
}

function evaluateGraphIssues(names, byName) {
    const issues = [];
    const requested = new Set(names);
    const packages = [...byName.values()];
    const { missing } = buildDependencyGraph(names, { packages });
    for (const m of missing) {
        // A requested-but-unknown name is already reported once, plainly,
        // by the main per-name loop above ("not a known registry
        // component") - only report transitively-discovered missing
        // dependencies here, so one unknown name never produces two
        // differently-worded issues for the same root cause.
        if (requested.has(m)) continue;
        issues.push({ severity: "CRITICAL", tool: m, message: `Missing dependency: '${m}' is referenced but is not a known registry component` });
    }
    for (const cycle of detectCycles(names, { packages })) {
        issues.push({ severity: "CRITICAL", tool: cycle[0], message: `Circular dependency: ${cycle.join(" -> ")}` });
    }
    return issues;
}

// scanCompatibility(names, opts) -> { issues, pass, recommend, warn,
// critical, unsupported, total, score, verdict }. `versions` is an optional
// Map(name -> version|null) - callers (tests, the dashboard's cached data
// layer) can pre-populate it to skip live detection; anything not in the
// map is detected live and cached for the duration of this call.
export async function scanCompatibility(names, { packages = loadPackages(), rules = loadCompatibilityRules(), versions } = {}) {
    const byName = new Map(packages.map((p) => [p.name, p]));
    const requested = new Set(names);
    const issues = [];
    const versionCache = versions ? new Map(versions) : new Map();

    async function getVersion(name) {
        if (versionCache.has(name)) return versionCache.get(name);
        const pkg = byName.get(name);
        const v = pkg ? await detectInstalledVersion(pkg) : null;
        versionCache.set(name, v);
        return v;
    }

    const platform = currentPlatform();
    const arch = currentArchitecture();

    for (const name of names) {
        const pkg = byName.get(name);
        if (!pkg) {
            issues.push({ severity: "WARNING", tool: name, message: `'${name}' is not a known registry component - skipped` });
            continue;
        }

        const before = issues.length;

        if (pkg.platforms && !pkg.platforms.includes(platform)) {
            issues.push({ severity: "UNSUPPORTED", tool: name, message: `${name} does not support this platform (${platform})` });
        }
        if (pkg.architectures && platform !== "linux" && !pkg.architectures.includes(arch)) {
            issues.push({ severity: "UNSUPPORTED", tool: name, message: `${name} does not declare support for this architecture (${arch})` });
        }

        const pkgRules = getRulesForPackage(name, rules);
        if (pkgRules.length === 0) {
            issues.push({ severity: "PASS", tool: name, message: `${name}: no compatibility rules declared` });
            continue;
        }

        const installedVersion = await getVersion(name);

        for (const rule of pkgRules) {
            for (const conflictName of rule.conflicts || []) {
                if (requested.has(conflictName)) {
                    issues.push({ severity: "CRITICAL", tool: name, conflictWith: conflictName, message: `${name} conflicts with ${conflictName}`, recommendation: `Remove one of '${name}' or '${conflictName}'` });
                }
            }
            for (const recName of rule.recommends || []) {
                if (!requested.has(recName)) {
                    issues.push({ severity: "RECOMMEND", tool: name, message: `${name} pairs well with ${recName} (not currently installed)` });
                }
            }
            if (rule.requires) {
                await evaluateRequirements(issues, name, null, rule.requires, "CRITICAL", byName, requested, getVersion);
            }

            await evaluateVariantConflicts(issues, rule);

            if (!rule.versions) continue;

            if (!installedVersion) {
                issues.push({ severity: "WARNING", tool: name, message: `${name}: installed version could not be detected - version-specific rules skipped` });
                continue;
            }

            const matched = findVersionRule(rule.versions, installedVersion);
            if (!matched) {
                issues.push({ severity: "WARNING", tool: name, message: `${name} ${installedVersion}: no compatibility rule matches this version` });
                continue;
            }

            const { key: versionKey, rule: versionRule } = matched;
            if (versionRule.unsupported) {
                issues.push({ severity: "UNSUPPORTED", tool: name, message: `${name} ${versionKey} is unsupported` });
            }
            if (versionRule.deprecated) {
                issues.push({ severity: "WARNING", tool: name, message: `${name} ${versionKey} is deprecated`, recommendation: pkg.update ? `Run: ${pkg.update}` : undefined });
            }
            if (versionRule.experimental) {
                issues.push({ severity: "WARNING", tool: name, message: `${name} ${versionKey} is experimental` });
            }
            if (versionRule.lts) {
                issues.push({ severity: "RECOMMEND", tool: name, message: `${name} ${versionKey} is marked LTS-track (cannot verify current LTS status offline)` });
            }
            if (versionRule.platforms && !versionRule.platforms.includes(platform)) {
                issues.push({ severity: "UNSUPPORTED", tool: name, message: `${name} ${versionKey} does not support this platform (${platform})` });
            }
            if (versionRule.architectures && platform !== "linux" && !versionRule.architectures.includes(arch)) {
                issues.push({ severity: "UNSUPPORTED", tool: name, message: `${name} ${versionKey} does not declare support for this architecture (${arch})` });
            }
            for (const compatName of versionRule.compatible || []) {
                if (requested.has(compatName)) {
                    issues.push({ severity: "PASS", tool: name, message: `${name} ${versionKey} is compatible with ${compatName}` });
                }
            }
            for (const conflictName of versionRule.conflicts || []) {
                if (requested.has(conflictName)) {
                    issues.push({ severity: "CRITICAL", tool: name, conflictWith: conflictName, message: `${name} ${versionKey} conflicts with ${conflictName}` });
                }
            }
            if (versionRule.requires) {
                await evaluateRequirements(issues, name, versionKey, versionRule.requires, "CRITICAL", byName, requested, getVersion);
            }
            if (versionRule.recommends) {
                await evaluateRequirements(issues, name, versionKey, versionRule.recommends, "WARNING", byName, requested, getVersion);
            }
        }

        if (issues.length === before) {
            issues.push({ severity: "PASS", tool: name, message: `${name}: compatible` });
        }
    }

    issues.push(...evaluateGraphIssues(names, byName));

    return { issues, ...scoreCompatibility(issues) };
}

// scoreCompatibility(issues) -> the PRD's 5-tier score/verdict, layered on
// top of core/health.js's PASS/WARNING/FAIL formula (PASS and RECOMMEND both
// count as full credit - a recommendation is informational, not a defect;
// WARNING is half credit; CRITICAL/UNSUPPORTED earn none). Unlike the plain
// numeric score, an UNSUPPORTED or CRITICAL issue always wins the verdict
// outright - a 95% numeric score with one platform-unsupported component is
// "Unsupported", not "Healthy".
export function scoreCompatibility(issues) {
    let pass = 0;
    let recommend = 0;
    let warn = 0;
    let critical = 0;
    let unsupported = 0;

    for (const { severity } of issues) {
        if (severity === "PASS") pass++;
        else if (severity === "RECOMMEND") recommend++;
        else if (severity === "WARNING") warn++;
        else if (severity === "CRITICAL") critical++;
        else if (severity === "UNSUPPORTED") unsupported++;
    }

    const total = pass + recommend + warn + critical + unsupported;
    const score = total === 0 ? 100 : Math.floor(((pass + recommend) * 100 + warn * 50) / total);

    let verdict;
    if (unsupported > 0) verdict = "Unsupported";
    else if (critical > 0) verdict = "Critical";
    else if (score >= 90) verdict = "Healthy";
    else verdict = "Warning";

    return { pass, recommend, warn, critical, unsupported, total, score, verdict };
}
