// Bottom status bar: context-sensitive key hints, the latest
// notification, and the current long-running operation with a spinner
// (installs stream their progress here and to the page that started
// them).
import React from "react";
import { Box, Text } from "ink";
import { h, Spinner, KeyHints } from "./ui.js";
import { useStore } from "../store.js";

// Each hint is [key, description] - see ui.js's KeyHints for the
// shared rendering (bold accent key + muted description, dim " · "
// between hints). "Esc back" (closes search, wizard steps, text
// fields, and returns content focus to the menu - see HelpPage/
// docs/TUI.md for the full explanation) was missing entirely before -
// the only global key with no visible hint anywhere on screen.
const HINTS = [
    ["Tab", "focus"],
    ["↑↓/jk", "move"],
    ["Enter", "open"],
    ["Esc", "back"],
    ["/", "search"],
    ["R", "refresh"],
    ["?", "help"],
    ["q", "quit"]
];

function StatusBarImpl() {
    const { state, theme } = useStore();
    const latest = state.notifications[0];
    const levelColor = latest
        ? (latest.level === "error" ? theme.error : latest.level === "warning" ? theme.warning : latest.level === "success" ? theme.success : theme.textMuted)
        : theme.textMuted;

    return h(Box, { borderStyle: "round", borderColor: theme.border, paddingX: 1, justifyContent: "space-between" },
        h(Box, null,
            state.busy
                ? h(Text, null, h(Spinner, { theme }), h(Text, { color: theme.accent }, ` ${state.busy.label}`))
                : h(KeyHints, { hints: HINTS, theme })
        ),
        latest
            ? h(Text, { color: levelColor }, latest.message.slice(0, 60))
            : h(Text, null,
                h(Text, { color: theme.accent, bold: true }, state.page),
                h(Text, { color: theme.textMuted }, ` · ${theme.name}`))
    );
}

export const StatusBar = React.memo(StatusBarImpl);
