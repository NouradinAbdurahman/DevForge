// Logs: the session's operation log (everything actions.log/notify
// recorded - installs, doctor runs, config changes...), filterable by
// level. This is a *session* log, honestly labeled as such: the
// platform has no persistent structured log file yet, and exporting
// writes the current session to ~/.devforgekit/logs/.
import { useState } from "react";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Box, Text, useInput } from "ink";
import { h, Panel, KeyHints, ScrollList, statusColor } from "../components/ui.js";
import { useStore } from "../store.js";
import { userStateDir } from "../../core/paths.js";

const LEVELS = ["all", "info", "success", "warning", "error"];

export function LogsPage({ isActive }) {
    const { theme, state, actions } = useStore();
    const [level, setLevel] = useState(0);

    const filter = LEVELS[level];
    const entries = state.logs.filter((e) => filter === "all" || e.level === filter);

    function exportLog() {
        const dir = path.join(userStateDir(), "logs");
        mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `tui-session-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
        writeFileSync(file, state.logs.map((e) =>
            `${e.time.toISOString()} [${e.level.toUpperCase()}] ${e.message}`).join("\n") + "\n");
        actions.notify(`Log exported to ${file.replace(process.env.HOME || "", "~")}`, "success");
    }

    useInput((input, key) => {
        if (key.leftArrow) setLevel((l) => (l + LEVELS.length - 1) % LEVELS.length);
        else if (key.rightArrow) setLevel((l) => (l + 1) % LEVELS.length);
        else if (input === "e") exportLog();
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    return h(Panel, { title: `Session log (${entries.length} entries) · ‹ ${filter} ›`, theme, isActive, flexGrow: 1 },
        h(ScrollList, {
            items: entries,
            isActive: Boolean(isActive) && !state.searchOpen,
            height: 14,
            theme,
            startAtEnd: true,
            emptyText: "Nothing logged yet this session.",
            // Nested <Text> spans (not a <Box> of sibling <Text>
            // elements) - Ink treats nested Text as one reflowable
            // text run; a Box of siblings instead gives each child
            // its own flex-shrink share of the width, truncating
            // mid-word the moment a row doesn't fit.
            renderItem: (e) => h(Text, { key: e.time.getTime() + "-" + e.message, wrap: "truncate-end" },
                h(Text, { color: theme.textMuted }, `${e.time.toTimeString().slice(0, 8)} `),
                h(Text, { color: statusColor(e.level, theme) }, `${e.level.padEnd(7)} `),
                h(Text, { color: theme.text }, e.message)
            )
        }),
        h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints: [["←/→", "filter level"], ["↑↓/jk", "scroll"], ["e", "export to ~/.devforgekit/logs/"]] }))
    );
}
