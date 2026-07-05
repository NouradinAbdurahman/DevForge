// Native command: the registry search engine (see
// docs/PlatformArchitecture.md section 3). Matches name, description,
// category, tags, and aliases, ranked by match quality; --category/--tag
// narrow the candidate set before ranking.
import { searchPackages } from "../core/registry.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";

export function registerSearchCommand(program) {
    program
        .command("search <query>")
        .description("Search components by name, description, category, tags, or aliases")
        .option("--category <id>", "only search within one category")
        .option("--tag <tag>", "only search components carrying this tag")
        .action(withErrorHandling(async function (query) {
            const opts = this.opts();
            const matches = searchPackages(query, { category: opts.category, tag: opts.tag });
            if (matches.length === 0) {
                throw usageError(`No components matched '${query}'. Try 'devforgekit component list'.`);
            }

            logger.section(`Search results for '${query}'`);
            for (const { pkg, matchedOn } of matches) {
                console.log(`  ${pkg.name} - ${pkg.description} (matched: ${matchedOn})`);
            }
        }));
}
