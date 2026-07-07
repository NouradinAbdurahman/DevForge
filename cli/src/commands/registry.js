// Native command: the Registry Builder (see
// docs/PlatformArchitecture.md section 3 / "Registry Builder") plus
// registry analytics ("registry stats"). Rebuilds the compiled
// registry.json index and the auto-generated docs/Registry.md catalog
// from the hand-authored registry/{categories,packages,collections,
// profiles,recipes} YAML sources - the one artifact a future hosted/
// remote registry would eventually serve, and a convenient single-file
// index for anything that wants to browse the catalog without parsing
// 100+ YAML files.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadRegistry, getRegistryStats, expandProfile, expandRecipe, loadPackages, clearRegistryCache } from "../core/registry.js";
import { loadCompatibilityRuleFiles } from "../core/compatibility/rules.js";
import { repoRoot } from "../core/paths.js";
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";
import { verifyAllPackages, registryDoctor } from "../core/installAudit.js";

// compatibilityCoverage(packages) -> % of registry packages that have a
// dedicated registry/compatibility/<name>.yaml rule file authored for them
// (Compatibility Engine, v1.2.5) - the same "average of a per-component
// signal" shape as getRegistryStats' qualityScore, kept in the command
// layer rather than core/registry.js itself to avoid a circular import
// (core/compatibility/rules.js already imports loadPackages from
// core/registry.js).
export function compatibilityCoverage(packages) {
    if (packages.length === 0) return 100;
    const covered = new Set(loadCompatibilityRuleFiles().map((r) => r.name));
    return Math.round((packages.filter((p) => covered.has(p.name)).length / packages.length) * 100);
}

// computeRegistryAudit(data) -> a curated health scorecard + actionable
// recommendations (v2.1.1 Registry Excellence), distinct from the three
// commands above rather than a fourth overlapping one: `stats` is raw
// analytics, `verify` actually runs installs (slow, machine-dependent),
// `doctor` dumps every individual structural issue found. `audit` is the
// one static (no live installs), curated "is this registry in good
// shape, and what's the highest-leverage thing to fix" view - every
// number here is either read straight from getRegistryStats/
// registryDoctor or computed as a simple coverage percentage over real
// package fields, never fabricated.
function pct(count, total) {
    return total === 0 ? 100 : Math.round((count / total) * 100);
}

export function computeRegistryAudit(data) {
    const { packages } = data;
    const stats = getRegistryStats(data);
    const { issues: doctorIssues } = registryDoctor({ packages });
    const total = packages.length;

    const deprecatedCount = packages.filter((p) => p.stability === "deprecated").length;
    const brokenMetadataCount = new Set(
        doctorIssues.filter((i) => i.severity === "error").map((i) => i.package)
    ).size;
    const documentationCoverage = pct(packages.filter((p) => p.documentation).length, total);
    const validationCoverage = pct(packages.filter((p) => p.validate).length, total);
    const aliasesCoverage = pct(packages.filter((p) => (p.aliases || []).length > 0).length, total);
    const architectureCoverage = pct(packages.filter((p) => (p.architectures || []).length > 0).length, total);
    const compatCoverage = compatibilityCoverage(packages);

    const recommendations = [];
    if (aliasesCoverage < 50) {
        const missing = total - packages.filter((p) => (p.aliases || []).length > 0).length;
        recommendations.push(`${missing} package(s) have no aliases - add common short-name aliases where one genuinely exists (e.g. 'rg' for ripgrep).`);
    }
    if (compatCoverage < 25) {
        const missing = total - Math.round((compatCoverage / 100) * total);
        recommendations.push(`${missing} package(s) have no compatibility rule - consider declaring real conflicts/recommends for well-known pairings (see docs/RuleSchema.md).`);
    }
    if (architectureCoverage < 90) {
        const missing = total - packages.filter((p) => (p.architectures || []).length > 0).length;
        recommendations.push(`${missing} package(s) don't declare supported architectures - add 'architectures' so compatibility checks can catch CPU mismatches.`);
    }
    if (stats.ciVerifiedCount < total * 0.1) {
        recommendations.push(`Only ${stats.ciVerifiedCount} package(s) are CI-verified - consider adding more to .github/workflows/registry-smoke.yml's live-tested allowlist.`);
    }
    if (deprecatedCount > 0) {
        const withoutReplacement = packages.filter((p) => p.stability === "deprecated" && !(p.recommendedAlternatives || []).length).length;
        if (withoutReplacement > 0) {
            recommendations.push(`${withoutReplacement} deprecated package(s) have no recommendedAlternatives - add one so users know what to switch to.`);
        }
    }

    return {
        total,
        verified: stats.ciVerifiedCount,
        untested: total - stats.ciVerifiedCount,
        deprecated: deprecatedCount,
        brokenMetadata: brokenMetadataCount,
        averageQuality: stats.qualityScore,
        compatibilityCoverage: compatCoverage,
        documentationCoverage,
        validationCoverage,
        aliasesCoverage,
        architectureCoverage,
        recommendations
    };
}

function buildCompiledRegistry({ categories, packages, collections, profiles, recipes }) {
    const sortedCategories = [...categories].sort((a, b) => a.id.localeCompare(b.id));
    const sortedPackages = [...packages].sort((a, b) => a.name.localeCompare(b.name));
    const sortedCollections = [...collections].sort((a, b) => a.name.localeCompare(b.name));
    const sortedProfiles = [...profiles].sort((a, b) => a.name.localeCompare(b.name));
    const sortedRecipes = [...recipes].sort((a, b) => a.name.localeCompare(b.name));

    const searchIndex = sortedPackages.map((p) => ({
        name: p.name,
        category: p.category,
        description: p.description,
        tags: p.tags || [],
        aliases: p.aliases || []
    }));

    return {
        schemaVersion: 1,
        categories: sortedCategories,
        packages: sortedPackages,
        collections: sortedCollections,
        profiles: sortedProfiles,
        recipes: sortedRecipes,
        searchIndex
    };
}

function buildDocsMarkdown({ categories, packages, collections, profiles, recipes }) {
    const sortedCategories = [...categories].sort((a, b) => a.id.localeCompare(b.id));
    const sortedCollections = [...collections].sort((a, b) => a.name.localeCompare(b.name));
    const sortedProfiles = [...profiles].sort((a, b) => a.name.localeCompare(b.name));
    const sortedRecipes = [...recipes].sort((a, b) => a.name.localeCompare(b.name));
    const byCategory = new Map(sortedCategories.map((c) => [c.id, []]));
    for (const pkg of [...packages].sort((a, b) => a.name.localeCompare(b.name))) {
        (byCategory.get(pkg.category) || byCategory.set(pkg.category, []).get(pkg.category)).push(pkg);
    }

    const lines = [
        "# Registry",
        "",
        "AUTO-GENERATED by `devforgekit registry generate` from `registry/categories`,",
        "`registry/packages`, `registry/collections`, and `registry/profiles` - do not",
        "hand-edit; changes are overwritten on the next generate. See",
        "[PlatformArchitecture.md](PlatformArchitecture.md).",
        "",
        `${packages.length} components across ${categories.length} categories, ${collections.length} collections, ${profiles.length} profiles, ${recipes.length} recipes.`,
        ""
    ];

    for (const category of sortedCategories) {
        const members = byCategory.get(category.id) || [];
        lines.push(`## ${category.label}`, "", category.description, "");
        for (const pkg of members) {
            const homepage = pkg.homepage ? ` - [${pkg.homepage}](${pkg.homepage})` : "";
            lines.push(`- **${pkg.name}** - ${pkg.description}${homepage}`);
        }
        // A memberless category would otherwise emit two consecutive
        // blank lines (markdownlint MD012).
        if (members.length > 0) lines.push("");
    }

    lines.push("## Collections", "");
    for (const c of sortedCollections) {
        lines.push(`- **${c.name}** - ${c.description}: ${c.components.join(", ")}`);
    }
    lines.push("");

    lines.push("## Profiles", "");
    for (const p of sortedProfiles) {
        lines.push(`- **${p.name}** - ${p.description}: ${expandProfile(p).join(", ")}`);
    }
    lines.push("");

    lines.push("## Recipes", "");
    for (const r of sortedRecipes) {
        lines.push(`- **${r.icon ? `${r.icon} ` : ""}${r.name}** - ${r.description}: ${expandRecipe(r).join(", ")}`);
    }
    lines.push("");

    return lines.join("\n");
}

export function registerRegistryCommand(program) {
    const registry = program
        .command("registry")
        .description("Rebuild the registry index/docs, or show registry analytics");

    registry
        .command("generate")
        .description("Validate every manifest (including cross-references) and regenerate registry.json + docs/Registry.md")
        .action(withErrorHandling(async () => {
            const data = loadRegistry();

            const registryJsonPath = path.join(repoRoot(), "registry", "registry.json");
            const docsPath = path.join(repoRoot(), "docs", "Registry.md");

            writeFileSync(registryJsonPath, `${JSON.stringify(buildCompiledRegistry(data), null, 2)}\n`);
            writeFileSync(docsPath, buildDocsMarkdown(data));
            clearRegistryCache();

            logger.success(`Generated registry/registry.json (${data.packages.length} packages, ${data.categories.length} categories, ${data.collections.length} collections, ${data.profiles.length} profiles, ${data.recipes.length} recipes)`);
            logger.success("Generated docs/Registry.md");
        }));

    registry
        .command("stats")
        .description("Registry analytics: totals, dependency graph, duplicate aliases, orphaned manifests, metadata completeness")
        .option("--json", "emit as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const data = loadRegistry();
            const stats = { ...getRegistryStats(data), compatibilityCoverage: compatibilityCoverage(data.packages) };

            if (opts.json) {
                console.log(JSON.stringify(stats, null, 2));
                return;
            }

            logger.section("Registry Analytics");
            console.log(`  Components:  ${stats.totalComponents}`);
            console.log(`  Categories:  ${stats.totalCategories}`);
            console.log(`  Collections: ${stats.totalCollections}`);
            console.log(`  Profiles:    ${stats.totalProfiles}`);
            console.log(`  Recipes:     ${stats.totalRecipes}`);
            console.log(`  Dependency edges: ${stats.dependencyEdges}`);
            console.log(`  Most depended-upon: ${stats.mostDependedUpon ? `${stats.mostDependedUpon.name} (${stats.mostDependedUpon.count} dependents)` : "none"}`);
            console.log(`  Largest bundle: ${stats.largestBundle ? `${stats.largestBundle.kind} '${stats.largestBundle.name}' (${stats.largestBundle.size} components)` : "none"}`);
            console.log(`  Metadata completeness: ${stats.metadataCompletenessScore}%`);
            console.log(`  Quality score (avg. per-component Manifest Quality Score, see 'devforgekit info <name>'): ${stats.qualityScore}%`);
            console.log(`  CI-verified components (live install/validate/uninstall smoke test): ${stats.ciVerifiedCount}`);
            console.log(`  Compatibility rule coverage (registry/compatibility/*.yaml): ${stats.compatibilityCoverage}%`);

            if (stats.duplicateAliases.length > 0) {
                logger.warn(`Duplicate aliases (${stats.duplicateAliases.length}):`);
                for (const { alias, owners } of stats.duplicateAliases) {
                    console.log(`    '${alias}' claimed by: ${owners.join(", ")}`);
                }
            } else {
                logger.success("No duplicate aliases");
            }

            if (stats.orphaned.length > 0) {
                logger.warn(`Orphaned manifests - not referenced by any collection/profile (${stats.orphaned.length}): ${stats.orphaned.join(", ")}`);
            } else {
                logger.success("No orphaned manifests");
            }
        }));

    registry
        .command("verify")
        .description("Validate every registry package: attempt install or validate, track verification status")
        .option("--json", "emit results as JSON")
        .option("--timeout <ms>", "per-package install timeout in milliseconds", "120000")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const packages = loadPackages();
            const timeoutMs = parseInt(opts.timeout, 10) || 120000;

            logger.section(`Verifying ${packages.length} registry packages...`);

            const { results, summary } = await verifyAllPackages({
                packages,
                timeoutMs,
                onProgress: (r) => {
                    const icon = r.success ? "✓" : "✗";
                    const status = r.success ? "verified" : r.status;
                    if (r.success) {
                        logger.success(`${icon} ${r.name} - ${status}`);
                    } else {
                        logger.error(`${icon} ${r.name} - ${status}: ${r.failureMessage || "failed"}`);
                        if (r.suggestedFix) {
                            console.log(`    Fix: ${r.suggestedFix}`);
                        }
                    }
                }
            });

            if (opts.json) {
                console.log(JSON.stringify({ results, summary }, null, 2));
                return;
            }

            logger.section("Verification Summary");
            console.log(`  Total:                    ${summary.total}`);
            console.log(`  ✅ Verified:              ${summary.verified}`);
            console.log(`  🟢 Installed:             ${summary.installed}`);
            console.log(`  🔄 Update Available:      ${summary.updateAvailable}`);
            console.log(`  ⚠ Manual Installation:    ${summary.manualInstallation}`);
            console.log(`  🔐 Auth Required:         ${summary.authenticationRequired}`);
            console.log(`  📄 License Required:      ${summary.licenseRequired}`);
            console.log(`  📦 Missing Dependency:    ${summary.missingDependency}`);
            console.log(`  🌐 Network Error:         ${summary.networkError}`);
            console.log(`  ⏱ Timeout:                ${summary.timeout}`);
            console.log(`  🔧 Missing Pkg Manager:   ${summary.missingPackageManager}`);
            console.log(`  🚫 Unsupported Platform:  ${summary.unsupportedPlatform}`);
            console.log(`  🚫 Unsupported Arch:      ${summary.unsupportedArchitecture}`);
            console.log(`  ❌ Deprecated:            ${summary.deprecated}`);
            console.log(`  ❌ Broken Registry:       ${summary.brokenRegistryMetadata}`);
            console.log(`  ❌ Broken Download:       ${summary.brokenDownload}`);
            console.log(`  ❌ Removed by Vendor:     ${summary.removedByVendor}`);
            console.log(`  ⚠ Untested:               ${summary.untested}`);
            console.log(`  Overall Reliability:      ${summary.reliability}%`);

            const problemCount = summary.brokenRegistryMetadata + summary.brokenDownload + summary.removedByVendor + summary.unsupportedPlatform + summary.unsupportedArchitecture;
            if (problemCount > 0) {
                logger.warn(`${problemCount} packages need attention.`);
            } else if (summary.verified + summary.installed === summary.total) {
                logger.success("All packages verified!");
            }
        }));

    registry
        .command("doctor")
        .description("Registry health check: broken formulas, missing commands, dead URLs, duplicates, untested packages")
        .option("--json", "emit results as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const packages = loadPackages();

            const { issues, summary } = registryDoctor({ packages });

            if (opts.json) {
                console.log(JSON.stringify({ issues, summary }, null, 2));
                return;
            }

            logger.section("Registry Health Report");
            console.log(`  Total packages:  ${summary.total}`);
            console.log(`  Quality Score:   ${summary.qualityScore}%`);
            console.log(`  Total issues:    ${summary.issues}`);
            console.log(`  Errors:          ${summary.errors}`);
            console.log(`  Warnings:        ${summary.warnings}`);
            console.log(`  Info:            ${summary.info}`);

            if (issues.length === 0) {
                logger.success("No issues found - registry is healthy!");
                return;
            }

            const errors = issues.filter((i) => i.severity === "error");
            const warnings = issues.filter((i) => i.severity === "warning");

            if (errors.length > 0) {
                logger.error("\nErrors:");
                for (const issue of errors) {
                    console.log(`  ${issue.package}: ${issue.message}`);
                }
            }

            if (warnings.length > 0) {
                logger.warn("\nWarnings:");
                for (const issue of warnings) {
                    console.log(`  ${issue.package}: ${issue.message}`);
                }
            }

            const infos = issues.filter((i) => i.severity === "info");
            if (infos.length > 0) {
                console.log("\nInfo:");
                for (const issue of infos.slice(0, 20)) {
                    console.log(`  ${issue.package}: ${issue.message}`);
                }
                if (infos.length > 20) {
                    console.log(`  ... and ${infos.length - 20} more info items.`);
                }
            }
        }));

    registry
        .command("audit")
        .description("Registry health scorecard: coverage percentages across documentation/validation/aliases/architecture/compatibility, plus actionable recommendations")
        .option("--json", "emit the scorecard as JSON")
        .action(withErrorHandling(function () {
            const opts = this.opts();
            const data = loadRegistry();
            const audit = computeRegistryAudit(data);

            if (opts.json) {
                console.log(JSON.stringify(audit, null, 2));
                return;
            }

            logger.section("Registry Audit");
            console.log(`  Packages:                ${audit.total}`);
            console.log(`  Verified (CI):           ${audit.verified} (${pct(audit.verified, audit.total)}%)`);
            console.log(`  Untested:                ${audit.untested} (${pct(audit.untested, audit.total)}%)`);
            console.log(`  Deprecated:              ${audit.deprecated}`);
            console.log(`  Broken Metadata:         ${audit.brokenMetadata}`);
            console.log(`  Average Quality:         ${audit.averageQuality}%`);
            console.log(`  Compatibility Coverage:  ${audit.compatibilityCoverage}%`);
            console.log(`  Documentation Coverage:  ${audit.documentationCoverage}%`);
            console.log(`  Validation Coverage:     ${audit.validationCoverage}%`);
            console.log(`  Aliases Coverage:        ${audit.aliasesCoverage}%`);
            console.log(`  Architecture Coverage:   ${audit.architectureCoverage}%`);

            if (audit.recommendations.length > 0) {
                logger.section("Recommendations");
                for (const rec of audit.recommendations) {
                    console.log(`  - ${rec}`);
                }
            } else {
                logger.success("No high-leverage gaps found.");
            }
        }));
}
