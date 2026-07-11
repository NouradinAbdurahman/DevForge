// `devforgekit explain <name>` - the DX polish item: "why is this here,
// and is it safe to remove" without needing to cross-reference the
// registry/environment graph/collections by hand. Every fact reused
// from an existing subsystem, nothing new computed: dependents from the
// Environment Configuration Engine's dependency graph
// (core/environment/graph.js, the same data `component uninstall`'s
// impact warning and `env graph` use), collection/profile membership
// via a plain reverse lookup over the registry's own loaders.
import { getPackage, loadCollections, loadProfiles, expandProfile } from "../core/registry.js";
import { dependentsOf } from "../core/environment/index.js";
import { loadEnvironmentState } from "../core/environment/state.js";
import { getComponentStatus } from "../core/componentManager.js";
import { section } from "../lib/ui.js";
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";
import chalk from "chalk";

// collectionsContaining(name) -> string[] of collection ids whose
// `components` list includes `name` directly (not transitively - a
// collection is already a flat list). Exported for testing against the
// real, stable registry data - this reads static repo YAML, not live
// machine state, so it's safe and deterministic to test directly.
export function collectionsContaining(name, { collections = loadCollections() } = {}) {
    return collections
        .filter((c) => (c.components || []).includes(name))
        .map((c) => c.name);
}

// profilesContaining(name) -> string[] of profile ids that resolve to
// include `name`, via the same expandProfile() every real install uses
// (a profile can reference collections AND explicit components, so a
// direct `.components.includes` check would miss the collection case).
export function profilesContaining(name, { profiles = loadProfiles() } = {}) {
    return profiles
        .filter((p) => {
            try {
                return expandProfile(p).includes(name);
            } catch {
                return false;
            }
        })
        .map((p) => p.name);
}

export function registerExplainCommand(program) {
    program
        .command("explain <name>")
        .description("Why a component is installed, what depends on it, and whether it's safe to remove")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            // getPackage() already throws a DevForgeError with a
            // did-you-mean suggestion when relevant - re-throwing a
            // generic message here would silently discard that.
            const pkg = getPackage(name);

            const state = loadEnvironmentState();
            const dependents = dependentsOf(name, state);
            const collections = collectionsContaining(name);
            const profiles = profilesContaining(name);
            const status = await getComponentStatus(name);
            const safeToRemove = dependents.length === 0;

            const requiredBy = [
                ...profiles.map((p) => ({ label: `${p} profile`, kind: "profile" })),
                ...collections.map((c) => ({ label: `${c} collection`, kind: "collection" })),
                ...dependents.map((d) => ({ label: d, kind: "dependent" }))
            ];

            if (opts.json) {
                console.log(JSON.stringify({ name, installed: status.installed, dependencies: status.dependencies.map((d) => d.name), dependents, collections, profiles, safeToRemove }, null, 2));
                return;
            }

            const lines = [];
            if (requiredBy.length === 0) {
                lines.push(chalk.dim("Nothing tracked currently requires it - installed standalone or by direct request."));
            } else {
                lines.push(chalk.bold("Required by:"));
                for (const req of requiredBy) lines.push(`  ${chalk.green("✓")} ${req.label}`);
            }

            if (status.dependencies.length > 0) {
                lines.push("", chalk.bold("Depends on:"));
                for (const dep of status.dependencies) {
                    lines.push(`  ${dep.installed ? chalk.green("✓") : chalk.dim("○")} ${dep.name}`);
                }
            }

            if (dependents.length > 0) {
                lines.push("", chalk.bold(`Removing ${name} will affect:`));
                for (const dep of dependents) lines.push(`  • ${dep}`);
            }

            lines.push("", chalk.bold("Safe to remove?"), `  ${safeToRemove ? chalk.green("Yes") : chalk.red("No")}${safeToRemove ? "" : ` - ${dependents.length} tracked component${dependents.length === 1 ? "" : "s"} depend${dependents.length === 1 ? "s" : ""} on it`}`);

            console.log(section(`Why is ${pkg.name} installed?`, lines));

            if (!status.installed) {
                logger.info(`Note: ${name} is not currently installed - this reflects registry relationships, not live state.`);
            }
        }));
}
