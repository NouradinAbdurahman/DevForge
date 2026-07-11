// Native command: the component installer (see
// docs/PlatformArchitecture.md sections 3 and 6) AND the Component
// Manager's CLI surface (docs/ComponentManager.md) - every status/
// health/dependency/environment fact shown here comes from
// core/componentManager.js's getComponentStatus(), the one aggregation
// point every command (this one, `devforgekit info`, `devforgekit
// uninstall`) reads through. No command computes its own "is this
// installed"/"is this healthy" answer independently.
import { writeFileSync } from "node:fs";
import { loadCategories, loadPackages, getPackage } from "../core/registry.js";
import { validate, repair, update, uninstall, install } from "../core/installer.js";
import { runInstallPlan } from "../lib/installRunner.js";
import { multiselect } from "../lib/prompts.js";
import { unregisterPackageEnvironment, registerPackageEnvironment, dependentsOf } from "../core/environment/index.js";
import { loadEnvironmentState } from "../core/environment/state.js";
import { getComponentStatus, getAllComponentStatuses, componentHealthScore } from "../core/componentManager.js";
import { table, healthBar, healthColor, section } from "../lib/ui.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";
import chalk from "chalk";

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

// statusRow(status) -> one table row - Homebrew/npm/cargo-style: name,
// status, health, version, provider, whether an update or repair is
// available. Dependencies/environment detail live in `component info`/
// `component doctor` instead of this table - nine columns of mixed
// single- and multi-value data would overflow an 80-column terminal and
// stop being scannable, which defeats the point of a table.
function statusRow(status) {
    const health = componentHealthScore(status);
    const statusMark = status.installed ? chalk.green("✓ installed") : chalk.dim("○ not installed");
    return {
        name: status.name,
        status: statusMark,
        health: status.installed ? healthColor(health.score)(`${health.score}%`) : "-",
        version: status.version,
        provider: status.provider,
        update: status.updateAvailable ? chalk.yellow("available") : status.installed ? "-" : null,
        repair: status.capabilities.repair ? "available" : "-"
    };
}

const STATUS_COLUMNS = [
    { key: "name", label: "NAME" },
    { key: "status", label: "STATUS" },
    { key: "health", label: "HEALTH" },
    { key: "version", label: "VERSION" },
    { key: "provider", label: "PROVIDER" },
    { key: "update", label: "UPDATE" },
    { key: "repair", label: "REPAIR" }
];

// exportComponentListMarkdown(statuses) -> a Markdown table of every
// component's live status - the same fields statusRow()/STATUS_COLUMNS
// render as a terminal table, plain-text instead of chalk-colored.
function exportComponentListMarkdown(statuses) {
    const lines = [
        `# DevForgeKit Components`,
        ``,
        `**Date:** ${new Date().toISOString()}`,
        `**Total:** ${statuses.length}`,
        ``,
        `| Name | Status | Version | Provider | Update | Repair |`,
        `|------|--------|---------|----------|--------|--------|`
    ];
    for (const s of statuses) {
        const health = componentHealthScore(s);
        lines.push(`| ${s.name} | ${s.installed ? `installed (${health.score}%)` : "not installed"} | ${s.version || "-"} | ${s.provider || "-"} | ${s.updateAvailable ? "available" : "-"} | ${s.capabilities.repair ? "available" : "-"} |`);
    }
    return `${lines.join("\n")}\n`;
}

// doctorActions(status, health) -> the "Suggested actions" list both the
// terminal `component doctor` view and its Markdown export derive -
// computed once so the two can never drift out of sync.
function doctorActions(status, health) {
    const actions = [];
    if (!status.installed) actions.push(`devforgekit component install ${status.name}`);
    if (status.conflict) actions.push(`Remove the shadowed ${status.name} installation(s) above, or keep only the one currently used`);
    for (const dep of status.dependencies) {
        if (!dep.missing && !dep.installed) actions.push(`devforgekit component install ${dep.name}`);
    }
    if (health.score < 100 && status.capabilities.repair) actions.push(`devforgekit component repair ${status.name}`);
    return actions;
}

// exportComponentDoctorMarkdown(status, health, actions) -> the Markdown
// equivalent of the `component doctor <name>` terminal report.
function exportComponentDoctorMarkdown(status, health, actions) {
    const lines = [
        `# Component Doctor: ${status.name}`,
        ``,
        `**Date:** ${new Date().toISOString()}`,
        `**Health:** ${health.score}% - ${health.verdict}`,
        `**Installed:** ${status.installed ? `yes (${status.version || "unknown version"})` : "no"}`
    ];
    if (status.conflict) {
        lines.push(``, `## Conflicts`, ``);
        for (const loc of status.conflict.locations) {
            lines.push(`- ${loc.source}: ${loc.location}${loc.active ? " (currently used)" : ""}`);
        }
    }
    if (status.dependencies.length > 0) {
        lines.push(``, `## Dependencies`, ``, `| Name | Status |`, `|------|--------|`);
        for (const dep of status.dependencies) {
            lines.push(`| ${dep.name} | ${dep.missing ? "not a real component" : dep.installed ? "installed" : "not installed"} |`);
        }
    }
    if (actions.length > 0) {
        lines.push(``, `## Suggested Actions`, ``);
        for (const action of actions) lines.push(`- \`${action}\``);
    }
    return `${lines.join("\n")}\n`;
}

export function registerComponentCommand(program) {
    const component = program
        .command("component")
        .description("List, search, install, validate, repair, update, or uninstall registry components")
        .addHelpText("after", `
Examples:
  $ devforgekit component list --status         Live installed/health/version table
  $ devforgekit component info flutter          Unified status, health, dependencies
  $ devforgekit component doctor flutter         Health breakdown + suggested actions
  $ devforgekit component install flutter        Install (resolves dependencies)
  $ devforgekit component repair flutter         Fix a broken environment for one package

Learn more: devforgekit explain <name>, docs/ComponentManager.md`);

    component
        .command("list")
        .description("List every component, grouped by category (add --status for live installed/health/version/provider)")
        .option("--category <id>", "filter to a single category")
        .option("--status", "check live installed/version/health/provider status for each (slower - shells out per component)")
        .option("--installed", "with --status, show only installed components")
        .option("--json", "output as JSON (implies --status)")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const categories = loadCategories();
            let packages = loadPackages();
            if (opts.category) {
                packages = packages.filter((p) => p.category === opts.category);
            }

            if (!opts.status && !opts.json) {
                const groups = groupByCategory(packages, categories);
                logger.section(`DevForgeKit Components (${packages.length})`);
                for (const [label, pkgs] of groups) {
                    console.log(`\n${label}`);
                    for (const pkg of pkgs) {
                        console.log(`  ${pkg.name} - ${pkg.description}`);
                    }
                }
                return;
            }

            // --json output must be pure JSON on stdout for scripting
            // consumers - the progress line goes out only for the
            // human-readable path.
            if (!opts.json) logger.info(`Checking live status for ${packages.length} component(s)...`);
            const statuses = await getAllComponentStatuses({ packages, onlyInstalled: opts.installed });

            if (opts.json) {
                console.log(JSON.stringify(statuses, null, 2));
                return;
            }

            const byCategory = new Map();
            for (const status of statuses) {
                const label = categories.find((c) => c.id === status.category)?.label || status.category;
                if (!byCategory.has(label)) byCategory.set(label, []);
                byCategory.get(label).push(status);
            }
            logger.section(`DevForgeKit Components (${statuses.length}${opts.installed ? " installed" : ""})`);
            for (const [label, group] of byCategory) {
                console.log(`\n${chalk.bold(label)}`);
                console.log(table(group.map(statusRow), STATUS_COLUMNS));
            }

            const installedCount = statuses.filter((s) => s.installed).length;
            const updateCount = statuses.filter((s) => s.updateAvailable).length;
            const conflictCount = statuses.filter((s) => s.conflict).length;
            console.log(`\n${installedCount} installed, ${statuses.length - installedCount} not installed${updateCount > 0 ? `, ${chalk.yellow(`${updateCount} update${updateCount === 1 ? "" : "s"} available`)}` : ""}${conflictCount > 0 ? `, ${chalk.red(`${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`)}` : ""}`);
        }));

    component
        .command("export [name]")
        .description("Export a Markdown report: every component's live status, or one component's full doctor report with <name>")
        .option("-o, --output <file>", "write the export to a file (default: stdout)")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            let content;
            if (name) {
                const status = await getComponentStatus(name);
                const health = componentHealthScore(status);
                content = exportComponentDoctorMarkdown(status, health, doctorActions(status, health));
            } else {
                logger.info(`Checking live status for ${loadPackages().length} component(s)...`);
                const statuses = await getAllComponentStatuses({ packages: loadPackages() });
                content = exportComponentListMarkdown(statuses);
            }
            if (opts.output) {
                writeFileSync(opts.output, content);
                logger.success(`Exported to ${opts.output}`);
            } else {
                console.log(content);
            }
        }));

    component
        .command("info <name>")
        .description("Unified component status: install/version/provider/binary, environment health, dependencies, capabilities (--json for the raw manifest)")
        .option("--json", "output the raw registry manifest instead")
        .action(withErrorHandling(async function (name) {
            if (this.opts().json) {
                console.log(JSON.stringify(getPackage(name), null, 2));
                return;
            }

            const status = await getComponentStatus(name);
            const health = componentHealthScore(status);

            const lines = [];
            if (status.installed) lines.push(healthBar(health.score), "");
            lines.push(`Installed      ${status.installed ? chalk.green("Yes") : chalk.dim("No")}`);
            if (status.provider) lines.push(`Provider       ${status.provider}`);
            if (status.version) lines.push(`Version        ${status.version}`);
            if (status.binary) lines.push(`Binary         ${status.binary}`);
            if (status.updateAvailable) lines.push(`Update         ${chalk.yellow("Available")}`);

            if (status.conflict) {
                lines.push("", chalk.red("Conflict       multiple installations found"));
                for (const loc of status.conflict.locations) {
                    lines.push(`               ${loc.active ? chalk.bold("→") : " "} ${loc.source}: ${loc.location}`);
                }
            }

            if (status.environment) {
                lines.push("", `Environment    ${status.environment.healthy ? chalk.green("Healthy") : chalk.yellow(`${status.environment.score}% - see 'devforgekit component doctor ${status.name}'`)}`);
            }

            if (status.dependencies.length > 0) {
                lines.push("", "Dependencies");
                for (const dep of status.dependencies) {
                    const mark = dep.installed ? chalk.green("✓") : dep.missing ? chalk.red("✗ (not a real component)") : chalk.dim("○ not installed");
                    lines.push(`               ${mark} ${dep.name}`);
                }
            }
            if (status.dependents.length > 0) {
                lines.push("", `Depended on by ${status.dependents.join(", ")}`);
            }

            lines.push("", "Capabilities", `               repair: ${status.capabilities.repair ? "available" : "n/a"}, update: ${status.capabilities.update ? "available" : "n/a"}, uninstall: ${status.capabilities.uninstall ? "available" : "n/a"}`);

            console.log(section(`${status.name} — ${status.description}`, lines));
        }));

    component
        .command("doctor <name>")
        .description("Diagnose one component: install status, environment health, dependency status, conflicts")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (name) {
            const status = await getComponentStatus(name);
            const health = componentHealthScore(status);

            if (this.opts().json) {
                console.log(JSON.stringify({ ...status, health }, null, 2));
                return;
            }

            const actions = doctorActions(status, health);
            const lines = [healthBar(health.score), ""];

            if (status.installed) lines.push(chalk.green(`✓ ${status.name} is installed${status.version ? ` (${status.version})` : ""}`));
            else lines.push(chalk.red(`✗ ${status.name} is not installed`));

            if (status.conflict) {
                lines.push(chalk.yellow(`! Multiple ${status.name} installations detected:`));
                for (const [i, loc] of status.conflict.locations.entries()) {
                    lines.push(`    ${i + 1}. ${loc.source}: ${loc.location}${loc.active ? "  (currently used)" : ""}`);
                }
            } else if (status.installed) {
                lines.push(chalk.green("✓ No shadowed installations"));
            }

            if (status.environment) {
                if (status.environment.healthy) {
                    lines.push(chalk.green("✓ Environment configuration is healthy"));
                } else {
                    for (const issue of status.environment.issues) lines.push(chalk.yellow(`! ${issue}`));
                }
            }

            for (const dep of status.dependencies) {
                if (dep.missing) {
                    lines.push(chalk.red(`✗ Dependency '${dep.name}' is not a real component`));
                } else if (!dep.installed) {
                    lines.push(chalk.yellow(`! Dependency '${dep.name}' is not installed`));
                } else {
                    lines.push(chalk.green(`✓ Dependency '${dep.name}' is installed`));
                }
            }

            console.log(section(`${status.name} — Health: ${health.verdict}`, lines));
            if (actions.length > 0) {
                console.log(`\n${chalk.bold("Suggested actions")}`);
                for (const action of actions) console.log(`  ${chalk.cyan("→")} ${action}`);
            }
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
            if (code === 0) await registerPackageEnvironment(name);
            process.exitCode = code;
        }));

    component
        .command("reinstall <name>")
        .description("Uninstall then install a component fresh")
        .action(withErrorHandling(async (name) => {
            const pkg = getPackage(name);
            if (!pkg.uninstall) {
                throw usageError(`'${name}' has no uninstall command defined - cannot reinstall`);
            }
            logger.info(`Uninstalling ${name}...`);
            const uninstallCode = await uninstall(pkg);
            if (uninstallCode !== 0) {
                logger.warn(`Uninstall step exited ${uninstallCode} - continuing with install anyway`);
            }
            unregisterPackageEnvironment(name);

            logger.info(`Installing ${name}...`);
            const installCode = await install(pkg);
            if (installCode === 0) {
                logger.success(`${name} reinstalled`);
                await registerPackageEnvironment(name);
            } else {
                logger.error(`Install step failed (exit ${installCode})`);
            }
            process.exitCode = installCode;
        }));

    component
        .command("uninstall <name>")
        .alias("remove")
        .description("Run a component's uninstall command")
        .action(withErrorHandling(async (name) => {
            const pkg = getPackage(name);

            // Dependency-impact warning (Environment Configuration
            // Engine): other tracked tools that depend on this one keep
            // working or break based on what's about to be removed -
            // say so before it happens, not after.
            const affected = dependentsOf(name, loadEnvironmentState());
            if (affected.length > 0) {
                logger.warn(`Removing ${name} will affect: ${affected.join(", ")}`);
            }

            const code = await uninstall(pkg);
            if (code === 0) {
                // Stop tracking + regenerate so the package's PATH/
                // variable contributions disappear with it.
                unregisterPackageEnvironment(name);
            }
            process.exitCode = code;
        }));
}
