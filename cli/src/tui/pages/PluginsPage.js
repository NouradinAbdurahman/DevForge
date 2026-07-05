// Plugins: everything discoverPlugins() reports (repo plugins/ + user
// ~/.devforgekit/plugins/), including invalid ones with their reason -
// plus a marketplace placeholder that is explicitly labeled as not
// built (the same honest stance `plugin search`/`publish` take in the
// CLI). Running a plugin command suspends the dashboard, since plugin
// scripts inherit stdio by design (they're user-authored, interactive
// output is allowed).
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import path from "node:path";
import { h, Panel, SelectList, KeyValue, KeyHints, useDetailWidth } from "../components/ui.js";
import { useStore } from "../store.js";
import { plugins } from "../data.js";
import { runShellCommand } from "../../core/shell.js";

export function PluginsPage({ isActive }) {
    const { theme, state, actions, suspend } = useStore();
    const [highlighted, setHighlighted] = useState(null);
    const detailW = useDetailWidth(46);

    const all = plugins();
    const current = highlighted && all.includes(highlighted) ? highlighted : all[0] || null;
    const commands = current?.valid ? (current.manifest.commands || []) : [];

    async function runFirstCommand() {
        if (!current?.valid || commands.length === 0) return;
        const hook = commands[0];
        actions.log(`plugin run ${current.name} ${hook.name}`);
        await suspend(async () => {
            console.log(`\nRunning plugin command: ${current.name} ${hook.name}\n`);
            const code = await runShellCommand(path.join(current.dir, hook.run), { timeoutMs: hook.timeoutMs || 30000 });
            console.log(code === 0 ? "\n✓ done" : `\n✗ exited ${code}`);
            actions.notify(`plugin ${current.name} ${hook.name} ${code === 0 ? "succeeded" : `exited ${code}`}`, code === 0 ? "success" : "error");
        });
    }

    useInput((input) => {
        if (input === "x") runFirstCommand();
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: `Plugins (${all.length} discovered)`, theme, isActive, flexGrow: 1 },
            h(SelectList, {
                items: all, isActive, height: 14, theme,
                onHighlight: setHighlighted,
                emptyText: "No plugins found - try: devforgekit plugin create my-plugin",
                renderItem: (p, selected) => h(Text, {
                    key: p.dir,
                    backgroundColor: selected && isActive ? theme.selection : undefined,
                    color: selected && isActive ? theme.selectionText : (p.valid ? theme.text : theme.error)
                }, `${selected ? "❯ " : "  "}${p.valid ? "✓" : "✗"} ${p.name.padEnd(24).slice(0, 24)} ${p.valid ? (p.manifest.description || "").slice(0, 40) : (p.reason || "").slice(0, 40)}`)
            }),
            h(Box, { marginTop: 1, borderStyle: "round", borderColor: theme.border, paddingX: 1 },
                h(Text, { color: theme.textMuted, wrap: "wrap" },
                    "Marketplace: not built yet - plugin install takes a path/URL you already have. A hosted index is designed in PlatformArchitecture.md (design-only)."))
        ),
        h(Panel, { title: current ? `Plugin: ${current.name}` : "Details", theme, width: detailW },
            current ? h(Box, { flexDirection: "column" },
                current.valid ? h(KeyValue, {
                    theme, labelWidth: 13,
                    pairs: [
                        ["Version", current.manifest.version || "-"],
                        ["Engine", current.manifest.engine || "-"],
                        ["Commands", commands.map((c) => c.name).join(", ") || "none"],
                        ["Events", (current.manifest.events || []).map((e) => e.event).join(", ") || "none"],
                        ["Dependencies", (current.manifest.dependencies || []).join(", ") || "none"],
                        ["Location", current.dir.replace(process.env.HOME || "", "~")]
                    ]
                }) : h(Text, { color: theme.error, wrap: "wrap" }, `Invalid: ${current.reason}`),
                commands.length > 0
                    ? h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints: [["x", `run '${commands[0].name}' (suspends dashboard)`]] }))
                    : null,
                h(Text, { color: theme.textMuted, wrap: "wrap" },
                    "\nEnable/disable/update/remove: manage the plugin directory itself (see docs - plugins are plain directories; there is no separate enabled/disabled state to toggle yet).")
            ) : h(Text, { color: theme.textMuted }, "No plugin highlighted.")
        )
    );
}
