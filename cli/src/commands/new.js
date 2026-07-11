// Native command: the Project Generator (v1.2.2, see
// docs/ProjectGenerator.md and docs/PlatformArchitecture.md's Project
// Generator section). `devforgekit new <stack> [name]` goes beyond
// installing tools - it generates a complete, ready-to-code project.
// This file is deliberately thin: stack-specific logic lives in
// cli/src/generators/*.js, orchestration in core/projectGenerator.js.
import path from "node:path";
import { existsSync } from "node:fs";
import { GENERATORS, getGenerator } from "../generators/index.js";
import { runProjectGenerator, validateProjectName } from "../core/projectGenerator.js";
import { loadPackages } from "../core/registry.js";
import { scoreGenerator } from "../core/generatorQuality.js";
import { getActiveWorkspace, saveWorkspace } from "../core/workspace/store.js";
import { select, text } from "../lib/prompts.js";
import { table, section, healthColor } from "../lib/ui.js";
import { didYouMeanMessage } from "../lib/suggest.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";
import chalk from "chalk";

const LICENSE_CHOICES = [
    { title: "MIT", value: "mit" },
    { title: "Apache 2.0", value: "apache-2.0" },
    { title: "GPL 3.0", value: "gpl-3.0" },
    { title: "None", value: "none" }
];

// recordProjectHistory(stack, name, dir) - if a workspace is currently
// active, appends { stack, name, dir, createdAt } to its projectHistory
// (see docs/WorkspaceManager.md) so `workspace show` and the dashboard
// can surface "what did I build while this workspace was active."
// Deliberately swallows any failure (warn, don't throw) - recording
// history is a side effect of `new`, never a reason to make an
// otherwise-successful project generation look like it failed.
function recordProjectHistory(stack, name, dir) {
    try {
        const workspace = getActiveWorkspace();
        if (!workspace) return;
        const entry = { stack, name, dir, createdAt: new Date().toISOString() };
        saveWorkspace({ ...workspace, projectHistory: [...workspace.projectHistory, entry] });
        logger.verbose(`Recorded in workspace '${workspace.name}'s project history.`);
    } catch (err) {
        logger.warn(`Could not record this project in the active workspace's history: ${err.message}`);
    }
}

// printStackList() - the "list" and "info" entry points share this, both
// showing the real Generator Quality Score (Phase 11) inline rather than
// as a separate, easy-to-miss command, so "which stacks are the most
// complete" is visible at the exact moment someone is choosing one.
async function printStackList() {
    const scores = await Promise.all(GENERATORS.map((g) => scoreGenerator(g)));
    console.log(section(`Supported stacks (${GENERATORS.length})`, [
        table(
            GENERATORS.map((g, i) => ({
                stack: g.id,
                description: g.description,
                quality: healthColor(scores[i].score)(`${scores[i].score}%`)
            })),
            [
                { key: "stack", label: "STACK" },
                { key: "description", label: "DESCRIPTION", maxWidth: 45 },
                { key: "quality", label: "QUALITY" }
            ]
        )
    ]));
    logger.info("Next: devforgekit new <stack> [name], or devforgekit new <stack> --quality");
}

// printQualityBreakdown(generator) - `devforgekit new <stack> --quality`:
// the full per-category breakdown behind that one inline number above.
async function printQualityBreakdown(generator) {
    const scored = await scoreGenerator(generator);
    console.log(section(`${generator.label} Generator Quality Score: ${scored.score}%`, [
        table(
            scored.breakdown.map((b) => ({
                category: b.category,
                passed: `${b.passCount}/${b.total}`,
                score: healthColor(b.score)(`${b.score}%`)
            })),
            [
                { key: "category", label: "CATEGORY" },
                { key: "passed", label: "PASSED" },
                { key: "score", label: "SCORE" }
            ]
        )
    ]));
}

// printRecommends(generator) - Stack Intelligence (Project Generator
// Excellence, v2.1.2 Phase 7): shows real, registry-backed companion
// tools before scaffolding starts, so a user picks Flutter and
// immediately sees Firebase/Supabase/Android Studio exist as real,
// installable next steps - rather than discovering them later by luck.
// Each generator's `recommends` is a plain array of real package names
// (never fabricated); silently skipped if a name doesn't resolve rather
// than crashing project generation over a display nicety.
function printRecommends(generator) {
    if (!generator.recommends?.length) return;
    const packages = loadPackages();
    const rows = generator.recommends
        .map((id) => packages.find((p) => p.name === id))
        .filter(Boolean)
        .map((pkg) => ({ name: pkg.name, description: pkg.description }));
    if (rows.length === 0) return;
    console.log(section(`Recommended with ${generator.label}`, [
        table(rows, [
            { key: "name", label: "PACKAGE" },
            { key: "description", label: "DESCRIPTION", maxWidth: 55 }
        ])
    ]));
}

export function registerNewCommand(program) {
    program
        .command("new [stack] [name]")
        .alias("create")
        .description("Generate a complete, production-ready project for a supported stack (no arguments = pick interactively)")
        .option("--list", "list every supported stack and exit")
        .option("--dir <path>", "parent directory to create the project in (default: current directory)")
        .option("--state <name>", "[flutter] state management: riverpod|bloc|none")
        .option("--backend <name>", "[flutter] backend: supabase|firebase|none")
        .option("--auth", "[express] include JWT authentication")
        .option("--prisma", "[express] include Prisma + PostgreSQL")
        .option("--swagger", "[express] include Swagger/OpenAPI docs")
        .option("--shadcn", "[nextjs] include shadcn/ui")
        .option("--husky", "[nextjs] include Husky + lint-staged")
        .option("--tailwind", "[sveltekit] include Tailwind CSS")
        .option("--docker", "include a Dockerfile/docker-compose (most stacks)")
        .option("--license <id>", "mit|apache-2.0|gpl-3.0|none (default: mit)")
        .option("--quality", "show the Generator Quality Score breakdown for a stack and exit (no project generated)")
        .option("-y, --yes", "don't prompt if the pre-scaffold compatibility check finds critical/unsupported issues")
        .action(withErrorHandling(async function (stackArg, nameArg) {
            const opts = this.opts();

            if (opts.list || stackArg === "list") {
                await printStackList();
                return;
            }

            let stackId = stackArg;
            if (!stackId) {
                stackId = await select(
                    "Which stack?",
                    GENERATORS.map((g) => ({ title: `${g.label} - ${g.description}`, value: g.id }))
                );
                if (!stackId) {
                    logger.info("Cancelled - no stack selected.");
                    return;
                }
            }

            const generator = getGenerator(stackId);
            if (!generator) {
                const suggestion = didYouMeanMessage(stackId, GENERATORS.map((g) => g.id));
                throw usageError(`Unknown stack '${stackId}'.${suggestion ? ` ${suggestion}` : ""} Run 'devforgekit new --list' to see available stacks.`);
            }

            if (opts.quality) {
                await printQualityBreakdown(generator);
                return;
            }

            printRecommends(generator);

            let name = nameArg;
            if (!name) {
                name = await text("Project name?", `my-${generator.id}-app`);
                if (!name) {
                    logger.info("Cancelled - no project name given.");
                    return;
                }
            }
            validateProjectName(name);

            const parentDir = path.resolve(opts.dir || process.cwd());
            const targetDir = path.join(parentDir, name);
            if (existsSync(targetDir)) {
                throw usageError(`'${targetDir}' already exists - choose a different name or --dir.`);
            }

            // License: same "already answered via flag, else prompt"
            // pattern every per-stack promptOptions() already uses -
            // applied here once, universally, rather than each of 17
            // generators asking (or 12 of them never asking at all).
            let license = opts.license;
            if (license && !LICENSE_CHOICES.some((c) => c.value === license)) {
                throw usageError(`Unknown --license '${license}' - expected one of: ${LICENSE_CHOICES.map((c) => c.value).join(", ")}.`);
            }
            if (!license) {
                license = opts.yes ? "mit" : await select("License?", LICENSE_CHOICES);
                if (!license) license = "mit";
            }

            const options = { ...(generator.promptOptions ? await generator.promptOptions(opts) : {}), license };

            logger.info(`Generating ${generator.label} project '${name}' in ${parentDir}${path.sep}...`);
            const { dir, nextSteps } = await runProjectGenerator(generator, { name, parentDir, options, assumeYes: opts.yes });
            recordProjectHistory(generator.id, name, dir);

            // Structured post-generation summary (Project Generator
            // Excellence, v2.1.2 Phase 9) - every fact here is read back
            // from the real filesystem/generator result, never assumed,
            // so "CI Ready"/"Docker Ready" reflect what actually got
            // written rather than what was merely requested.
            const badge = (ok) => ok ? chalk.green("✓ yes") : chalk.dim("- no");
            console.log(section("Project Created", [
                `Location:      ${dir}`,
                `Stack:         ${generator.label}`,
                `License:       ${LICENSE_CHOICES.find((c) => c.value === license)?.title ?? license}`,
                `Git:           ${generator.skipGitInit ? "not initialized (handled by scaffold)" : "initialized"}`,
                `CI workflow:   ${badge(existsSync(path.join(dir, ".github", "workflows")))}`,
                `Docker:        ${badge(existsSync(path.join(dir, "Dockerfile")))}`,
                `README:        ${badge(existsSync(path.join(dir, "README.md")))}`
            ]));
            console.log(`\n${chalk.bold("Next commands")}`);
            for (const step of nextSteps) console.log(`  ${chalk.cyan("→")} ${step}`);
        }));
}
