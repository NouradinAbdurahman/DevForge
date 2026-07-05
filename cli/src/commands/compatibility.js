// The Compatibility Engine's command surface (v1.2.5 - see
// docs/CompatibilityEngine.md). Every subcommand is a thin wrapper; all
// real logic lives in core/compatibility/*.js (rules/versionMatch/versions/
// graph/engine/explain/repair/report), the same "commands depend on core"
// split every other subsystem in this CLI already follows.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadPackages, getProfile, getRecipe, getCollection, expandProfile, expandRecipe } from "../core/registry.js";
import { validate } from "../core/installer.js";
import { scanCompatibility } from "../core/compatibility/engine.js";
import { explainComponent } from "../core/compatibility/explain.js";
import { planRepair, executeRepairPlan } from "../core/compatibility/repair.js";
import { buildDependencyGraph, detectCycles, detectDuplicateTools } from "../core/compatibility/graph.js";
import { loadCompatibilityRuleFiles, checkRuleIntegrity } from "../core/compatibility/rules.js";
import { toJson, toMarkdown, toHtml, toPdfReadyMarkdown } from "../core/compatibility/report.js";
import { getAIRecommendations } from "../core/compatibility/ai.js";
import { getWorkspace } from "../core/workspace/store.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";

// resolveWorkspaceComponents(doc) -> deduplicated string[]. A small,
// intentionally standalone re-derivation of core/workspace/health.js's
// private resolveWorkspaceComponents - that one is shaped around health's
// FAIL-on-dangling-reference semantics and isn't exported; this one just
// needs the plain resolved name list, so a ~10-line local version is
// clearer than exporting and repurposing the other.
function resolveWorkspaceComponents(doc) {
    const names = new Set(doc.components || []);
    if (doc.profile) {
        try { for (const n of expandProfile(getProfile(doc.profile))) names.add(n); } catch { /* reported elsewhere (workspace verify) */ }
    }
    for (const recipeName of doc.recipes || []) {
        try { for (const n of expandRecipe(getRecipe(recipeName))) names.add(n); } catch { /* reported elsewhere */ }
    }
    for (const collectionName of doc.collections || []) {
        try { for (const n of getCollection(collectionName).components) names.add(n); } catch { /* reported elsewhere */ }
    }
    return [...names];
}

async function installedComponentNames() {
    const names = [];
    for (const pkg of loadPackages()) {
        if (!pkg.validate) continue;
        try {
            if ((await validate(pkg)) === 0) names.push(pkg.name);
        } catch {
            // Not installed / validate couldn't run - not part of the default scan target.
        }
    }
    return names;
}

// resolveScanTargets(names, opts) -> string[] of package names to scan.
// Explicit names win; else --profile/--recipe/--workspace narrows the set;
// else default to everything currently installed (mirrors `profile
// export`'s and `stats`'s "what's actually installed right now" scope).
async function resolveScanTargets(names, opts) {
    if (names && names.length > 0) return names;
    if (opts.profile) return expandProfile(getProfile(opts.profile));
    if (opts.recipe) return expandRecipe(getRecipe(opts.recipe));
    if (opts.workspace) return resolveWorkspaceComponents(getWorkspace(opts.workspace));
    return installedComponentNames();
}

function printIssues(issues) {
    for (const issue of issues) {
        const line = `[${issue.severity}] ${issue.tool}: ${issue.message}${issue.recommendation ? ` (${issue.recommendation})` : ""}`;
        if (issue.severity === "PASS" || issue.severity === "RECOMMEND") logger.success(line);
        else if (issue.severity === "WARNING") logger.warn(line);
        else logger.error(line);
    }
}

function printScoreLine(result) {
    logger.info(`Compatibility score: ${result.score}% - ${result.verdict} (${result.pass} pass, ${result.recommend} recommend, ${result.warn} warn, ${result.critical} critical, ${result.unsupported} unsupported)`);
}

function addScanOptions(command) {
    return command
        .option("--profile <name>", "scan a profile's resolved components instead of what's installed")
        .option("--recipe <name>", "scan a recipe's resolved components instead of what's installed")
        .option("--workspace <name>", "scan a workspace's resolved components instead of what's installed");
}

export function registerCompatibilityCommand(program) {
    const compatibility = program
        .command("compatibility")
        .description("Validate whether installed tools actually work together (see docs/CompatibilityEngine.md)")
        .action(withErrorHandling(async function () {
            const names = await resolveScanTargets([], {});
            const result = await scanCompatibility(names);
            printIssues(result.issues);
            printScoreLine(result);
            if (result.critical > 0 || result.unsupported > 0) process.exitCode = 1;
        }));

    addScanOptions(
        compatibility
            .command("scan [names...]")
            .description("Scan components for compatibility issues (defaults to everything installed)")
            .option("--json", "emit as JSON")
            .option("--ai", "also ask the configured AI provider (see docs/AIAssistant.md) to explain the results in plain language")
    ).action(withErrorHandling(async function (names) {
        const opts = this.opts();
        const targets = await resolveScanTargets(names, opts);
        const result = await scanCompatibility(targets);
        if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            logger.section(`Compatibility scan (${targets.length} component(s))`);
            printIssues(result.issues);
            printScoreLine(result);
        }
        if (opts.ai) {
            logger.section("AI explanation");
            try {
                console.log(await getAIRecommendations(result));
            } catch (err) {
                logger.warn(err.message);
            }
        }
        if (result.critical > 0 || result.unsupported > 0) process.exitCode = 1;
    }));

    compatibility
        .command("check <names...>")
        .description("Like scan, but scoped to exactly the given components and non-zero exit on any CRITICAL/UNSUPPORTED finding (for CI/scripting)")
        .action(withErrorHandling(async (names) => {
            const result = await scanCompatibility(names);
            printIssues(result.issues);
            printScoreLine(result);
            if (result.critical > 0 || result.unsupported > 0) {
                throw usageError(`Compatibility check failed: ${result.critical} critical, ${result.unsupported} unsupported finding(s).`);
            }
        }));

    compatibility
        .command("explain <name>")
        .description("Explain one component's compatibility requirements in detail")
        .action(withErrorHandling(async (name) => {
            const explanation = await explainComponent(name);
            logger.section(`${explanation.name}${explanation.installedVersion ? ` ${explanation.installedVersion}` : ""}`);
            if (!explanation.installedVersion) {
                logger.warn("Installed version could not be detected.");
            }
            if (explanation.matchedVersionKey) {
                console.log(`  Matched rule: versions.${explanation.matchedVersionKey}`);
            }
            if (explanation.deprecated) logger.warn(`${explanation.name} ${explanation.matchedVersionKey} is deprecated`);
            if (explanation.experimental) logger.warn(`${explanation.name} ${explanation.matchedVersionKey} is experimental`);
            if (explanation.unsupported) logger.error(`${explanation.name} ${explanation.matchedVersionKey} is unsupported`);

            if (explanation.requirements.length > 0) {
                console.log(`\n  ${explanation.name} requires`);
                for (const req of explanation.requirements) {
                    const mark = req.satisfied === true ? "✓" : req.satisfied === false ? "✗" : "?";
                    const label = req.tier === "recommends" ? " (recommended)" : "";
                    console.log(`    ${mark} ${req.name} ${req.range}${label}${req.installedVersion ? ` - found ${req.installedVersion}` : req.knownPackage ? " - not installed" : " - unknown component"}`);
                }
            }
            if (explanation.conflicts.length > 0) {
                console.log(`\n  Conflicts with: ${explanation.conflicts.join(", ")}`);
            }
            if (explanation.recommendations.length > 0) {
                console.log("\n  Recommendation:");
                for (const r of explanation.recommendations) console.log(`    ${r}`);
            }
        }));

    addScanOptions(
        compatibility
            .command("repair [names...]")
            .description("Generate (and, unless --dry-run, execute) a repair plan: install missing requirements, run recommended upgrades, and - only after confirmation - remove conflicting packages")
            .option("--dry-run", "only print the plan, don't execute it")
            .option("-y, --yes", "don't prompt before removing a conflicting package")
    ).action(withErrorHandling(async function (names) {
        const opts = this.opts();
        const targets = await resolveScanTargets(names, opts);
        const result = await scanCompatibility(targets);
        const actions = planRepair(result);

        if (actions.length === 0) {
            logger.success("Nothing to repair.");
            return;
        }

        logger.section("Repair plan");
        for (const action of actions) {
            console.log(`  [${action.type}] ${action.tool || action.name} - ${action.reason || action.message}`);
        }

        if (opts.dryRun) {
            logger.info("--dry-run: no changes made.");
            return;
        }

        const results = await executeRepairPlan(actions, { assumeYes: Boolean(opts.yes || process.env.DEV_SETUP_ASSUME_YES === "1") });
        logger.section("Repair results");
        let failed = 0;
        for (const r of results) {
            if (r.skipped) logger.warn(`Skipped: ${r.action.tool || r.action.name} - ${r.action.reason || r.action.message}`);
            else if (r.ok) logger.success(`${r.action.type}: ${r.action.tool || r.action.name}`);
            else { logger.error(`${r.action.type}: ${r.action.tool || r.action.name}${r.error ? ` (${r.error})` : ""}`); failed++; }
        }
        if (failed > 0) process.exitCode = 1;
    }));

    addScanOptions(
        compatibility
            .command("graph [names...]")
            .description("Show the dependency graph for a set of components: missing deps, cycles, duplicate tool claims")
            .option("--json", "emit as JSON")
    ).action(withErrorHandling(async function (names) {
        const opts = this.opts();
        const targets = await resolveScanTargets(names, opts);
        const packages = loadPackages();
        const { nodes, edges, missing } = buildDependencyGraph(targets, { packages });
        const cycles = detectCycles(targets, { packages });
        const duplicates = detectDuplicateTools(packages);

        if (opts.json) {
            console.log(JSON.stringify({ nodes, edges, missing, cycles, duplicates }, null, 2));
            return;
        }

        logger.section(`Dependency graph (${nodes.length} node(s))`);
        for (const edge of edges) console.log(`  ${edge.from} -> ${edge.to}`);
        if (missing.length > 0) logger.warn(`Missing: ${missing.join(", ")}`);
        if (cycles.length > 0) {
            for (const cycle of cycles) logger.error(`Circular dependency: ${cycle.join(" -> ")}`);
        } else {
            logger.success("No circular dependencies");
        }
        if (duplicates.length > 0) {
            logger.warn(`Duplicate tool claims: ${duplicates.map((d) => `'${d.claim}' (${d.owners.join(", ")})`).join(", ")}`);
        }
    }));

    compatibility
        .command("update")
        .description("Re-validate the local compatibility rule database (schema + cross-references) - there is no remote rule source to fetch from yet")
        .action(withErrorHandling(async () => {
            const rules = loadCompatibilityRuleFiles();
            const problems = checkRuleIntegrity(rules, loadPackages());
            if (problems.length > 0) {
                logger.error(`${problems.length} problem(s) found:`);
                for (const p of problems) console.log(`  ${p}`);
                process.exitCode = 1;
                return;
            }
            logger.success(`${rules.length} compatibility rule file(s) are valid and internally consistent.`);
            logger.info("There is no remote compatibility rule source yet - this only re-validates registry/compatibility/*.yaml on disk.");
        }));

    addScanOptions(
        compatibility
            .command("export <path> [names...]")
            .description("Write a compatibility report to disk")
            .option("--format <fmt>", "md|html|json|pdf (pdf produces PDF-ready Markdown, not a binary PDF)", "md")
    ).action(withErrorHandling(async function (destPath, names) {
        const opts = this.opts();
        const targets = await resolveScanTargets(names, opts);
        const result = await scanCompatibility(targets);

        const renderers = { md: toMarkdown, html: toHtml, json: toJson, pdf: toPdfReadyMarkdown };
        const render = renderers[opts.format];
        if (!render) {
            throw usageError(`Unknown --format '${opts.format}' - expected one of: ${Object.keys(renderers).join(", ")}`);
        }

        writeFileSync(path.resolve(destPath), render(result));
        logger.success(`Wrote ${opts.format} report to ${destPath}`);
    }));
}
