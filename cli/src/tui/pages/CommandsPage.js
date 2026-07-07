// Commands: the interactive command explorer (v1.3.x). A live, searchable
// browser of every CLI command - built dynamically from the Commander.js
// program tree, not a hardcoded list. Categories on the left, details on
// the right. Press / to search, c to copy, e to cycle examples, r to run.
import { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { execSync } from "node:child_process";
import { h, Panel, SelectList, KeyHints, useDetailWidth, useFilterField, FilterBar, EmptyState } from "../components/ui.js";
import { useStore } from "../store.js";
import { getCommandTree, searchCommandTree, findRelatedCommands } from "../../core/commandTree.js";

// Build the tree once (module-level cache). We use a dynamic import to
// avoid a circular dependency: index.js -> commands/dashboard.js -> tui/
// -> CommandsPage.js -> index.js. Since dashboard.js imports the TUI
// lazily (inside its action), the cycle is never hit at module load time,
// but the dynamic import makes it explicit and safe.
let _tree = null;
let _treePromise = null;

function getTreeSync() {
    if (_tree) return _tree;
    return { commands: [], categories: {}, total: 0 };
}

async function loadTree() {
    if (_tree) return _tree;
    if (_treePromise) return _treePromise;
    _treePromise = (async () => {
        try {
            const { createProgram } = await import("../../index.js");
            _tree = getCommandTree(createProgram());
        } catch {
            _tree = { commands: [], categories: {}, total: 0 };
        }
        return _tree;
    })();
    return _treePromise;
}

// Kick off the load immediately at module eval time so the tree is ready
// by the time the user navigates to the page.
loadTree();

export function CommandsPage({ isActive }) {
    const { theme, state, dispatch, actions, suspend } = useStore();
    const { query: searchText, setQuery: setSearchText, isOpen: typingSearch } = useFilterField({
        isActive: Boolean(isActive) && !state.searchOpen,
        onTypingChange: (typing) => dispatch({ type: "setTyping", typing })
    });
    const [selectedCategory, setSelectedCategory] = useState(null);
    const [highlighted, setHighlighted] = useState(null);
    const [exampleIdx, setExampleIdx] = useState(0);
    const [copied, setCopied] = useState(false);
    const [tree, setTree] = useState(() => getTreeSync());
    const detailW = useDetailWidth(50);

    // Poll for tree load (the dynamic import resolves async)
    useMemo(() => {
        if (tree.total === 0) {
            loadTree().then((t) => setTree(t));
        }
    }, [tree]);

    const categories = useMemo(() => Object.keys(tree.categories || {}).sort(), [tree]);

    // Filter commands by search and/or category
    const filteredCommands = useMemo(() => {
        let cmds = tree.commands || [];
        if (selectedCategory) {
            cmds = cmds.filter((c) => c.category === selectedCategory);
        }
        if (searchText.trim()) {
            cmds = searchCommandTree({ commands: cmds, categories: tree.categories }, searchText);
        }
        return cmds;
    }, [tree, searchText, selectedCategory]);

    const current = highlighted && filteredCommands.includes(highlighted)
        ? highlighted
        : filteredCommands[0] || null;

    // Reset example index when command changes
    const currentExamples = current?.examples || [];
    const safeExampleIdx = currentExamples.length > 0 ? exampleIdx % currentExamples.length : 0;

    useInput((input) => {
        if (typingSearch) return;

        if (input === "c" && current) {
            try {
                execSync("pbcopy", { input: current.fullName });
                setCopied(true);
                actions.notify(`Copied: ${current.fullName}`, "success");
                setTimeout(() => setCopied(false), 1500);
            } catch {
                actions.notify("Copy failed (pbcopy not available)", "error");
            }
        } else if (input === "e" && current && currentExamples.length > 0) {
            setExampleIdx((i) => (i + 1) % currentExamples.length);
        } else if (input === "r" && current) {
            const cmdStr = currentExamples.length > 0
                ? currentExamples[safeExampleIdx]
                : current.fullName;
            actions.log(`Running: ${cmdStr}`);
            suspend(async () => {
                const { execSync: run } = await import("node:child_process");
                try {
                    run(cmdStr, { stdio: "inherit" });
                } catch (err) {
                    console.error(err.message);
                }
            });
        }
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    const categoryItems = [
        { id: null, label: "All" },
        ...categories.map((cat) => ({ id: cat, label: cat }))
    ];

    const relatedCommands = current ? findRelatedCommands(tree, current) : [];

    return h(Box, { flexGrow: 1 },
        // Left: Categories
        h(Panel, {
            title: "Categories",
            theme,
            isActive: isActive && !typingSearch && !selectedCategory,
            width: 18,
            flexShrink: 0
        },
            h(SelectList, {
                items: categoryItems,
                isActive: isActive && !typingSearch,
                height: 16,
                theme,
                onSelect: (item) => {
                    setSelectedCategory(item.id);
                    setHighlighted(null);
                },
                onHighlight: (item) => {
                    if (item.id !== selectedCategory) {
                        setSelectedCategory(item.id);
                        setHighlighted(null);
                    }
                },
                renderItem: (item, selected) => h(Text, {
                    key: item.id || "all",
                    backgroundColor: selected && isActive ? theme.selection : undefined,
                    color: selected && isActive ? theme.selectionText : (item.id === selectedCategory ? theme.accent : theme.text)
                }, `${selected ? "❯" : " "} ${item.id ? "▶" : " "} ${item.label}`)
            })
        ),

        // Middle: Command list
        h(Panel, {
            title: `Commands (${filteredCommands.length})`,
            theme,
            isActive: isActive && !typingSearch,
            flexGrow: 1
        },
            typingSearch
                ? h(FilterBar, { query: searchText, onChange: setSearchText, isOpen: typingSearch, isActive: Boolean(isActive) && typingSearch, theme })
                : h(Text, { color: theme.textMuted }, `/ to filter${searchText ? `: "${searchText}"` : ""}`),
            h(SelectList, {
                items: filteredCommands,
                isActive: isActive && !typingSearch,
                height: 14,
                theme,
                emptyText: searchText ? `No commands match "${searchText}".` : "No commands in this category.",
                onHighlight: (cmd) => {
                    setHighlighted(cmd);
                    setExampleIdx(0);
                },
                renderItem: (cmd, selected) => h(Text, {
                    key: cmd.name,
                    backgroundColor: selected && isActive ? theme.selection : undefined,
                    color: selected && isActive ? theme.selectionText : theme.text,
                    wrap: "truncate-end"
                },
                    `${selected ? "❯" : " "} ${cmd.name.padEnd(18).slice(0, 18)}`,
                    h(Text, {
                        color: selected && isActive ? theme.selectionText : theme.textMuted
                    }, ` ${cmd.description.slice(0, 36)}`),
                    cmd.aliases.length > 0
                        ? h(Text, { color: selected && isActive ? theme.selectionText : theme.accent }, ` (${cmd.aliases.join(", ")})`)
                        : null
                )
            })
        ),

        // Right: Details
        h(Panel, {
            title: current ? current.fullName : "Details",
            theme,
            width: detailW
        },
            current ? h(Box, { flexDirection: "column" },
                h(Text, { color: theme.accent, bold: true }, current.description || "No description"),

                current.aliases.length > 0
                    ? h(Box, { marginTop: 1 },
                        h(Text, { color: theme.textMuted }, "Aliases: "),
                        h(Text, { color: theme.accent }, current.aliases.join(", "))
                    )
                    : null,

                h(Box, { marginTop: 1 },
                    h(Text, { color: theme.textMuted }, "Usage: "),
                    h(Text, { color: theme.text }, current.usage)
                ),

                current.syntax
                    ? h(Box, { marginTop: 1 },
                        h(Text, { color: theme.textMuted }, "Syntax: "),
                        h(Text, { color: theme.text, wrap: "wrap" }, current.syntax)
                    )
                    : null,

                current.options.length > 0
                    ? h(Box, { flexDirection: "column", marginTop: 1 },
                        h(Text, { color: theme.textMuted, bold: true }, "Options"),
                        ...current.options.map((opt, i) => h(Text, {
                            key: i,
                            color: theme.text,
                            wrap: "wrap"
                        },
                            h(Text, { color: theme.accent }, `  ${opt.flags.padEnd(20).slice(0, 20)}`),
                            h(Text, { color: theme.textMuted }, ` ${opt.description}`)
                        ))
                    )
                    : null,

                currentExamples.length > 0
                    ? h(Box, { flexDirection: "column", marginTop: 1 },
                        h(Text, { color: theme.textMuted, bold: true }, `Examples (${safeExampleIdx + 1}/${currentExamples.length})`),
                        h(Text, { color: theme.text, wrap: "wrap" }, `  $ ${currentExamples[safeExampleIdx]}`),
                        currentExamples.length > 1
                            ? h(Text, { color: theme.textMuted }, "  (press e to cycle)")
                            : null
                    )
                    : null,

                current.subcommands.length > 0
                    ? h(Box, { flexDirection: "column", marginTop: 1 },
                        h(Text, { color: theme.textMuted, bold: true }, "Subcommands"),
                        ...current.subcommands.map((sub, i) => h(Text, {
                            key: i,
                            color: theme.text,
                            wrap: "wrap"
                        },
                            h(Text, { color: theme.accent }, `  ${sub.name.padEnd(14).slice(0, 14)}`),
                            h(Text, { color: theme.textMuted }, ` ${sub.description.slice(0, 30)}`)
                        ))
                    )
                    : null,

                relatedCommands.length > 0
                    ? h(Box, { flexDirection: "column", marginTop: 1 },
                        h(Text, { color: theme.textMuted, bold: true }, "Related"),
                        ...relatedCommands.map((rel, i) => h(Text, {
                            key: i,
                            color: theme.text
                        }, `  ${rel.name} - ${rel.description.slice(0, 28)}`))
                    )
                    : null,

                current.documentation
                    ? h(Box, { marginTop: 1 },
                        h(Text, { color: theme.textMuted }, "Docs: "),
                        h(Text, { color: theme.accent }, `docs/${current.documentation}`)
                    )
                    : null,

                copied
                    ? h(Text, { color: theme.success, bold: true }, "\n✓ Copied to clipboard!")
                    : null,

                h(Box, { marginTop: 1 },
                    h(KeyHints, {
                        theme,
                        hints: [
                            ["/", "filter"],
                            ["c", "copy"],
                            ["e", "examples"],
                            ["r", "run"]
                        ]
                    })
                )
            ) : h(EmptyState, { title: "No command highlighted.", theme })
        )
    );
}
