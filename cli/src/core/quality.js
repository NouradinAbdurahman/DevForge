// The Manifest Quality Score (see docs/PlatformArchitecture.md's Package
// Quality System section): a set of independent, equally-weighted checks
// per component grouped into categories (Metadata, Documentation,
// Reliability, Discoverability, Compatibility, Platform Support), giving
// contributors an objective standard to meet and a clear answer to "why
// does this package score what it does" (v2.1.1 Registry Excellence -
// the categorized `breakdown` is new; the underlying checks are mostly
// the same ones scoreManifest always ran, see the note below on what
// changed).
//
// Split into two tiers, deliberately:
//   - scoreManifest() - structural checks, synchronous, zero network
//     calls. Safe to run across the whole registry in tests/CI
//     (getRegistryStats' qualityScore is the average of these).
//   - checkLiveReachability() - the two checks that need an actual HTTP
//     request (homepage/repository). Opt-in only (`devforgekit info
//     <name> --live`) - never run automatically, since it's slow and can
//     be flaky/rate-limited against real third-party servers, the same
//     reasoning `registry-smoke.yml` stays a narrow, deliberately-scoped
//     live check rather than testing all 261 packages on every push.
//
// What changed in v2.1.1: the old 10-check version counted "Install
// tested"/"Verify tested"/"Uninstall tested" as three separate checks
// that were all literally the same `ciVerified` boolean - inflating a
// single real signal into 30% of the score. That's now one honest
// "CI-verified" check. In its place: three genuinely new, independently
// meaningful signals that were already sitting in the schema unused by
// scoring - `aliases`/`tags` (discoverability), a real compatibility
// rule file existing for this package, and multi-platform/architecture
// declarations (see CHECK_DEFS below for exactly what each one tests).
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.js";

// hasCompatibilityRule(name) - a plain file-existence check against
// registry/compatibility/<name>.yaml, deliberately NOT importing
// compatibility/rules.js's schema-validating loader: that module imports
// registry.js (for loadPackages), and registry.js imports this module
// (for scoreManifest) - importing rules.js here would close that into an
// import cycle. A cheap existence check needs none of rules.js's
// validation/plugin-merging logic anyway.
let _compatRuleNames = null;
function hasCompatibilityRule(name) {
    if (_compatRuleNames === null) {
        const dir = path.join(repoRoot(), "registry", "compatibility");
        _compatRuleNames = existsSync(dir)
            ? new Set(readdirSync(dir).filter((f) => f.endsWith(".yaml")).map((f) => f.slice(0, -5)))
            : new Set();
    }
    return _compatRuleNames.has(name);
}

// Every check, grouped by category. `pass(pkg)` is pure/sync except
// hasCompatibilityRule's one-time directory read (cached above).
const CHECK_DEFS = [
    { label: "Schema valid", category: "Metadata", pass: () => true },
    { label: "Homepage present", category: "Metadata", pass: (pkg) => Boolean(pkg.homepage) },
    { label: "Repository present", category: "Metadata", pass: (pkg) => Boolean(pkg.repository) },
    { label: "License detected", category: "Metadata", pass: (pkg) => Boolean(pkg.license) },
    { label: "Documentation exists", category: "Documentation", pass: (pkg) => Boolean(pkg.documentation) },
    { label: "CI-verified (install/validate/uninstall)", category: "Reliability", pass: (pkg) => Boolean(pkg.ciVerified) },
    { label: "Rollback available", category: "Reliability", pass: (pkg) => Boolean(pkg.uninstall) },
    { label: "Health check exists", category: "Reliability", pass: (pkg) => Boolean(pkg.validate) },
    { label: "Aliases present", category: "Discoverability", pass: (pkg) => (pkg.aliases || []).length > 0 },
    { label: "Tags present", category: "Discoverability", pass: (pkg) => (pkg.tags || []).length >= 2 },
    { label: "Compatibility rule declared", category: "Compatibility", pass: (pkg) => hasCompatibilityRule(pkg.name) },
    { label: "Multi-platform support", category: "Platform Support", pass: (pkg) => (pkg.platforms || []).length >= 2 },
    { label: "Architecture declared", category: "Platform Support", pass: (pkg) => (pkg.architectures || []).length > 0 }
];

// breakdownFromChecks(checks) -> [{ category, passCount, total, score }],
// in CHECK_DEFS' own category order (first-seen, not alphabetical) - so
// "why does this package score what it does" reads in the same order a
// human would ask the questions (what is it, is it documented, does it
// work, can you find it, does it play well with others, where does it
// run).
function breakdownFromChecks(checks) {
    const order = [];
    const byCategory = new Map();
    for (const check of checks) {
        if (!byCategory.has(check.category)) {
            byCategory.set(check.category, []);
            order.push(check.category);
        }
        byCategory.get(check.category).push(check);
    }
    return order.map((category) => {
        const group = byCategory.get(category);
        const passCount = group.filter((c) => c.pass).length;
        return { category, passCount, total: group.length, score: Math.round((passCount / group.length) * 100) };
    });
}

export function scoreManifest(pkg) {
    const checks = CHECK_DEFS.map((def) => ({ label: def.label, category: def.category, pass: def.pass(pkg) }));

    const passCount = checks.filter((c) => c.pass).length;
    const score = Math.round((passCount / checks.length) * 100);

    return { checks, score, passCount, total: checks.length, breakdown: breakdownFromChecks(checks) };
}

async function urlReachable(url, timeoutMs) {
    if (!url) return null; // nothing to check, distinct from "checked and failed"

    for (const method of ["HEAD", "GET"]) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { method, redirect: "follow", signal: controller.signal });
            clearTimeout(timer);
            if (response.ok) return true;
            // Some servers reject HEAD (405/403) - fall through and retry with GET
            // before concluding it's actually unreachable.
        } catch {
            clearTimeout(timer);
        }
    }
    return false;
}

// checkLiveReachability(pkg, { timeoutMs }) -> { homepageReachable, repositoryReachable }
// Each is `true`/`false` (checked, reachable or not) or `null` (no URL to
// check). Real network requests - only call this when a caller has
// explicitly opted into live checks.
export async function checkLiveReachability(pkg, { timeoutMs = 5000 } = {}) {
    const [homepageReachable, repositoryReachable] = await Promise.all([
        urlReachable(pkg.homepage, timeoutMs),
        urlReachable(pkg.repository, timeoutMs)
    ]);
    return { homepageReachable, repositoryReachable };
}

// applyLiveReachability(scored, live) -> a new score object with the
// "Homepage present"/"Repository present" checks upgraded to
// "Homepage reachable"/"Repository reachable" using real results, and
// the score (and breakdown) recomputed. Kept separate from
// scoreManifest() so the synchronous, network-free path is always
// available.
export function applyLiveReachability(scored, live) {
    const checks = scored.checks.map((check) => {
        if (check.label === "Homepage present" && live.homepageReachable !== null) {
            return { ...check, label: "Homepage reachable", pass: live.homepageReachable };
        }
        if (check.label === "Repository present" && live.repositoryReachable !== null) {
            return { ...check, label: "Repository reachable", pass: live.repositoryReachable };
        }
        return check;
    });

    const passCount = checks.filter((c) => c.pass).length;
    const score = Math.round((passCount / checks.length) * 100);
    return { checks, score, passCount, total: checks.length, breakdown: breakdownFromChecks(checks) };
}
