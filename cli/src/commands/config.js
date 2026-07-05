// Native Phase 1 command: the configuration manager (see
// docs/PlatformArchitecture.md section 7). Operates on the user-level
// layer (~/.devforgekit/config.json); the repo-level .devforgekit.yml is
// edited by hand/PR, like mise.toml.
import { getConfigValue, setConfigValue, listConfig } from "../core/config.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";

export function registerConfigCommand(program) {
    const config = program
        .command("config")
        .description("Get, set, or list DevForgeKit configuration");

    config
        .command("get <key>")
        .description("Print the effective value of a config key")
        .action(withErrorHandling(async (key) => {
            const value = getConfigValue(key);
            if (value === undefined) {
                throw usageError(`No config value set for '${key}'`);
            }
            console.log(typeof value === "string" ? value : JSON.stringify(value));
        }));

    config
        .command("set <key> <value>")
        .description("Persist a config key to ~/.devforgekit/config.json")
        .action(withErrorHandling(async (key, value) => {
            setConfigValue(key, value);
            logger.success(`Set ${key} = ${value}`);
        }));

    config
        .command("list")
        .description("Print the fully merged, effective configuration")
        .option("--json", "emit as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const merged = listConfig();
            if (opts.json) {
                console.log(JSON.stringify(merged, null, 2));
            } else {
                logger.section("DevForgeKit Configuration");
                for (const [key, value] of Object.entries(merged)) {
                    console.log(`  ${key} = ${JSON.stringify(value)}`);
                }
            }
        }));
}
