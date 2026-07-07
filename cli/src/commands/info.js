// Native command: a human-readable "rich info" view, distinct from
// `component info` (which stays raw JSON for scripting). Install size is
// computed live from `du -sh` on the actual Homebrew Cellar/Caskroom
// path when the package is a brew-formula/brew-cask and is actually
// installed - never a fabricated number (see docs/PlatformArchitecture.md
// section 3's note on why "install size" isn't a stored field).
import { getPackage, loadPackages } from "../core/registry.js";
import { captureShellCommand } from "../core/shell.js";
import { scoreManifest, checkLiveReachability, applyLiveReachability } from "../core/quality.js";
import { getPackageDiagnostics, INSTALL_STATUS, STATUS_META, RESPONSIBILITY } from "../core/installAudit.js";
import { getPlatform } from "../core/platform/index.js";
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";

export async function computeInstallSize(pkg) {
    const step = pkg.install || (pkg.variants && pkg.variants[0].install);
    if (!step) return null;

    const platform = getPlatform();
    let dir;
    try {
        if (step.method === "brew-formula" && typeof platform.packageCellarDir === "function") {
            dir = await platform.packageCellarDir(step.id);
        } else if (step.method === "brew-cask" && typeof platform.packageCaskroomDir === "function") {
            dir = await platform.packageCaskroomDir(step.id);
        }
    } catch {
        return null;
    }
    if (!dir) return null;

    const { code, stdout } = await captureShellCommand(`du -sh "${dir}" 2>/dev/null`);
    if (code !== 0 || !stdout.trim()) return null;
    return stdout.trim().split(/\s+/)[0];
}

export function findAlternatives(pkg, allPackages) {
    return allPackages
        .filter((p) => p.name !== pkg.name && p.category === pkg.category)
        .map((p) => p.name)
        .sort()
        .slice(0, 5);
}

export function registerInfoCommand(program) {
    program
        .command("info <name>")
        .description("Rich, human-readable component info (description, deps, license, install size, quality score, alternatives)")
        .option("--live", "also check homepage/repository reachability over the network (slower, opt-in)")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const pkg = getPackage(name);
            const allPackages = loadPackages();
            const size = await computeInstallSize(pkg);
            const alternatives = findAlternatives(pkg, allPackages);
            const diagnostics = getPackageDiagnostics(pkg, allPackages);

            let scored = scoreManifest(pkg);
            if (opts.live) {
                scored = applyLiveReachability(scored, await checkLiveReachability(pkg));
            }

            logger.section(`${pkg.name}`);
            console.log(`  ${pkg.description}`);
            console.log();

            // ── Status ────────────────────────────────────────────────
            const meta = STATUS_META[diagnostics.status] || STATUS_META[INSTALL_STATUS.UNTESTED];
            console.log(`  Status:           ${meta.icon} ${meta.label}`);
            console.log(`  ${meta.description}`);
            if (meta.responsibility !== RESPONSIBILITY.NONE) {
                console.log(`  Responsibility:   ${meta.responsibility}`);
            }
            if (diagnostics.lastVerified) {
                console.log(`  Last Verified:    ${diagnostics.lastVerified}`);
            }
            console.log();

            // ── Platform Support ──────────────────────────────────────
            const plat = diagnostics.platformSupport;
            if (plat.supported !== null) {
                console.log(`  Platform Support:`);
                console.log(`    Current: ${plat.currentPlatform.os} (${plat.currentPlatform.cpu})`);
                console.log(`    Supported: ${(plat.supportedPlatforms || pkg.platforms || []).join(", ")}`);
                console.log(`    ${plat.supported ? "✓" : "✗"} ${plat.reason}`);
            } else {
                console.log(`  Platform Support: Unknown (not yet verified)`);
            }
            console.log();

            // ── Architecture Support ──────────────────────────────────
            const arch = diagnostics.architectureSupport;
            if (arch.supported !== null) {
                console.log(`  Architecture Support:`);
                console.log(`    Current: ${arch.currentArch}`);
                console.log(`    Supported: ${(arch.supportedArchitectures || pkg.architectures || []).join(", ") || "not specified"}`);
                console.log(`    ${arch.supported ? "✓" : "✗"} ${arch.reason}`);
            } else {
                console.log(`  Architecture Support: Unknown (not yet verified)`);
            }
            console.log();

            // ── Why can't this be installed? ───────────────────────────
            if (diagnostics.why.reason && meta.responsibility !== RESPONSIBILITY.NONE) {
                console.log(`  Why can't this be installed?`);
                console.log(`    Reason:           ${diagnostics.why.reason}`);
                console.log(`    Can DevForgeKit fix? ${diagnostics.why.canDevForgeKitFix ? "Yes" : "No"}`);
                console.log(`    Can user fix?    ${diagnostics.why.canUserFix ? "Yes" : "No"}`);
                if (diagnostics.why.suggestedFix) {
                    console.log(`    Suggested Fix:   ${diagnostics.why.suggestedFix}`);
                }
                if (diagnostics.alternatives.length > 0) {
                    console.log(`    Alternatives:    ${diagnostics.alternatives.join(", ")}`);
                }
                if (diagnostics.why.documentation) {
                    console.log(`    Documentation:   ${diagnostics.why.documentation}`);
                }
                console.log();
            }

            // ── Verification History ──────────────────────────────────
            const history = diagnostics.verificationHistory;
            if (history.length > 0) {
                const last = history[history.length - 1];
                console.log(`  Verification History:`);
                console.log(`    Last result: ${last.result} at ${last.timestamp}`);
                console.log(`    Method: ${last.installer || "unknown"}`);
                if (last.failureReason) {
                    console.log(`    Failure: ${last.failureReason} - ${last.failureMessage || ""}`);
                }
                console.log();
            }

            // ── Registry Health ───────────────────────────────────────
            console.log(`  Registry Health: ${scored.score}/100${opts.live ? "" : " (structural checks only - run with --live for homepage/repository reachability)"}`);
            for (const group of scored.breakdown) {
                console.log(`  ${group.category}: ${group.passCount}/${group.total}`);
                for (const check of scored.checks.filter((c) => c.category === group.category)) {
                    console.log(`    ${check.pass ? "✓" : "✗"} ${check.label}`);
                }
            }
            console.log();

            // ── Basic metadata ────────────────────────────────────────
            console.log(`  Category:     ${pkg.category}`);
            console.log(`  Platforms:    ${pkg.platforms.join(", ")}`);
            console.log(`  Homepage:     ${pkg.homepage || "n/a"}`);
            console.log(`  Repository:   ${pkg.repository || "n/a"}`);
            console.log(`  License:      ${pkg.license || "n/a"}`);
            console.log(`  Maintainer:   ${pkg.maintainer || "n/a"}`);
            console.log(`  Tags:         ${(pkg.tags || []).join(", ") || "none"}`);
            console.log(`  Aliases:      ${(pkg.aliases || []).join(", ") || "none"}`);
            console.log(`  Dependencies: ${(pkg.dependencies || []).join(", ") || "none"}`);
            console.log(`  Conflicts:    ${(pkg.conflicts || []).join(", ") || "none"}`);
            console.log(`  Install size: ${size ? size : "not installed"}`);
            console.log(`  Update:       ${pkg.update || "n/a"}`);
            console.log(`  Uninstall:    ${pkg.uninstall ? JSON.stringify(pkg.uninstall) : "n/a"}`);
            console.log(`  Health check: ${pkg.validate || "n/a"}`);
            console.log(`  Stability:    ${pkg.stability || "n/a"}`);
            console.log(`  Alternatives: ${alternatives.length > 0 ? alternatives.join(", ") : "none in this category"}`);
        }));
}
