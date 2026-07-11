// The Component Manager: one unified status object per registry
// package, aggregating what used to require five separate lookups
// (registry manifest, live install check, Environment Configuration
// Engine tracked facts + health, the dependency graph, outdated-package
// detection). Every `component` subcommand reads through this - no
// exceptions - so `component list`/`info`/`doctor` can never disagree
// about what "installed"/"healthy"/"repairable" means for the same
// package.
//
// Nothing here re-implements a check another subsystem already owns:
// install status is installer.js's real `validate()` (a live command,
// not a cached guess), environment facts/health are the Environment
// Configuration Engine's, dependents come from its dependency graph,
// outdated detection is the platform adapter via commands/stats.js's
// existing safe wrapper. This module's only job is composing those into
// one object and staying honest about what it couldn't determine (a
// field is `null`/`"unknown"`, never guessed).
import { getPackage, loadPackages } from "./registry.js";
import { validate } from "./installer.js";
import { getPlatform } from "./platform/index.js";
import { mapWithConcurrency } from "./concurrency.js";
import { loadEnvironmentState } from "./environment/state.js";
import { discoverPackage } from "./environment/discovery.js";
import { dependentsOf } from "./environment/graph.js";
import { findBinaryConflicts } from "./environment/conflicts.js";
import { validateEnvironment } from "./environment/validator.js";
import { buildEnvironmentModel } from "./environment/model.js";
import { scoreResults } from "./health.js";
import { DevForgeError } from "./errors.js";
import { didYouMeanMessage } from "../lib/suggest.js";

// outdatedPackageNames() -> string[], the current platform's outdated-
// package report, or [] when the platform adapter doesn't support one
// (same safe-degrade precedent as commands/stats.js's own wrapper and
// core/workspace/health.js's inline `.catch(() => [])` - core/ modules
// don't import from commands/, so this is a small, deliberate duplicate
// of that exact three-line pattern rather than a layering violation).
async function outdatedPackageNames() {
    const platform = getPlatform();
    if (typeof platform.outdatedPackages !== "function") return [];
    try {
        return await platform.outdatedPackages();
    } catch {
        return [];
    }
}

// dependencyStatus(pkg, { packages, validateFn }) -> [{ name, installed }]
// - a live validate() per direct dependency (not transitive - the
// dependency graph already handles transitive relationships for
// `dependents`).
async function dependencyStatus(pkg, { packages, validateFn }) {
    const results = [];
    for (const depName of pkg.dependencies || []) {
        const dep = packages.find((p) => p.name === depName);
        if (!dep) {
            results.push({ name: depName, installed: false, missing: true });
            continue;
        }
        let installed = false;
        if (dep.validate) {
            try {
                installed = (await validateFn(dep)) === 0;
            } catch {
                installed = false;
            }
        }
        results.push({ name: depName, installed });
    }
    return results;
}

// getComponentStatus(name, opts) -> the unified status object.
// `outdatedList` is injectable (one outdatedPackages() call covers every
// component in a `component list` pass instead of one live `brew
// outdated` per package). `resolvePackage`/`validateFn`/`discover`/
// `capture` are injectable so tests exercise the full aggregation
// against synthetic packages and fake shell results - never the real
// registry or the real machine (the same discipline every
// core/environment/ module already follows).
export async function getComponentStatus(name, {
    packages = loadPackages(),
    outdatedList,
    resolvePackage = getPackage,
    validateFn = validate,
    discover = discoverPackage,
    capture
} = {}) {
    let pkg;
    try {
        pkg = resolvePackage(name);
    } catch {
        const suggestion = didYouMeanMessage(name, packages.map((p) => p.name));
        throw new DevForgeError(`Unknown component '${name}'.${suggestion ? ` ${suggestion}` : ""} Run 'devforgekit component list' to see what's available.`);
    }

    let installed = false;
    if (pkg.validate) {
        try {
            installed = (await validateFn(pkg)) === 0;
        } catch {
            installed = false;
        }
    }

    const envState = loadEnvironmentState();
    const tracked = envState.packages[pkg.name] || null;

    // Live-refresh version/binary/provider only when the package is
    // actually installed and either untracked or its recorded facts are
    // stale - avoids a discovery probe (a real command -v + version
    // command) for every package on every `component list` when the
    // Environment Configuration Engine has already observed it.
    let facts = tracked;
    if (installed && !tracked?.verified) {
        facts = await discover(pkg, capture ? { capture } : {});
    }

    const conflict = installed && facts?.binary ? await findBinaryConflicts(facts.binary, capture ? { capture } : {}) : null;
    const dependents = dependentsOf(pkg.name, envState, { packages });
    const dependencies = await dependencyStatus(pkg, { packages, validateFn });

    let environmentHealth = null;
    if (pkg.environment) {
        const singlePackageState = { packages: { [pkg.name]: facts || {} }, files: envState.files, generatedAt: null, version: 2 };
        const model = buildEnvironmentModel(singlePackageState);
        const results = await validateEnvironment(model, { resolvePackage: () => pkg, capture });
        environmentHealth = { healthy: results.every((r) => r.status !== "FAIL" && r.status !== "WARNING"), score: scoreResults(results).score, issues: results.filter((r) => r.status !== "PASS").map((r) => r.message) };
    }

    // A single `component info` call checks live; `getAllComponentStatuses`
    // passes one shared list in instead of one outdated-check per package.
    const resolvedOutdatedList = outdatedList || (await outdatedPackageNames());
    const outdated = installed ? resolvedOutdatedList.includes(pkg.name) || (pkg.aliases || []).some((a) => resolvedOutdatedList.includes(a)) : null;

    return {
        name: pkg.name,
        description: pkg.description,
        category: pkg.category,
        installed,
        version: facts?.version || null,
        provider: facts?.provider || null,
        binary: facts?.location || null,
        verified: Boolean(facts?.verified),
        conflict,
        environment: environmentHealth,
        dependencies,
        dependents,
        capabilities: {
            repair: Boolean(pkg.repair),
            update: Boolean(pkg.update),
            uninstall: Boolean(pkg.uninstall),
            validate: Boolean(pkg.validate)
        },
        updateAvailable: outdated
    };
}

// getAllComponentStatuses({ onlyInstalled }) -> Promise<status[]>, one
// outdatedPackages() call shared across the whole list (see above),
// remaining per-package work bounded-parallelized (see
// mapWithConcurrency). Forwards the same injectable overrides
// getComponentStatus() takes, so tests can exercise a whole synthetic
// catalog without touching the real registry or shelling out.
export async function getAllComponentStatuses({
    onlyInstalled = false,
    packages = loadPackages(),
    concurrency = 8,
    resolvePackage,
    validateFn,
    discover,
    capture,
    outdatedList: providedOutdatedList
} = {}) {
    const outdatedList = providedOutdatedList || (await outdatedPackageNames());
    const statuses = await mapWithConcurrency(packages, concurrency, (pkg) =>
        getComponentStatus(pkg.name, {
            packages,
            outdatedList,
            ...(resolvePackage ? { resolvePackage } : {}),
            ...(validateFn ? { validateFn } : {}),
            ...(discover ? { discover } : {}),
            ...(capture ? { capture } : {})
        })
    );
    return onlyInstalled ? statuses.filter((s) => s.installed) : statuses;
}

// componentHealthScore(status) -> 0-100, core/health.js's exact
// PASS=full/WARNING=half/FAIL=none formula applied to this component's
// own checks (installed, environment validation, no conflict) - the
// same number `component list`/`component doctor` both show, never two
// different scores for the same package.
export function componentHealthScore(status) {
    const results = [];
    if (status.installed) results.push({ status: "PASS" });
    else results.push({ status: "FAIL" });

    if (status.environment) {
        for (const issue of status.environment.issues) results.push({ status: "WARNING", message: issue });
        if (status.environment.issues.length === 0) results.push({ status: "PASS" });
    }
    if (status.conflict) results.push({ status: "WARNING", message: "multiple installations" });

    return scoreResults(results);
}
