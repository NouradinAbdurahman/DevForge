// Thin wrapper over cli-progress for a consistent bar style across every
// command that installs/downloads more than one thing in a loop.
import cliProgress from "cli-progress";
import chalk from "chalk";

export function createProgressBar(total, label = "Progress") {
    const bar = new cliProgress.SingleBar({
        format: `${chalk.cyan(label)} |${chalk.cyan("{bar}")}| {value}/{total} {item}`,
        hideCursor: true,
        clearOnComplete: false
    });
    bar.start(total, 0, { item: "" });
    return bar;
}
