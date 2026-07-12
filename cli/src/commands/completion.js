// `devforgekit completion install|uninstall|status|doctor` - shell
// completion management for npm-install users (Homebrew installs
// completions itself via the formula; this command is what makes the
// npm path just as complete). All real logic lives in
// core/completion.js - this file is a thin commander wrapper, same
// split every other command in this directory follows.
import {
    SUPPORTED_SHELLS,
    detectCurrentShell,
    detectAvailableShells,
    installShellCompletion,
    uninstallShellCompletion,
    completionStatus,
    isCurrentInstallStale
} from "../core/completion.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";

function resolveTargetShells(opts) {
    if (opts.shell) {
        if (!SUPPORTED_SHELLS.includes(opts.shell)) {
            throw usageError(`Unknown shell '${opts.shell}' - expected one of: ${SUPPORTED_SHELLS.join(", ")}`);
        }
        return [opts.shell];
    }
    if (opts.all) return SUPPORTED_SHELLS;
    return [detectCurrentShell()];
}

export function registerCompletionCommand(program) {
    const completion = program
        .command("completion")
        .alias("completions")
        .description("Manage shell completions (zsh/bash/fish) for npm installs");

    completion
        .command("install")
        .description("Install shell completions - defaults to your current shell ($SHELL)")
        .option("--shell <shell>", `install for one shell explicitly (${SUPPORTED_SHELLS.join("|")})`)
        .option("--all", "install for every supported shell found on this machine")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const targets = resolveTargetShells(opts);
            for (const shell of targets) {
                const { installedPath, rcFile } = installShellCompletion(shell);
                if (rcFile) {
                    logger.success(`Installed ${shell} completions: ${installedPath} (sourced from ${rcFile})`);
                } else {
                    logger.success(`Installed ${shell} completions: ${installedPath} (fish auto-loads this directory, no rc edit needed)`);
                }
            }
            logger.info("Restart your shell (or run 'exec $SHELL') to enable completions in your current session.");
        }));

    completion
        .command("uninstall")
        .description("Remove installed shell completions - defaults to your current shell ($SHELL)")
        .option("--shell <shell>", `uninstall for one shell explicitly (${SUPPORTED_SHELLS.join("|")})`)
        .option("--all", "uninstall for every supported shell")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const targets = resolveTargetShells(opts);
            for (const shell of targets) {
                const removed = uninstallShellCompletion(shell);
                logger.success(removed
                    ? `Removed ${shell} completions.`
                    : `No ${shell} completions were installed.`);
            }
        }));

    completion
        .command("status")
        .description("Show completion install status for every supported shell")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const results = await Promise.all(SUPPORTED_SHELLS.map((shell) => completionStatus(shell)));
            if (opts.json) {
                console.log(JSON.stringify(results, null, 2));
                return;
            }
            const current = detectCurrentShell();
            for (const r of results) {
                const marker = r.shell === current ? " (current shell)" : "";
                if (!r.available) {
                    logger.info(`${r.shell}${marker}: not found on this machine`);
                    continue;
                }
                if (!r.installed) {
                    logger.warn(`${r.shell}${marker}: available, completions not installed`);
                    continue;
                }
                const staleness = r.upToDate === false ? " (stale - packaged completions have changed)" : "";
                logger.success(`${r.shell}${marker}: installed at ${r.installedPath}${staleness}`);
            }
        }));

    completion
        .command("doctor")
        .description("Diagnose completion install issues (stale files, manually edited rc blocks)")
        .action(withErrorHandling(async function () {
            const available = await detectAvailableShells();
            if (available.length === 0) {
                logger.warn("No supported shell (zsh/bash/fish) was found on this machine.");
                return;
            }
            let anyIssue = false;
            for (const shell of available) {
                const status = await completionStatus(shell);
                if (!status.installed) {
                    logger.info(`${shell}: not installed - run 'devforgekit completion install --shell ${shell}'`);
                    continue;
                }
                if (status.upToDate === false || isCurrentInstallStale(shell)) {
                    anyIssue = true;
                    logger.warn(`${shell}: installed completions are stale - run 'devforgekit completion install --shell ${shell}' to refresh`);
                    continue;
                }
                if (status.blockCurrent === false) {
                    anyIssue = true;
                    logger.warn(`${shell}: the rc file's completion block doesn't match what DevForgeKit would write (manually edited?) - run 'devforgekit completion install --shell ${shell}' to fix`);
                    continue;
                }
                logger.success(`${shell}: completions installed and up to date`);
            }
            if (!anyIssue) logger.info("No completion issues found.");
        }));
}
