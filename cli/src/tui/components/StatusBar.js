// Bottom status bar: context-sensitive key hints, the current
// auto-dismissing toast (if any), and the current long-running
// operation with a spinner (installs stream their progress here and to
// the page that started them).
//
// Takes explicit props (not `useStore()` internally) for the same
// reason Nav/DashboardHeader do (see App.js's NavImpl comment):
// `React.memo` only skips a re-render triggered by the *parent*
// re-rendering with the same props - it has no effect at all on a
// component that calls `useContext` (via `useStore()`) directly, since
// a context update re-renders every consumer regardless of memo. This
// component used to do exactly that, silently making its own
// `React.memo` wrapper a no-op on every single dispatch in the app
// (busy/notify/log fire constantly during a live install on a
// completely different page) - v2.0.6 perf pass.
import React, { useEffect } from "react";
import { Box, Text } from "ink";
import { h, Spinner, KeyHints } from "./ui.js";

// How long a toast stays visible before it auto-dismisses. This is the
// one status-bar-row-sized "toast" surface the terminal has room for -
// toasts queue (oldest shown first) rather than stack, since there's
// only one line of real estate to show them in.
const TOAST_TTL_MS = 3000;

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
    [":", "palette"],
    ["R", "refresh"],
    ["?", "help"],
    ["q", "quit"]
];

function StatusBarImpl({ theme, page, busy, toast, dismissToast }) {
    // Each toast schedules its own dismissal the moment it becomes the
    // one shown; the cleanup clears that timer if the toast is replaced
    // or dismissed early, so a fast run of notifications never leaves
    // stray timers dismissing the wrong (later) toast.
    useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => dismissToast(toast.id), TOAST_TTL_MS);
        return () => clearTimeout(timer);
    }, [toast?.id, dismissToast]);

    const levelColor = toast
        ? (toast.level === "error" ? theme.error : toast.level === "warning" ? theme.warning : toast.level === "success" ? theme.success : theme.textMuted)
        : theme.textMuted;
    const levelIcon = toast
        ? (toast.level === "error" ? "✗" : toast.level === "warning" ? "⚠" : toast.level === "success" ? "✓" : "•")
        : "";

    return h(Box, { borderStyle: "round", borderColor: theme.border, paddingX: 1, justifyContent: "space-between" },
        h(Box, null,
            busy
                ? h(Text, null, h(Spinner, { theme }), h(Text, { color: theme.accent }, ` ${busy.label}`))
                : h(KeyHints, { hints: HINTS, theme })
        ),
        toast
            ? h(Text, { color: levelColor }, `${levelIcon} ${toast.message.slice(0, 58)}`)
            : h(Text, null,
                h(Text, { color: theme.accent, bold: true }, page),
                h(Text, { color: theme.textMuted }, ` · ${theme.name}`))
    );
}

export const StatusBar = React.memo(StatusBarImpl);
