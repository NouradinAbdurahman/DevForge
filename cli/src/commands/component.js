// Native command: the component installer (see
// docs/PlatformArchitecture.md sections 3 and 6). Reads registry/ package
// manifests and drives the generic installer, including dependency
// resolution and an interactive, category-grouped picker.
import { loadCategories, loadPackages, getPackage } from "../core/registry.js";
import { validate, repair, update, uninstall } from "../core/installer.js";
import { runInstallPlan } from "../lib/installRunner.js";
import { multiselect } from "../lib/prompts.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";

function groupByCategory(packages, categories) {
    const labels = new Map(categories.map((c) => [c.id, c.label]));
    const groups = new Map();
    for (const pkg of packages) {
        const label = labels.get(pkg.category) || pkg.category;
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(pkg);
    }
    return groups;
}

// buildGroupedChoices(packages, categories) -> a flat `prompts` multiselect
// choices array with a non-selectable heading entry (`disabled: true`,
// which the `prompts` library renders grayed-out and skips over during
// arrow-key navigation) before each category's components - the
// "Languages / Node / Python ..." grouped picker from the product brief.
export function buildGroupedChoices(packages, categories) {
    const groups = groupByCategory(packages, categories);
    const choices = [];
    for (const [label, pkgs] of groups) {
        choices.push({ title: `── ${label} ──`, value: `__heading__${label}`, disabled: true });
        for (const pkg of pkgs) {
            choices.push({ title: `  ${pkg.name} - ${pkg.description}`, value: pkg.name });
        }
    }
    return choices;
}

export function registerComponentCommand(program) {
    const component = program
        .command("component")
        .description("List, search, install, validate, repair, update, or uninstall registry components");

    component
        .command("list")
        .description("List every component, grouped by category")
        .option("--category <id>", "filter to a single category")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const categories = loadCategories();
            let packages = loadPackages();
            if (opts.category) {
                packages = packages.filter((p) => p.category === opts.category);
            }
            const groups = groupByCategory(packages, categories);
            logger.section(`DevForgeKit Components (${packages.length})`);
            for (const [label, pkgs] of groups) {
                console.log(`\n${label}`);
                for (const pkg of pkgs) {
                    console.log(`  ${pkg.name} - ${pkg.description}`);
                }
            }
        }));

    component
        .command("info <name>")
        .description("Show the full manifest for one component")
        .action(withErrorHandling(async (name) => {
            const pkg = getPackage(name);
            console.log(JSON.stringify(pkg, null, 2));
        }));

    component
        .command("install [names...]")
        .description("Install one or more components, resolving dependencies (interactive picker if none given)")
        .option("--variant <id>", "which variant to install, for components with variants")
        .action(withErrorHandling(async function (names) {
            const opts = this.opts();
            let targets = names;

            if (!targets || targets.length === 0) {
                const packages = loadPackages();
                const categories = loadCategories();
                const choices = buildGroupedChoices(packages, categories);
                const picked = await multiselect("Select components to install", choices);
                if (!picked || picked.length === 0) {
                    logger.info("Nothing selected.");
                    return;
                }
                targets = picked;
            }

            const variants = {};
            if (opts.variant) {
                for (const name of targets) variants[name] = opts.variant;
            }

            const { failed } = await runInstallPlan(targets, { variants });
            if (failed > 0) process.exitCode = 1;
        }));

    component
        .command("validate <name>")
        .description("Run a component's validate command")
        .action(withErrorHandling(async (name) => {
            const pkg = getPackage(name);
            const code = await validate(pkg);
            if (code === 0) {
                logger.success(`${name} is healthy`);
            } else {
                logger.warn(`${name} validation failed (exit ${code})`);
                process.exitCode = code;
            }
        }));

    component
        .command("repair <name>")
        .description("Run a component's repair command")
        .action(withErrorHandling(async (name) => {
            const pkg = getPackage(name);
            if (!pkg.repair) {
                throw usageError(`'${name}' has no repair command defined`);
            }
            const code = await repair(pkg);
            process.exitCode = code;
        }));

    component
        .command("update <name>")
        .description("Run a component's update command")
        .action(withErrorHandling(async (name) => {
            const pkg = getPackage(name);
            if (!pkg.update) {
                throw usageError(`'${name}' has no update command defined`);
            }
            const code = await update(pkg);
            process.exitCode = code;
        }));

    component
        .command("uninstall <name>")
        .description("Run a component's uninstall command")
        .action(withErrorHandling(async (name) => {
            const pkg = getPackage(name);
            const code = await uninstall(pkg);
            process.exitCode = code;
        }));
}
