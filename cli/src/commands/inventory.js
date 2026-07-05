// Runs the existing scripts/inventory.sh unchanged, then layers in a
// native compatibility report - the same "wrap the bash script, add a
// native follow-up" pattern commands/doctor.js already uses for its own
// compatibility integration.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { runScript } from "../core/shell.js";
import { loadPackages } from "../core/registry.js";
import { validate } from "../core/installer.js";
import { scanCompatibility } from "../core/compatibility/engine.js";
import { toMarkdown } from "../core/compatibility/report.js";
import { repoRoot } from "../core/paths.js";
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";

async function installedComponentNames() {
    const names = [];
    for (const pkg of loadPackages()) {
        if (!pkg.validate) continue;
        try {
            if ((await validate(pkg)) === 0) names.push(pkg.name);
        } catch {
            // Not installed - not part of the compatibility report.
        }
    }
    return names;
}

export function registerInventoryCommand(program) {
    program
        .command("inventory [args...]")
        .description("Generate machine inventory reports under reports/ (forwards flags to scripts/inventory.sh)")
        .allowUnknownOption(true)
        .option("--skip-compatibility", "skip writing reports/compatibility.md")
        .action(withErrorHandling(async function (args) {
            const opts = this.opts();
            const code = await runScript("scripts/inventory.sh", args);

            if (!opts.skipCompatibility) {
                const names = await installedComponentNames();
                const result = await scanCompatibility(names);
                const reportPath = path.join(repoRoot(), "reports", "compatibility.md");
                writeFileSync(reportPath, toMarkdown(result, { title: "DevForgeKit Compatibility Inventory" }));
                logger.success(`Generated reports/compatibility.md (score ${result.score}% - ${result.verdict})`);
            }

            process.exitCode = code;
        }));
}
