// Plugins TUI (v2.1.9): tabbed interface with Installed, Validation,
// Quality, and Details tabs. Installed shows discovered plugins with
// search/filter. Validation runs validatePluginDir() per plugin.
// Quality runs scorePlugin() per plugin. Details shows the highlighted
// plugin's full manifest and metadata.
import { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import path from "node:path";
import { h, Panel, SelectList, DetailPanel, useDetailWidth, ErrorState, statusColor, KeyHints, Badge, EmptyState } from "../components/ui.js";
import { useStore } from "../store.js";
import { plugins } from "../data.js";
import { runShellCommand } from "../../core/shell.js";
import { validatePluginDir, formatValidationResult } from "../../core/pluginValidation.js";
import { scorePlugin, formatQualityScore } from "../../core/pluginValidation.js";
import { diagnosePlugins, formatDiagnostics } from "../../core/pluginValidation.js";

const TABS = [
    { id: "installed", label: "Installed", key: "1" },
    { id: "validation", label: "Validation", key: "2" },
    { id: "quality", label: "Quality", key: "3" },
    { id: "details", label: "Details", key: "4" },
];

export function PluginsPage({ isActive }) {
    const { theme, state, actions, suspend } = useStore();
    const [tab, setTab] = useState("installed");
    const [highlighted, setHighlighted] = useState(null);
    const [filter, setFilter] = useState("");
    const detailW = useDetailWidth(46);

    const all = plugins();
    const filtered = useMemo(() => {
        if (!filter) return all;
        const q = filter.toLowerCase();
        return all.filter((p) =>
            p.name.toLowerCase().includes(q) ||
            (p.manifest?.description || "").toLowerCase().includes(q) ||
            (p.manifest?.capabilities || []).some((c) => c.includes(q))
        );
    }, [all, filter]);

    const current = highlighted && all.includes(highlighted) ? highlighted : filtered[0] || null;
    const commands = current?.valid ? (current.manifest.commands || []) : [];

    async function runFirstCommand() {
        if (!current?.valid || commands.length === 0) return;
        const hook = commands[0];
        actions.log(`plugin run ${current.name} ${hook.name}`);
        await suspend(async () => {
            console.log(`\nRunning plugin command: ${current.name} ${hook.name}\n`);
            const code = await runShellCommand(path.join(current.dir, hook.run), { timeoutMs: hook.timeoutMs || 30000 });
            console.log(code === 0 ? "\n✓ done" : `\n✗ exited ${code}`);
            actions.notify(`Plugin ${current.name} ${hook.name} ${code === 0 ? "succeeded" : `exited ${code}`}.`, code === 0 ? "success" : "error");
        });
    }

    useInput((input) => {
        if (input === "x") runFirstCommand();
        for (const t of TABS) {
            if (input === t.key) { setTab(t.id); setHighlighted(null); }
        }
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    const tabHints = TABS.map((t) => [t.key, t.label]);

    return h(Box, { flexGrow: 1, flexDirection: "column" },
        // Tab bar
        h(Box, { marginBottom: 1 },
            TABS.map((t) => h(Text, {
                key: t.id,
                color: tab === t.id ? theme.accent : theme.textMuted,
                backgroundColor: tab === t.id ? theme.selection : undefined,
            }, ` ${t.label} `))
        ),
        // Tab content
        tab === "installed" && h(InstalledTab, {
            all: filtered, isActive, theme, current, setHighlighted, actions, suspend, commands, runFirstCommand
        }),
        tab === "validation" && h(ValidationTab, {
            all: filtered, isActive, theme, current, setHighlighted
        }),
        tab === "quality" && h(QualityTab, {
            all: filtered, isActive, theme, current, setHighlighted
        }),
        tab === "details" && h(DetailsTab, {
            all: filtered, isActive, theme, current, setHighlighted, detailW
        }),
        // Footer hints
        h(KeyHints, { hints: [...tabHints, ["x", "run cmd"], ["q", "quit"]], theme })
    );
}

function InstalledTab({ all, isActive, theme, current, setHighlighted, commands }) {
    if (all.length === 0) {
        return h(Box, { flexGrow: 1 },
            h(Panel, { title: "Plugins (0 discovered)", theme, isActive, flexGrow: 1 },
                h(EmptyState, { title: "No plugins found.", hint: "devforgekit plugin create my-plugin", theme })));
    }
    return h(Box, { flexGrow: 1 },
        h(Panel, { title: `Plugins (${all.length} discovered)`, theme, isActive, flexGrow: 1 },
            h(SelectList, {
                items: all, isActive, height: 14, theme,
                onHighlight: setHighlighted,
                emptyText: "No plugins found - try: devforgekit plugin create my-plugin",
                renderItem: (p, selected) => h(Text, {
                    key: p.dir,
                    backgroundColor: selected && isActive ? theme.selection : undefined,
                    color: selected && isActive ? theme.selectionText : statusColor(p.valid ? "ok" : "error", theme),
                    wrap: "truncate-end"
                }, `${selected ? "❯ " : "  "}${p.valid ? "✓" : "✗"} ${p.name.padEnd(24).slice(0, 24)} ${p.valid ? (p.manifest.description || "").slice(0, 40) : (p.reason || "").slice(0, 40)}`)
            }),
            h(Box, { marginTop: 1 },
                h(Panel, { theme },
                    h(Text, { color: theme.textMuted, wrap: "wrap" },
                        "Marketplace: not built yet - plugin install takes a path/URL you already have. A hosted index is designed in PlatformArchitecture.md (design-only).")))
        ),
        h(DetailPanel, {
            title: current ? `Plugin: ${current.name}` : "Details",
            theme, width: 46,
            emptyText: "No plugin highlighted.",
            sections: current?.valid ? [{
                pairs: [
                    ["Version", current.manifest.version || "-"],
                    ["Engine", current.manifest.engine || "-"],
                    ["Capabilities", (current.manifest.capabilities || []).join(", ") || "none"],
                    ["Permissions", (current.manifest.permissions || []).join(", ") || "none"],
                    ["Commands", commands.map((c) => c.name).join(", ") || "none"],
                    ["Events", (current.manifest.events || []).map((e) => e.event).join(", ") || "none"],
                    ["Dependencies", (current.manifest.dependencies || []).join(", ") || "none"],
                    ["Location", current.dir.replace(process.env.HOME || "", "~")]
                ]
            }] : (current ? [] : undefined),
            body: current && !current.valid ? h(ErrorState, { message: `Invalid: ${current.reason}`, theme }) : undefined,
            hints: current?.valid && commands.length > 0 ? [["x", `run '${commands[0].name}'`]] : undefined,
        })
    );
}

function ValidationTab({ all, isActive, theme, current, setHighlighted }) {
    const results = useMemo(() => {
        return all.map((p) => {
            if (!p.valid) return { name: p.name, valid: false, score: 0, verdict: "FAIL", checks: [{ name: "manifest", status: "FAIL", detail: p.reason }] };
            return { name: p.name, ...validatePluginDir(p.dir) };
        });
    }, [all]);

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: `Validation (${results.length} plugins)`, theme, isActive, flexGrow: 1 },
            h(SelectList, {
                items: results, isActive, height: 16, theme,
                onHighlight: (r) => {
                    const p = all.find((pp) => pp.name === r?.name);
                    if (p) setHighlighted(p);
                },
                emptyText: "No plugins to validate.",
                renderItem: (r, selected) => h(Text, {
                    key: r.name,
                    backgroundColor: selected && isActive ? theme.selection : undefined,
                    color: selected && isActive ? theme.selectionText : statusColor(r.verdict === "PASS" ? "ok" : r.verdict === "WARNING" ? "warning" : "error", theme),
                    wrap: "truncate-end"
                }, `${selected ? "❯ " : "  "}${r.verdict === "PASS" ? "✓" : r.verdict === "WARNING" ? "⚠" : "✗"} ${r.name.padEnd(24).slice(0, 24)} ${r.score}% (${r.checks.length} checks)`)
            })
        ),
        h(DetailPanel, {
            title: current ? `Validation: ${current.name}` : "Validation Details",
            theme, width: 46,
            emptyText: "No plugin highlighted.",
            body: current ? h(Box, { flexDirection: "column" },
                ...formatValidationResult(results.find((r) => r.name === current.name) || results[0]).map((line) =>
                    h(Text, { key: line, color: theme.text, wrap: "truncate-end" }, line.slice(0, 46))
                )
            ) : undefined,
        })
    );
}

function QualityTab({ all, isActive, theme, current, setHighlighted }) {
    const results = useMemo(() => {
        return all.map((p) => {
            if (!p.valid) return { name: p.name, score: 0, verdict: "FAIL", categories: [] };
            return { name: p.name, ...scorePlugin(p.dir) };
        });
    }, [all]);

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: `Quality Scores (${results.length} plugins)`, theme, isActive, flexGrow: 1 },
            h(SelectList, {
                items: results, isActive, height: 16, theme,
                onHighlight: (r) => {
                    const p = all.find((pp) => pp.name === r?.name);
                    if (p) setHighlighted(p);
                },
                emptyText: "No plugins to score.",
                renderItem: (r, selected) => h(Text, {
                    key: r.name,
                    backgroundColor: selected && isActive ? theme.selection : undefined,
                    color: selected && isActive ? theme.selectionText : statusColor(r.verdict === "PASS" ? "ok" : r.verdict === "WARNING" ? "warning" : "error", theme),
                    wrap: "truncate-end"
                }, `${selected ? "❯ " : "  "}${r.score >= 80 ? "✓" : r.score >= 50 ? "⚠" : "✗"} ${r.name.padEnd(24).slice(0, 24)} ${r.score}% — ${r.verdict}`)
            })
        ),
        h(DetailPanel, {
            title: current ? `Quality: ${current.name}` : "Quality Details",
            theme, width: 46,
            emptyText: "No plugin highlighted.",
            body: current ? h(Box, { flexDirection: "column" },
                ...formatQualityScore(results.find((r) => r.name === current.name) || results[0]).map((line) =>
                    h(Text, { key: line, color: theme.text, wrap: "truncate-end" }, line.slice(0, 46))
                )
            ) : undefined,
        })
    );
}

function DetailsTab({ all, isActive, theme, current, setHighlighted, detailW }) {
    if (all.length === 0) {
        return h(Box, { flexGrow: 1 },
            h(Panel, { title: "Plugins (0)", theme, isActive, flexGrow: 1 },
                h(EmptyState, { title: "No plugins found.", hint: "devforgekit plugin create my-plugin", theme })));
    }
    return h(Box, { flexGrow: 1 },
        h(Panel, { title: `Plugins (${all.length})`, theme, isActive, flexGrow: 1 },
            h(SelectList, {
                items: all, isActive, height: 16, theme,
                onHighlight: setHighlighted,
                emptyText: "No plugins found.",
                renderItem: (p, selected) => h(Text, {
                    key: p.dir,
                    backgroundColor: selected && isActive ? theme.selection : undefined,
                    color: selected && isActive ? theme.selectionText : statusColor(p.valid ? "ok" : "error", theme),
                    wrap: "truncate-end"
                }, `${selected ? "❯ " : "  "}${p.valid ? "✓" : "✗"} ${p.name}`)
            })
        ),
        h(DetailPanel, {
            title: current ? `${current.name} — Details` : "Plugin Details",
            theme, width: detailW,
            emptyText: "No plugin highlighted.",
            sections: current?.valid ? [
                {
                    title: "Identity",
                    pairs: [
                        ["Name", current.manifest.name],
                        ["Version", current.manifest.version],
                        ["Description", current.manifest.description],
                        ["Author", current.manifest.author || "-"],
                        ["License", current.manifest.license || "-"],
                        ["Homepage", current.manifest.homepage || "-"],
                        ["Repository", current.manifest.repository || "-"],
                    ]
                },
                {
                    title: "Compatibility",
                    pairs: [
                        ["Engine", current.manifest.engine],
                        ["Platforms", (current.manifest.compatibility?.platforms || []).join(", ") || "any"],
                        ["Architectures", (current.manifest.compatibility?.architectures || []).join(", ") || "any"],
                    ]
                },
                {
                    title: "Extension Points",
                    pairs: [
                        ["Capabilities", (current.manifest.capabilities || []).join(", ") || "none"],
                        ["Permissions", (current.manifest.permissions || []).join(", ") || "none"],
                        ["Keywords", (current.manifest.keywords || []).join(", ") || "none"],
                    ]
                },
                {
                    title: "Commands & Events",
                    pairs: [
                        ["Commands", (current.manifest.commands || []).map((c) => `${c.name} (${c.run})`).join(", ") || "none"],
                        ["Events", (current.manifest.events || []).map((e) => `${e.event} (${e.run})`).join(", ") || "none"],
                        ["Dependencies", (current.manifest.dependencies || []).join(", ") || "none"],
                        ["Schema", `v${current.manifest.schemaVersion}`],
                        ["Location", current.dir.replace(process.env.HOME || "", "~")],
                    ]
                }
            ] : (current ? [] : undefined),
            body: current && !current.valid ? h(ErrorState, { message: `Invalid: ${current.reason}`, theme }) : undefined,
        })
    );
}
