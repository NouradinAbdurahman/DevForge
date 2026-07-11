// Native command: the Recipe Engine (v1.2.1, see
// docs/PlatformArchitecture.md's Recipe system section). A recipe is a
// lighter-weight, opinionated sibling of a profile: it resolves the same
// collections/components through the same installer profiles use
// (lib/installRunner.js's runInstallPlan), then layers two things
// profiles don't have - `configure` (cross-cutting dotfile/environment
// restoration) and `verify` (a post-install health pass) - so one
// command replaces the manual "install X, install Y, configure Z, verify
// everything" checklist from the product brief.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { load as yamlLoad, dump as yamlDump } from "js-yaml";
import {
    loadRecipes,
    getRecipe,
    expandRecipe,
    validateRecipeDoc,
    loadPackages,
    loadCategories
} from "../core/registry.js";
import { runConfigureStep, configureActionNames, verifyComponents } from "../core/recipes.js";
import { setConfigValue } from "../core/config.js";
import { runInstallPlan } from "../lib/installRunner.js";
import { buildGroupedChoices } from "./component.js";
import { multiselect, confirm, text } from "../lib/prompts.js";
import { userConfigDir } from "../core/paths.js";
import { scanCompatibility } from "../core/compatibility/engine.js";
import { table, section } from "../lib/ui.js";
import { didYouMeanMessage } from "../lib/suggest.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";

// checkCompatibilityBeforeInstall(componentNames) -> true to proceed, false
// to abort. Shared by recipe install/import and profile install/import
// (see commands/profile.js) so a critical/unsupported combination is
// always surfaced - and confirmed past - before installing, not just
// discoverable after the fact via `devforgekit compatibility scan`.
export async function checkCompatibilityBeforeInstall(componentNames, { assumeYes = false } = {}) {
    const result = await scanCompatibility(componentNames);
    if (result.critical === 0 && result.unsupported === 0) return true;

    logger.section("Compatibility check");
    for (const issue of result.issues) {
        if (issue.severity !== "CRITICAL" && issue.severity !== "UNSUPPORTED") continue;
        logger.error(`[${issue.severity}] ${issue.tool}: ${issue.message}${issue.recommendation ? ` (${issue.recommendation})` : ""}`);
    }
    logger.warn(`Compatibility score: ${result.score}% - ${result.verdict}`);

    if (assumeYes || process.env.DEV_SETUP_ASSUME_YES === "1") return true;
    return confirm("Proceed anyway?", false);
}

function userRecipesDir() {
    return path.join(userConfigDir(), "recipes");
}

function writeRecipeFile(recipe) {
    const filePath = path.join(userRecipesDir(), `${recipe.name}.yaml`);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, yamlDump(recipe));
    return filePath;
}

async function applyRecipeSettings(recipe) {
    if (!recipe.settings) return;
    for (const [key, value] of Object.entries(recipe.settings)) {
        setConfigValue(key, value);
    }
    logger.success(`Applied recipe settings to config: ${Object.keys(recipe.settings).join(", ")}`);
}

async function runConfigure(steps) {
    if (!steps || steps.length === 0) return 0;
    logger.section("Configure");
    let failed = 0;
    for (const step of steps) {
        const code = await runConfigureStep(step);
        if (code === 0) {
            logger.success(`Configured ${step}`);
        } else {
            logger.warn(`Configuring ${step} exited ${code}`);
            failed++;
        }
    }
    return failed;
}

async function runVerify(componentNames) {
    logger.section("Verify");
    const { total, passed, failed, results } = await verifyComponents(componentNames);
    for (const r of results) {
        if (r.status === "pass") logger.success(`${r.name} verified`);
        else if (r.status === "fail") logger.error(`${r.name} failed verification`);
        else if (r.status === "unknown") logger.warn(`${r.name} is not a known registry component - skipped`);
        else logger.info(`${r.name} - no health check defined, skipped`);
    }
    logger.info(`Verify: ${passed}/${total} passed (components without a validate command are skipped, not failed)`);
    return failed;
}

// installRecipeDoc(recipe, opts) -> orchestrates install -> configure ->
// settings -> verify for both `recipe install <name>` (a registered
// recipe) and `recipe import <file>` (an arbitrary one) so neither
// command duplicates this sequence.
async function installRecipeDoc(r, { skipConfigure = false, skipVerify = false, skipCompatibility = false, assumeYes = false } = {}) {
    const componentNames = expandRecipe(r);

    if (!skipCompatibility && !(await checkCompatibilityBeforeInstall(componentNames, { assumeYes }))) {
        logger.info("Cancelled.");
        process.exitCode = 1;
        return;
    }

    logger.info(`Installing recipe '${r.name}': ${componentNames.join(", ")}`);
    const { failed } = await runInstallPlan(componentNames);

    const configureFailed = skipConfigure ? 0 : await runConfigure(r.configure);

    await applyRecipeSettings(r);

    const verifyFailed = (!skipVerify && r.verify !== false) ? await runVerify(componentNames) : 0;

    logger.section("Recipe summary");
    if (failed === 0 && configureFailed === 0 && verifyFailed === 0) {
        logger.success(`Recipe '${r.name}' installed, configured, and verified.`);
    } else {
        logger.warn(`Recipe '${r.name}' finished with ${failed} install failure(s), ${configureFailed} configure failure(s), ${verifyFailed} verify failure(s).`);
        process.exitCode = 1;
    }
}

export function registerRecipeCommand(program) {
    const recipe = program
        .command("recipe")
        .description("Manage recipes - reusable, one-command environment workflows (install + configure + verify)")
        .addHelpText("after", `
Examples:
  $ devforgekit recipe list                   Every recipe, with resolved component counts
  $ devforgekit recipe show flutter-developer  Components, configure steps, compatibility score
  $ devforgekit recipe install flutter-developer  Install -> configure -> verify, in one step
  $ devforgekit recipe create                 Interactively build a custom recipe

Learn more: docs/Recipes.md`);

    recipe
        .command("list")
        .description("List every recipe")
        .action(withErrorHandling(async () => {
            const recipes = loadRecipes();
            if (recipes.length === 0) {
                logger.info("No recipes found.");
                return;
            }
            console.log(section(`DevForgeKit Recipes (${recipes.length})`, [
                table(
                    recipes.map((r) => ({
                        name: `${r.icon ? `${r.icon} ` : ""}${r.name}`,
                        description: r.description,
                        components: expandRecipe(r).length
                    })),
                    [
                        { key: "name", label: "NAME" },
                        { key: "description", label: "DESCRIPTION", maxWidth: 45 },
                        { key: "components", label: "COMPONENTS" }
                    ]
                )
            ]));
            logger.info("Next: devforgekit recipe show <name>, or devforgekit recipe install <name>");
        }));

    recipe
        .command("show <name>")
        .description("Show a recipe's resolved component list, configure/verify steps, and compatibility score")
        .action(withErrorHandling(async (name) => {
            const r = getRecipe(name);
            const components = expandRecipe(r);
            const compatibility = await scanCompatibility(components);
            logger.section(`${r.icon ? `${r.icon} ` : ""}${r.name}`);
            console.log(`  ${r.description}`);
            console.log();
            console.log(`  Components (${components.length}): ${components.join(", ")}`);
            console.log(`  Configure:      ${(r.configure || []).join(", ") || "none"}`);
            console.log(`  Verify:         ${r.verify === false ? "no" : "yes"}`);
            console.log(`  Compatibility:  ${compatibility.score}% - ${compatibility.verdict}`);
            if (r.settings) console.log(`  Settings:       ${JSON.stringify(r.settings)}`);
            if (r.tags?.length) console.log(`  Tags:           ${r.tags.join(", ")}`);
        }));

    recipe
        .command("install <name>")
        .description("Install a recipe: install its components, run its configure steps, then verify")
        .option("--skip-configure", "skip the configure steps")
        .option("--skip-verify", "skip the post-install verify pass")
        .option("--skip-compatibility", "skip the pre-install compatibility check")
        .option("-y, --yes", "don't prompt if the compatibility check finds critical/unsupported issues")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const r = getRecipe(name);
            await installRecipeDoc(r, { skipConfigure: opts.skipConfigure, skipVerify: opts.skipVerify, skipCompatibility: opts.skipCompatibility, assumeYes: opts.yes });
        }));

    recipe
        .command("import <file>")
        .description("Install a recipe from an arbitrary YAML file (no registration needed)")
        .option("--skip-configure", "skip the configure steps")
        .option("--skip-verify", "skip the post-install verify pass")
        .option("--skip-compatibility", "skip the pre-install compatibility check")
        .option("-y, --yes", "don't prompt if the compatibility check finds critical/unsupported issues")
        .action(withErrorHandling(async function (file) {
            const opts = this.opts();
            const doc = validateRecipeDoc(yamlLoad(readFileSync(path.resolve(file), "utf8")));
            await installRecipeDoc(doc, { skipConfigure: opts.skipConfigure, skipVerify: opts.skipVerify, skipCompatibility: opts.skipCompatibility, assumeYes: opts.yes });
        }));

    recipe
        .command("create")
        .description("Interactively build a new recipe")
        .action(withErrorHandling(async () => {
            const name = await text("Recipe name (lowercase, hyphens only)?");
            if (!name) {
                logger.info("Cancelled - no name given.");
                return;
            }
            const description = await text("Short description?", `Custom recipe: ${name}`);
            const icon = await text("Icon (single emoji, optional)?", "");

            const packages = loadPackages();
            const categories = loadCategories();
            const choices = buildGroupedChoices(packages, categories);
            const components = await multiselect("Select components to install (space to select, enter to confirm)", choices);

            const configureChoices = configureActionNames().map((a) => ({ title: a, value: a }));
            const configure = await multiselect("Select configure steps to run after install", configureChoices);

            const verify = await confirm("Verify every installed component afterward?", true);

            const newRecipe = {
                schemaVersion: 1,
                name,
                description: description || `Custom recipe: ${name}`,
                ...(icon ? { icon } : {}),
                components: components && components.length > 0 ? components : ["git"],
                ...(configure && configure.length > 0 ? { configure } : {}),
                verify
            };

            const filePath = writeRecipeFile(newRecipe);
            logger.success(`Created recipe '${name}' at ${filePath}`);
            logger.info(`Run 'devforgekit recipe install ${name}' to run it.`);
        }));

    recipe
        .command("search <query>")
        .description("Search recipe names/descriptions/tags (local only)")
        .action(withErrorHandling(async (query) => {
            const q = query.toLowerCase();
            const matches = loadRecipes().filter((r) => r.name.includes(q) ||
                r.description.toLowerCase().includes(q) ||
                (r.tags || []).some((t) => t.toLowerCase().includes(q)));

            if (matches.length === 0) {
                const suggestion = didYouMeanMessage(query, loadRecipes().map((r) => r.name));
                throw usageError(`No recipes matched '${query}'.${suggestion ? ` ${suggestion}` : ""}`);
            }
            logger.section(`Results for '${query}'`);
            for (const r of matches) {
                console.log(`  ${r.icon ? `${r.icon} ` : ""}${r.name} - ${r.description}`);
            }
        }));

    recipe
        .command("publish")
        .description("Publish a recipe to the community registry (not yet available)")
        .action(withErrorHandling(async () => {
            logger.warn("'recipe publish' is not implemented yet - there is no community registry to publish to.");
            logger.info("See docs/PlatformArchitecture.md's Plugin/Profile Marketplace Architecture section for the planned design.");
            process.exitCode = 1;
        }));
}
