// Rendered instead of the whole dashboard when the terminal is below
// the current page's minimum size (see hooks/useTerminalSize.js's
// PAGE_MIN_SIZE). A professional TUI (k9s, lazygit, btop) never
// attempts to lay out its real UI below its supported floor - it shows
// a centered, bordered message with live dimensions and waits. Ink
// repaints this on every debounced resize, so growing past the minimum
// swaps straight back to the dashboard with no extra state to reset.
import { Box, Text } from "ink";
import { h } from "./ui.js";

export function TooSmallScreen({ columns, rows, minColumns, minRows, pageLabel, theme }) {
    const colPct = Math.min(100, Math.round((columns / minColumns) * 100));
    const rowPct = Math.min(100, Math.round((rows / minRows) * 100));
    const overallPct = Math.min(colPct, rowPct);
    const barWidth = 20;
    const filled = Math.round((overallPct / 100) * barWidth);
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(barWidth - filled);

    return h(Box, {
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flexGrow: 1,
        minHeight: Math.max(3, rows)
    },
        h(Box, {
            borderStyle: "round",
            borderColor: theme.border,
            flexDirection: "column",
            paddingX: 2,
            paddingY: 1
        },
            h(Text, { color: theme.accent, bold: true }, "  DevForgeKit"),
            h(Text, {}, " "),
            h(Text, { color: theme.error, bold: true }, "Terminal window is too small"),
            h(Text, {}, " "),
            h(Text, { color: theme.text }, `  Current:   ${columns} \u00d7 ${rows}`),
            h(Text, { color: theme.text }, `  Required:  ${minColumns} \u00d7 ${minRows}`),
            pageLabel ? h(Text, { color: theme.textMuted }, `  Page:      ${pageLabel}`) : null,
            h(Text, {}, " "),
            h(Text, { color: overallPct >= 100 ? theme.success : theme.warning }, `  ${bar} ${overallPct}%`),
            h(Text, {}, " "),
            h(Text, { color: theme.textMuted }, "  Expand the window to continue.")
        )
    );
}
