// Native command: the registry search engine (see
// docs/PlatformArchitecture.md section 3). Matches name, description,
// category, tags, and aliases, ranked by match quality; --category/--tag
// narrow the candidate set before ranking.
import { searchPackages, loadPackages } from "../core/registry.js";
import { table, section } from "../lib/ui.js";
import { didYouMeanMessage } from "../lib/suggest.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";

const RESULT_COLUMNS = [
    { key: "name", label: "NAME" },
    { key: "description", label: "DESCRIPTION", maxWidth: 50 },
    { key: "matchedOn", label: "MATCHED ON" }
];

export function registerSearchCommand(program) {
    program
        .command("search <query>")
        .description("Search components by name, description, category, tags, or aliases")
        .option("--category <id>", "only search within one category")
        .option("--tag <tag>", "only search components carrying this tag")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (query) {
            const opts = this.opts();
            const matches = searchPackages(query, { category: opts.category, tag: opts.tag });

            if (opts.json) {
                console.log(JSON.stringify(matches.map(({ pkg, matchedOn }) => ({ name: pkg.name, description: pkg.description, matchedOn })), null, 2));
                return;
            }

            if (matches.length === 0) {
                const suggestion = didYouMeanMessage(query, loadPackages().map((p) => p.name));
                throw usageError(`No components matched '${query}'.${suggestion ? ` ${suggestion}` : ""} Try 'devforgekit component list'.`);
            }

            console.log(section(`Search results for '${query}' (${matches.length})`, [
                table(
                    matches.map(({ pkg, matchedOn }) => ({ name: pkg.name, description: pkg.description, matchedOn })),
                    RESULT_COLUMNS
                )
            ]));
            logger.info(`Next: devforgekit component info <name>, or devforgekit component install <name>`);
        }));
}
