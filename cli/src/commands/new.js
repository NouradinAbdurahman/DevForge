// Native command: the Project Generator (v1.2.2, see
// docs/ProjectGenerator.md and docs/PlatformArchitecture.md's Project
// Generator section). `devforgekit new <stack> [name]` goes beyond
// installing tools - it generates a complete, ready-to-code project.
// This file is deliberately thin: stack-specific logic lives in
// cli/src/generators/*.js, orchestration in core/projectGenerator.js.
import path from "node:path";
import { GENERATORS, getGenerator } from "../generators/index.js";
import { runProjectGenerator } from "../core/projectGenerator.js";
import { getActiveWorkspace, saveWorkspace } from "../core/workspace/store.js";
import { select, text } from "../lib/prompts.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";

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

function printStackList() {
    logger.section("Supported stacks (devforgekit new <stack> [name])");
    const width = Math.max(...GENERATORS.map((g) => g.id.length));
    for (const g of GENERATORS) {
        console.log(`  ${g.id.padEnd(width)}  ${g.label} - ${g.description}`);
    }
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
        .option("--docker", "include a Dockerfile/docker-compose (most stacks)")
        .option("-y, --yes", "don't prompt if the pre-scaffold compatibility check finds critical/unsupported issues")
        .action(withErrorHandling(async function (stackArg, nameArg) {
            const opts = this.opts();

            if (opts.list || stackArg === "list") {
                printStackList();
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
                throw usageError(`Unknown stack '${stackId}'. Run 'devforgekit new --list' to see available stacks.`);
            }

            let name = nameArg;
            if (!name) {
                name = await text("Project name?", `my-${generator.id}-app`);
                if (!name) {
                    logger.info("Cancelled - no project name given.");
                    return;
                }
            }
            if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
                throw usageError(`Invalid project name '${name}' - use only letters, numbers, dots, dashes, and underscores.`);
            }

            const parentDir = path.resolve(opts.dir || process.cwd());
            const options = generator.promptOptions ? await generator.promptOptions(opts) : {};

            logger.info(`Generating ${generator.label} project '${name}' in ${parentDir}${path.sep}...`);
            const { dir, nextSteps } = await runProjectGenerator(generator, { name, parentDir, options, assumeYes: opts.yes });
            recordProjectHistory(generator.id, name, dir);

            logger.success(`Created ${dir}`);
            logger.section("Next steps");
            for (const step of nextSteps) console.log(`  ${step}`);
        }));
}
