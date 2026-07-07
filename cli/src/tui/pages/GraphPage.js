// Environment Graph (v2.1.4 - Environment Graph Excellence): browse the
// whole modeled ecosystem (packages, generators, compatibility rules,
// profiles/recipes/collections, workspaces, plugins, history) as one
// searchable list with a detail panel on the highlighted node - real
// dependencies/dependents/quality data from core/devGraph.js, never
// re-derived here (no business logic in the TUI, per this app's own
// convention). The graph itself can take ~15-20s to build cold (see
// devGraph.js's own doc comment); graphSnapshot() sits behind a
// 30-minute on-disk cache so that's a rare wait, not a per-visit one.
import { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, SelectList, KeyValue, KeyHints, DetailPanel, LoadingState, EmptyState, useDetailWidth, useFilterField, FilterBar } from "../components/ui.js";
import { useStore } from "../store.js";
import { graphSnapshot } from "../data.js";
import { analyzeImpact, explainNode, buildGraphCached } from "../../core/devGraph.js";

export function GraphPage({ isActive }) {
    const { theme, state, dispatch, actions, suspend } = useStore();
    const { query: filterText, setQuery: setFilterText, isOpen: typingFilter } = useFilterField({
        isActive: Boolean(isActive) && !state.searchOpen,
        onTypingChange: (typing) => dispatch({ type: "setTyping", typing })
    });
    const [graph, setGraph] = useState(null);
    const [loading, setLoading] = useState(false);
    const [highlighted, setHighlighted] = useState(null);
    const detailW = useDetailWidth(46);
    // mountedRef: the graph build is a real ~15-20s cold scan (see
    // devGraph.js) - if this page unmounts (navigate away) before it
    // resolves, the promise itself keeps running (nothing cancels a
    // spawned shell probe mid-flight), but nothing here should act on it
    // once it lands - no state update on an unmounted component, and no
    // stale actions.log()/notify() dispatch landing well after the fact.
    // useRef (not a plain object literal) so every render - and every
    // later load({refresh:true}) call from the 'F' key - shares the same
    // instance the mount effect's cleanup actually flips.
    const mountedRef = useRef(true);

    async function load({ refresh = false } = {}) {
        if (loading) return;
        setLoading(true);
        actions.log(refresh ? "environment graph rebuild started" : "environment graph load started");
        try {
            const g = refresh ? await buildGraphCached({ refresh: true }) : await graphSnapshot();
            if (mountedRef.current) setGraph(g);
        } catch (err) {
            if (mountedRef.current) actions.notify(`Graph build failed: ${err.message}`, "error");
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }

    useEffect(() => {
        mountedRef.current = true;
        load();
        return () => { mountedRef.current = false; };
    }, []);

    async function explainHighlighted() {
        if (!graph || !highlighted) return;
        await suspend(async () => {
            console.log(`\nAsking AI to explain '${highlighted.name}'...\n`);
            try {
                const result = await explainNode(graph, highlighted.name);
                if (!result.ok) {
                    console.error(`✗ ${result.error}`);
                } else {
                    console.log(result.explanation);
                }
            } catch (err) {
                console.error(`✗ ${err.message}`);
            }
        });
    }

    useInput((input) => {
        if (typingFilter) return;
        if (input === "F") load({ refresh: true });
        else if (input === "x") explainHighlighted();
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    const q = filterText.trim().toLowerCase();
    const allNodes = graph?.nodes || [];
    const nodes = q
        ? allNodes.filter((n) =>
            n.name.toLowerCase().includes(q) ||
            n.type.toLowerCase().includes(q) ||
            (n.properties?.category || "").toLowerCase().includes(q))
        : allNodes;

    const current = highlighted && nodes.includes(highlighted) ? highlighted : nodes[0] || null;
    const impact = current && graph ? (() => { try { return analyzeImpact(graph, current.name); } catch { return null; } })() : null;

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: graph ? `Environment Graph (${allNodes.length} nodes)` : "Environment Graph", theme, isActive, flexGrow: 1 },
            !graph && !loading ? h(Box, { flexDirection: "column" },
                h(Text, { color: theme.text }, "The whole modeled ecosystem - packages, generators, compatibility rules, profiles, recipes, workspaces, plugins."),
                h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints: [["F", "build"]] }))
            ) : null,
            loading ? h(LoadingState, { label: "building graph (can take up to ~20s cold)...", theme }) : null,
            graph && !loading ? h(Box, { flexDirection: "column" },
                typingFilter
                    ? h(FilterBar, { query: filterText, onChange: setFilterText, isOpen: typingFilter, isActive: Boolean(isActive) && typingFilter, theme })
                    : h(Text, { color: theme.textMuted }, `/ to filter${filterText ? `: "${filterText}"` : ""} · ${graph.stats.installedCount} installed · ${graph.stats.orphanCount} orphans · ${graph.stats.conflictCount} conflicts · ${graph.stats.cycleCount} cycles`),
                h(SelectList, {
                    items: nodes, isActive: isActive && !typingFilter, height: 14, theme,
                    emptyText: filterText ? `No nodes match "${filterText}".` : "No nodes in the graph.",
                    onHighlight: setHighlighted,
                    renderItem: (node, selected) => h(Text, {
                        key: node.id,
                        backgroundColor: selected && isActive ? theme.selection : undefined,
                        color: selected && isActive ? theme.selectionText : node.properties?.installed ? theme.success : theme.text,
                        wrap: "truncate-end"
                    }, `${selected ? "❯ " : "  "}${node.properties?.installed ? "✓" : " "} ${node.name.padEnd(24)} ${node.type}`)
                })
            ) : null
        ),
        h(DetailPanel, {
            title: current ? current.name : "Node", theme, width: detailW,
            // DetailPanel uses `body` OR `sections`, never both (body
            // wins silently) - so the KeyValue block and the dependents
            // list are composed together into one `body` here rather
            // than split across both props.
            body: current ? h(Box, { flexDirection: "column" },
                h(KeyValue, {
                    theme, labelWidth: 12,
                    pairs: [
                        ["Type", current.type, theme.accent],
                        ["Category", current.properties?.category || "—", theme.text],
                        ["Installed", current.properties?.installed ? "yes" : current.properties?.installed === false ? "no" : "—", current.properties?.installed ? theme.success : theme.textMuted],
                        ["Quality", current.properties?.qualityScore != null ? `${current.properties.qualityScore}%` : "—", theme.text],
                        ["Platforms", (current.properties?.platforms || []).join(", ") || "—", theme.textMuted],
                        ["Impact", impact ? `${impact.totalAffected} node(s)` : "—", theme.text]
                    ]
                }),
                impact ? h(Box, { flexDirection: "column", marginTop: 1 },
                    impact.directDependents.length > 0 ? h(Box, { flexDirection: "column" },
                        h(Text, { color: theme.textMuted }, "Depended on by:"),
                        ...impact.directDependents.slice(0, 5).map((name) => h(Text, { key: name, color: theme.text }, `  - ${name}`))
                    ) : h(Text, { color: theme.textMuted }, "Nothing depends on this.")
                ) : null
            ) : h(EmptyState, { title: "Build the graph first (F).", theme }),
            hints: [["F", "rebuild"], ["x", "AI explain"], ["/", "filter"]]
        })
    );
}
