// Command Palette (v2.0.1): Ctrl+P or ':' - fuzzy-jump to any page or
// run a global action, the same "type a few letters, Enter, go anywhere"
// contract VS Code's Ctrl+P / Cmd+Shift+P popularized. Deliberately
// distinct from the '/' global search overlay (SearchPage.js): the
// palette answers "where do I go / what do I trigger" (pages, actions),
// search answers "what am I looking for" (components, profiles, recipes,
// plugins, stacks, commands - actual content). Rendered by App.js's
// Shell in place of the active page's content, same full-swap pattern
// ModalHost/SearchPage already use (Ink has no floating overlay).
import { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { h, Panel, TextField, KeyHints, EmptyState } from "./ui.js";
import { useStore, PAGES } from "../store.js";
import { refreshAll } from "../data.js";
import { fuzzyFilter, splitByIndices } from "../fuzzy.js";

const GLOBAL_ACTIONS = [
    { id: "action:refresh", label: "Refresh caches", hint: "R" },
    { id: "action:help", label: "Help", hint: "?" },
    { id: "action:about", label: "About DevForgeKit", hint: "" },
    { id: "action:quit", label: "Quit DevForgeKit", hint: "q" }
];

function buildEntries() {
    return [
        ...PAGES.map((p) => ({ id: `page:${p.id}`, label: p.label, hint: `[${p.shortcut}]`, kind: "page", pageId: p.id })),
        ...GLOBAL_ACTIONS.map((a) => ({ ...a, kind: "action" }))
    ];
}

export function CommandPalette() {
    const { theme, dispatch, actions } = useStore();
    const { exit } = useApp();
    const [query, setQuery] = useState("");
    const [cursor, setCursor] = useState(0);

    const entries = buildEntries();
    const filtered = fuzzyFilter(query, entries, (e) => e.label).slice(0, 14);
    const clampedCursor = Math.min(cursor, Math.max(0, filtered.length - 1));

    function close() {
        dispatch({ type: "closePalette" });
    }

    function runEntry(entry) {
        if (!entry) return;
        if (entry.kind === "page") {
            actions.navigate(entry.pageId);
        } else if (entry.id === "action:refresh") {
            refreshAll();
            actions.notify("Caches refreshed - data reloads as pages re-open", "info");
        } else if (entry.id === "action:help") {
            actions.navigate("help");
        } else if (entry.id === "action:about") {
            actions.navigate("about");
        } else if (entry.id === "action:quit") {
            exit();
            return; // exiting - no need to also close the palette
        }
        close();
    }

    // Navigation/enter/escape only - TextField (below) owns character
    // input and already ignores these keys, same split every other
    // text-entry surface in this dashboard uses (ConfigPage, FilterBar).
    useInput((input, key) => {
        if (key.escape) { close(); return; }
        if (key.return) { runEntry(filtered[clampedCursor]?.item); return; }
        if (key.upArrow) { setCursor((c) => Math.max(0, c - 1)); return; }
        if (key.downArrow) { setCursor((c) => Math.min(filtered.length - 1, c + 1)); return; }
    }, { isActive: true });

    return h(Panel, { title: "Command Palette", theme, isActive: true, flexGrow: 1 },
        h(Box, null,
            h(Text, { color: theme.accent, bold: true }, "> "),
            h(TextField, {
                value: query,
                onChange: (q) => { setQuery(q); setCursor(0); },
                isActive: true,
                placeholder: "Type a page name or command...",
                theme
            })
        ),
        h(Box, { flexDirection: "column", marginTop: 1 },
            filtered.length === 0
                ? h(EmptyState, { title: "No matches.", theme })
                : filtered.map(({ item, indices }, i) => {
                    const selected = i === clampedCursor;
                    const bg = selected ? theme.selection : undefined;
                    const parts = splitByIndices(item.label, indices);
                    return h(Text, { key: item.id, backgroundColor: bg, wrap: "truncate-end" },
                        h(Text, { backgroundColor: bg, color: selected ? theme.selectionText : theme.textMuted },
                            `${selected ? "❯ " : "  "}${item.kind === "page" ? "▸ " : "⚡ "}`),
                        ...parts.map((p, pi) => h(Text, {
                            key: pi,
                            backgroundColor: bg,
                            color: selected ? theme.selectionText : (p.matched ? theme.searchHighlight : theme.text),
                            bold: p.matched && !selected
                        }, p.text)),
                        item.hint ? h(Text, { backgroundColor: bg, color: selected ? theme.selectionText : theme.accent }, `  ${item.hint}`) : null
                    );
                })
        ),
        h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints: [["↑↓", "move"], ["Enter", "go"], ["Esc", "close"]] }))
    );
}
