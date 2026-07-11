// Profile command (see docs/PlatformArchitecture.md's Profiles section).
// Two distinct, deliberately coexisting concepts under one noun:
//
//  - Layer 1 "bootstrap profiles" (profiles/<name>/Brewfile, unchanged
//    since before this platform work) - `list`/`show`/`use` forward to
//    scripts/profile.sh exactly as before; they answer "what do I
//    bootstrap a fresh machine with."
//  - Layer 2 "environment profiles" (registry/profiles/*.yaml, new) - a
//    profile composes one or more *collections* plus extra ad hoc
//    *components* plus optional suggested config *settings*; `install`/
//    `create`/`export`/`import`/`search` are native. They answer "what
//    do I install on an already-bootstrapped machine to reproduce an
//    environment."
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { load as yamlLoad, dump as yamlDump } from "js-yaml";
import { runScript } from "../core/shell.js";
import {
    loadProfiles,
    getProfile,
    expandProfile,
    validateProfileDoc,
    loadCollections,
    loadPackages
} from "../core/registry.js";
import { validate } from "../core/installer.js";
import { setConfigValue } from "../core/config.js";
import { runInstallPlan } from "../lib/installRunner.js";
import { select, multiselect, confirm, text } from "../lib/prompts.js";
import { userConfigDir } from "../core/paths.js";
import { scanCompatibility } from "../core/compatibility/engine.js";
import { checkCompatibilityBeforeInstall } from "./recipe.js";
import { table, section } from "../lib/ui.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";

function userProfilesDir() {
    return path.join(userConfigDir(), "profiles");
}

function writeProfileFile(profile) {
    const filePath = path.join(userProfilesDir(), `${profile.name}.yaml`);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, yamlDump(profile));
    return filePath;
}

async function pickFromCategory(message, packages, category, { multi = false } = {}) {
    const choices = packages
        .filter((p) => p.category === category)
        .map((p) => ({ title: `${p.name} - ${p.description}`, value: p.name }));
    if (choices.length === 0) return multi ? [] : null;
    return multi ? multiselect(message, choices) : select(message, choices);
}

async function applyProfileSettings(profile) {
    if (!profile.settings) return;
    for (const [key, value] of Object.entries(profile.settings)) {
        setConfigValue(key, value);
    }
    logger.success(`Applied profile settings to config: ${Object.keys(profile.settings).join(", ")}`);
}

export function registerProfileCommand(program) {
    const profile = program
        .command("profile")
        .description("Manage bootstrap profiles (Layer 1) and environment profiles (Layer 2)");

    profile
        .command("list")
        .description("List bootstrap profiles and environment profiles")
        .action(withErrorHandling(async () => {
            await runScript("scripts/profile.sh", ["list"]);
            const profiles = loadProfiles();
            if (profiles.length === 0) {
                logger.info("\nNo environment profiles found.");
                return;
            }
            const rows = [];
            for (const p of profiles) {
                const components = expandProfile(p);
                const compatibility = await scanCompatibility(components);
                rows.push({ name: p.name, description: p.description, components: components.length, compatibility: `${compatibility.score}% ${compatibility.verdict}` });
            }
            console.log(`\n${section("Environment profiles (registry-driven)", [
                table(rows, [
                    { key: "name", label: "NAME" },
                    { key: "description", label: "DESCRIPTION", maxWidth: 35 },
                    { key: "components", label: "COMPONENTS" },
                    { key: "compatibility", label: "COMPATIBILITY" }
                ])
            ])}`);
            logger.info("Next: devforgekit profile show <name>, or devforgekit profile install <name>");
        }));

    profile
        .command("show <name>")
        .description("Show one profile's definition (environment profile) or Brewfile contents (bootstrap profile)")
        .action(withErrorHandling(async (name) => {
            const found = loadProfiles().find((p) => p.name === name);
            if (found) {
                const compatibility = await scanCompatibility(expandProfile(found));
                console.log(JSON.stringify({ ...found, compatibility: { score: compatibility.score, verdict: compatibility.verdict } }, null, 2));
                return;
            }
            const code = await runScript("scripts/profile.sh", ["show", name]);
            process.exitCode = code;
        }));

    profile
        .command("use <name>")
        .description("Set the default bootstrap profile (Layer 1 - forwards to scripts/profile.sh use)")
        .action(withErrorHandling(async (name) => {
            const code = await runScript("scripts/profile.sh", ["use", name]);
            process.exitCode = code;
        }));

    profile
        .command("install <name>")
        .description("Install an environment profile (its collections + components), resolving dependencies")
        .option("--skip-compatibility", "skip the pre-install compatibility check")
        .option("-y, --yes", "don't prompt if the compatibility check finds critical/unsupported issues")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const p = getProfile(name);
            const componentNames = expandProfile(p);

            if (!opts.skipCompatibility && !(await checkCompatibilityBeforeInstall(componentNames, { assumeYes: opts.yes }))) {
                logger.info("Cancelled.");
                process.exitCode = 1;
                return;
            }

            logger.info(`Installing profile '${p.name}': ${componentNames.join(", ")}`);
            const { failed } = await runInstallPlan(componentNames);
            await applyProfileSettings(p);
            if (failed > 0) process.exitCode = 1;
        }));

    profile
        .command("create")
        .description("Interactively build a new environment profile")
        .action(withErrorHandling(async () => {
            const name = await text("Profile name (lowercase, hyphens only)?");
            if (!name) {
                logger.info("Cancelled - no name given.");
                return;
            }
            const description = await text("Short description?", `Custom profile: ${name}`);

            const packages = loadPackages();
            const editor = await pickFromCategory("Preferred editor?", packages, "editors");
            const browser = await pickFromCategory("Preferred browser?", packages, "browsers");
            const terminal = await pickFromCategory("Preferred terminal?", packages, "terminals");
            const cloud = await pickFromCategory("Cloud providers? (space to select, enter to confirm)", packages, "cloud", { multi: true });
            const ai = await pickFromCategory("AI tools?", packages, "ai", { multi: true });
            const languages = await pickFromCategory("Languages?", packages, "languages", { multi: true });
            const databases = await pickFromCategory("Databases?", packages, "databases", { multi: true });
            const containers = await pickFromCategory("Containers?", packages, "containers", { multi: true });
            const fonts = await pickFromCategory("Fonts?", packages, "fonts", { multi: true });
            const includeGh = await confirm("Include GitHub CLI (gh)?", true);

            const components = new Set(["git"]);
            for (const value of [editor, browser, terminal]) {
                if (value) components.add(value);
            }
            for (const group of [cloud, ai, languages, databases, containers, fonts]) {
                for (const value of group || []) components.add(value);
            }
            if (includeGh) components.add("github-cli");

            const settings = {};
            if (editor) settings.editor = editor;
            if (browser) settings.browser = browser;

            const newProfile = {
                schemaVersion: 1,
                name,
                description: description || `Custom profile: ${name}`,
                components: [...components],
                ...(Object.keys(settings).length > 0 ? { settings } : {})
            };

            const filePath = writeProfileFile(newProfile);
            logger.success(`Created profile '${name}' with ${components.size} components at ${filePath}`);
            logger.info(`Run 'devforgekit profile install ${name}' to install it.`);
        }));

    profile
        .command("export [name]")
        .description("Export the currently-installed components as a profile (writes to a file if <name> is given, else prints YAML)")
        .action(withErrorHandling(async (name) => {
            const installed = [];
            for (const pkg of loadPackages()) {
                if (!pkg.validate) continue;
                try {
                    if ((await validate(pkg)) === 0) installed.push(pkg.name);
                } catch {
                    // Not installed, or the validate command itself couldn't
                    // run - either way, it's not part of this export.
                }
            }

            const exported = {
                schemaVersion: 1,
                name: name || "exported-profile",
                description: `Exported from this machine on ${new Date().toISOString().slice(0, 10)}`,
                components: installed
            };
            const doc = yamlDump(exported);

            if (name) {
                const filePath = writeProfileFile(exported);
                logger.success(`Exported ${installed.length} installed components to ${filePath}`);
            } else {
                console.log(doc);
            }
        }));

    profile
        .command("import <file>")
        .description("Install a profile from an arbitrary YAML file (no registration needed)")
        .option("--skip-compatibility", "skip the pre-install compatibility check")
        .option("-y, --yes", "don't prompt if the compatibility check finds critical/unsupported issues")
        .action(withErrorHandling(async function (file) {
            const opts = this.opts();
            const doc = validateProfileDoc(yamlLoad(readFileSync(path.resolve(file), "utf8")));
            const componentNames = expandProfile(doc);

            if (!opts.skipCompatibility && !(await checkCompatibilityBeforeInstall(componentNames, { assumeYes: opts.yes }))) {
                logger.info("Cancelled.");
                process.exitCode = 1;
                return;
            }

            logger.info(`Importing profile '${doc.name}': ${componentNames.join(", ")}`);
            const { failed } = await runInstallPlan(componentNames);
            await applyProfileSettings(doc);
            if (failed > 0) process.exitCode = 1;
        }));

    profile
        .command("search <query>")
        .description("Search collection and profile names/descriptions (local only)")
        .action(withErrorHandling(async (query) => {
            const q = query.toLowerCase();
            const matches = (label, items) => items
                .filter((item) => item.name.includes(q) || item.description.toLowerCase().includes(q))
                .map((item) => `  [${label}] ${item.name} - ${item.description}`);

            const results = [
                ...matches("collection", loadCollections()),
                ...matches("profile", loadProfiles())
            ];

            if (results.length === 0) {
                throw usageError(`No collections or profiles matched '${query}'.`);
            }
            logger.section(`Results for '${query}'`);
            for (const line of results) console.log(line);
        }));

    profile
        .command("publish")
        .description("Publish a profile to the community registry (not yet available)")
        .action(withErrorHandling(async () => {
            logger.warn("'profile publish' is not implemented yet - there is no community registry to publish to.");
            logger.info("See docs/PlatformArchitecture.md's Plugin/Profile Marketplace Architecture section for the planned design.");
            process.exitCode = 1;
        }));
}
