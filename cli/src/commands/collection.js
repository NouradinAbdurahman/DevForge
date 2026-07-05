// Native command: package collections/bundles (see
// docs/PlatformArchitecture.md section 3). A collection is a named list
// of component names; `collection install` resolves and installs all of
// them (plus their dependencies) through the same install runner
// `component install` uses.
import { loadCollections, getCollection } from "../core/registry.js";
import { runInstallPlan } from "../lib/installRunner.js";
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";

export function registerCollectionCommand(program) {
    const collection = program
        .command("collection")
        .description("List, inspect, or install curated component collections");

    collection
        .command("list")
        .description("List every collection")
        .action(withErrorHandling(async () => {
            logger.section("DevForgeKit Collections");
            for (const c of loadCollections()) {
                console.log(`  ${c.name} - ${c.description} (${c.components.length} components)`);
            }
        }));

    collection
        .command("info <name>")
        .description("Show a collection's member components")
        .action(withErrorHandling(async (name) => {
            const c = getCollection(name);
            console.log(JSON.stringify(c, null, 2));
        }));

    collection
        .command("install <name>")
        .description("Install every component in a collection, resolving dependencies")
        .action(withErrorHandling(async (name) => {
            const c = getCollection(name);
            logger.info(`Installing collection '${c.name}': ${c.components.join(", ")}`);
            const { failed } = await runInstallPlan(c.components);
            if (failed > 0) process.exitCode = 1;
        }));
}
