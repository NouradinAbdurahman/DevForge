// Thin wrapper over cli-progress for a consistent bar style across every
// command that installs/downloads more than one thing in a loop. Same
// bar characters (█/░) as lib/ui.js's healthBar() - one visual language
// for "percent done" everywhere, whether it's a live install or a
// static health score.
import cliProgress from "cli-progress";
import chalk from "chalk";

export function createProgressBar(total, label = "Installing") {
    const bar = new cliProgress.SingleBar({
        format: `${chalk.cyan(label)}  ${chalk.cyan("{bar}")}  {percentage}%  Package {value}/{total}  {item}{durationSuffix}`,
        barCompleteChar: "█",
        barIncompleteChar: "░",
        hideCursor: true,
        clearOnComplete: false
    });
    bar.start(total, 0, { item: "", durationSuffix: "" });
    return bar;
}

// updateProgressBar(bar, value, { item }) - ETA only shows once
// cli-progress has enough samples to estimate one. `bar.eta` is the
// library's internal ETA calculator OBJECT, not a number - the real
// accessor is `bar.eta.getTime()`, which returns either a positive
// number of seconds, or the strings 'NULL'/'INF' for "can't estimate
// yet"/"would take too long to be meaningful" (see
// node_modules/cli-progress/lib/eta.js). Showing a bogus "ETA 0s" (or
// "ETA NULLs", if the string were coerced blindly) on step one would be
// worse than no ETA yet.
export function updateProgressBar(bar, value, { item = "" } = {}) {
    const etaSeconds = bar.eta.getTime();
    const durationSuffix = typeof etaSeconds === "number" && etaSeconds > 0 ? `  ETA ${formatEta(etaSeconds)}` : "";
    bar.update(value, { item, durationSuffix });
}

function formatEta(seconds) {
    const s = Math.round(seconds);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
}
