// Self-Update command (v1.3.1). One-command update for the entire
// DevForgeKit platform: repo, registry, config, plugins, recipes, profiles.
// See core/self-update.js for the engine.
import { selfUpdate } from "../core/self-update.js";
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";

export function registerSelfUpdateCommand(program) {
    program
        .command("self-update")
        .alias("upgrade")
        .description("Update DevForgeKit itself: git pull, npm install, config migration, plugin updates, changelog")
        .option("--dry-run", "show what would happen without making changes")
        .option("--skip-plugins", "skip updating user plugins")
        .option("--skip-npm", "skip npm install in cli/")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const result = await selfUpdate({
                dryRun: opts.dryRun,
                skipPlugins: opts.skipPlugins,
                skipNpm: opts.skipNpm
            });

            if (!result.ok) {
                logger.error(`Self-update failed at step: ${result.error}`);
                if (result.rollback) {
                    logger.warn("Rollback completed - your DevForgeKit is back to its previous state");
                }
                process.exitCode = 1;
            }
        }));
}
