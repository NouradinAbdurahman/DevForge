// Global search (the `/` overlay): one query across components (via the
// registry's own ranked searchPackages), profiles, recipes, plugins,
// and generator stacks - results grouped by type, Enter jumps to the
// owning page.
import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, SelectList, TextField, KeyHints } from "../components/ui.js";
import { useStore } from "../store.js";
import { registrySnapshot, plugins, generators, search } from "../data.js";
import { searchCommandTree, getCommandTree } from "../../core/commandTree.js";

// splitMatches(text, query) -> [{ text, matched }] - breaks `text` into
// matched/unmatched runs against `query` (case-insensitive), so the
// matched run can render in theme.searchHighlight while the rest stays
// normal - "Search Results: Matched text: Bright Cyan" per the theme
// redesign notes in docs/TUI.md.
function splitMatches(text, query) {
    if (!query) return [{ text, matched: false }];
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const parts = [];
    let i = 0;
    while (i < text.length) {
        const idx = lower.indexOf(q, i);
        if (idx === -1) {
            parts.push({ text: text.slice(i), matched: false });
            break;
        }
        if (idx > i) parts.push({ text: text.slice(i, idx), matched: false });
        parts.push({ text: text.slice(idx, idx + q.length), matched: true });
        i = idx + q.length;
    }
    return parts;
}

async function collectResults(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const { profiles, recipes, collections } = registrySnapshot();
    const results = [];

    for (const { pkg, matchedOn } of search(q).slice(0, 10)) {
        results.push({ type: "component", name: pkg.name, detail: `${pkg.category} · matched ${matchedOn}`, page: "components" });
    }
    const nameMatch = (item) => item.name.toLowerCase().includes(q)
        || (item.description || "").toLowerCase().includes(q);
    for (const p of profiles.filter(nameMatch).slice(0, 5)) {
        results.push({ type: "profile", name: p.name, detail: (p.description || "").slice(0, 40), page: "profiles" });
    }
    for (const r of recipes.filter(nameMatch).slice(0, 5)) {
        results.push({ type: "recipe", name: r.name, detail: (r.description || "").slice(0, 40), page: "recipes" });
    }
    for (const c of collections.filter(nameMatch).slice(0, 5)) {
        results.push({ type: "collection", name: c.name, detail: `${c.components.length} components`, page: "components" });
    }
    for (const p of plugins().filter((p) => p.valid && nameMatch({ name: p.name, description: p.manifest.description })).slice(0, 3)) {
        results.push({ type: "plugin", name: p.name, detail: (p.manifest.description || "").slice(0, 40), page: "plugins" });
    }
    for (const g of generators().filter((g) => g.id.includes(q) || g.description.toLowerCase().includes(q)).slice(0, 5)) {
        results.push({ type: "stack", name: g.id, detail: g.description.slice(0, 40), page: "generator" });
    }

    // Search commands from the Commander tree
    try {
        // Build the tree lazily - createProgram is imported dynamically
        // in CommandsPage.js; here we search a cached tree if available
        const { createProgram } = await import("../../index.js");
        const tree = getCommandTree(createProgram());
        const cmdResults = searchCommandTree(tree, query).slice(0, 5);
        for (const cmd of cmdResults) {
            results.push({ type: "command", name: cmd.name, detail: cmd.description.slice(0, 40), page: "commands" });
        }
    } catch {
        // Command tree not available yet
    }

    return results;
}

export function SearchPage() {
    const { theme, state, dispatch, actions } = useStore();
    const [browsing, setBrowsing] = useState(false);
    const [results, setResults] = useState([]);

    useEffect(() => {
        let cancelled = false;
        collectResults(state.searchQuery).then((r) => {
            if (!cancelled) setResults(r);
        });
        return () => { cancelled = true; };
    }, [state.searchQuery]);

    useInput((input, key) => {
        if (key.escape) {
            dispatch({ type: "closeSearch" });
        } else if (key.downArrow || key.upArrow || key.tab) {
            setBrowsing(true);
            dispatch({ type: "setTyping", typing: false });
        }
    });

    return h(Panel, { title: "Search everything", theme, flexGrow: 1 },
        h(Box, null,
            h(Text, { color: theme.accent, bold: true }, "/ "),
            h(TextField, {
                value: state.searchQuery,
                onChange: (q) => { setBrowsing(false); dispatch({ type: "setSearchQuery", query: q }); dispatch({ type: "setTyping", typing: true }); },
                isActive: !browsing,
                placeholder: "type to search components, profiles, recipes, plugins, stacks...",
                theme
            })
        ),
        h(SelectList, {
            items: results,
            isActive: browsing,
            height: 14,
            theme,
            emptyText: state.searchQuery ? "No matches." : "Start typing - results appear instantly. ↓ to browse them.",
            onSelect: (r) => {
                dispatch({ type: "closeSearch" });
                actions.navigate(r.page);
                actions.log(`search: opened ${r.type} '${r.name}'`);
            },
            renderItem: (r, selected) => {
                const isSelectedRow = selected && browsing;
                const prefix = `${selected ? "❯ " : "  "}${r.type.padEnd(11)} `;
                const paddedName = r.name.padEnd(24).slice(0, 24);
                // Never color-highlight matched text on top of the
                // selection background (the theme redesign's contrast
                // rule: no cyan-on-blue) - a selected row is pure
                // selectionText throughout, same as every other list.
                const nameParts = isSelectedRow
                    ? [{ text: paddedName, matched: false }]
                    : splitMatches(paddedName, state.searchQuery.trim());
                // Nested <Text> spans (not a <Box> of sibling <Text>
                // elements) - Ink treats nested Text as one reflowable
                // text run; a Box of siblings instead gives each child
                // its own flex-shrink share of the width, truncating
                // mid-word the moment the row doesn't fit.
                return h(Text, { key: r.type + r.name },
                    h(Text, { backgroundColor: isSelectedRow ? theme.selection : undefined, color: isSelectedRow ? theme.selectionText : theme.text }, prefix),
                    ...nameParts.map((p, i) => h(Text, {
                        key: i,
                        backgroundColor: isSelectedRow ? theme.selection : undefined,
                        color: isSelectedRow ? theme.selectionText : (p.matched ? theme.searchHighlight : theme.text),
                        bold: p.matched && !isSelectedRow
                    }, p.text)),
                    h(Text, { backgroundColor: isSelectedRow ? theme.selection : undefined, color: isSelectedRow ? theme.selectionText : theme.text }, ` ${r.detail}`)
                );
            }
        }),
        h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints: [["↓", "browse results"], ["Enter", "open"], ["Esc", "close"]] }))
    );
}
