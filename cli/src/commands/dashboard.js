// Native command: the Interactive Terminal Dashboard (v1.2.3, see
// docs/TUI.md). `devforgekit` with no arguments lands here too (see
// bin/devforgekit.js). The TUI module is imported *lazily, inside the
// action* - deliberately breaking the imports-at-top convention - so
// classic commands (`doctor`, `component install`, ...) never pay the
// cost of loading React/Ink/yoga just to run a non-interactive command;
// dashboard startup is the only path that needs them.
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";

export function registerDashboardCommand(program) {
    program
        .command("dashboard")
        .alias("ui")
        .description("Open the interactive terminal dashboard (also: run devforgekit with no arguments)")
        .option("--page <id>", "start on a specific page (components, doctor, ...)")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const { isTuiCapable, launchDashboard } = await import("../tui/index.js");
            if (!isTuiCapable()) {
                logger.warn("This terminal can't run the dashboard (no TTY, TERM=dumb, or DEVFORGEKIT_NO_TUI=1).");
                logger.info("Every feature is still available as classic commands - run 'devforgekit --help'.");
                process.exitCode = 1;
                return;
            }
            await launchDashboard({ initialPage: opts.page });
        }));
}
