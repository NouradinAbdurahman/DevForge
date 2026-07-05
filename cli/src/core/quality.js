// The Manifest Quality Score (see docs/PlatformArchitecture.md's Package
// Quality System section): ten independent, equally-weighted checks per
// component, giving contributors an objective standard to meet as the
// registry grows past 250 entries.
//
// Split into two tiers, deliberately:
//   - scoreManifest() - eight structural checks, synchronous, zero
//     network calls. Safe to run across the whole registry in tests/CI
//     (getRegistryStats' qualityScore is the average of these).
//   - checkLiveReachability() - the two checks that need an actual HTTP
//     request (homepage/repository). Opt-in only (`devforgekit info
//     <name> --live`) - never run automatically, since it's slow and can
//     be flaky/rate-limited against real third-party servers, the same
//     reasoning `registry-smoke.yml` stays a narrow, deliberately-scoped
//     live check rather than testing all 250 packages on every push.
//
// "Install tested"/"Verify tested"/"Uninstall tested" all key off
// `ciVerified` - it's the only real evidence available today (the
// registry-smoke.yml allowlist runs exactly that install -> validate ->
// uninstall -> re-validate sequence). They rise together as more
// packages join that allowlist; there's no separate signal to fake a
// finer distinction with yet.
export function scoreManifest(pkg) {
    const checks = [
        // Always true here: loadPackages() already rejected anything
        // that fails ajv validation before a `pkg` object exists to
        // score - this line documents that gate rather than re-testing it.
        { label: "Schema valid", pass: true },
        { label: "Homepage present", pass: Boolean(pkg.homepage) },
        { label: "Repository present", pass: Boolean(pkg.repository) },
        { label: "License detected", pass: Boolean(pkg.license) },
        { label: "Install tested", pass: Boolean(pkg.ciVerified) },
        { label: "Verify tested", pass: Boolean(pkg.ciVerified) },
        { label: "Uninstall tested", pass: Boolean(pkg.ciVerified) },
        { label: "Rollback available", pass: Boolean(pkg.uninstall) },
        { label: "Health check exists", pass: Boolean(pkg.validate) },
        { label: "Documentation exists", pass: Boolean(pkg.documentation) }
    ];

    const passCount = checks.filter((c) => c.pass).length;
    const score = Math.round((passCount / checks.length) * 100);

    return { checks, score, passCount, total: checks.length };
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
// the score recomputed. Kept separate from scoreManifest() so the
// synchronous, network-free path is always available.
export function applyLiveReachability(scored, live) {
    const checks = scored.checks.map((check) => {
        if (check.label === "Homepage present" && live.homepageReachable !== null) {
            return { label: "Homepage reachable", pass: live.homepageReachable };
        }
        if (check.label === "Repository present" && live.repositoryReachable !== null) {
            return { label: "Repository reachable", pass: live.repositoryReachable };
        }
        return check;
    });

    const passCount = checks.filter((c) => c.pass).length;
    const score = Math.round((passCount / checks.length) * 100);
    return { checks, score, passCount, total: checks.length };
}
