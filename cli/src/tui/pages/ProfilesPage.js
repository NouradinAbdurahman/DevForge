// Profiles: browse all 50 environment profiles (repo + user roots, the
// same loadProfiles the CLI uses), inspect the resolved component list,
// and install one with live output - identical semantics to
// `devforgekit profile install <name>`.
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, SelectList, KeyValue, KeyHints, ProgressBar, useDetailWidth } from "../components/ui.js";
import { useStore } from "../store.js";
import { registrySnapshot } from "../data.js";
import { expandProfile } from "../../core/registry.js";
import { installPlan } from "../../core/installer.js";
import { setConfigValue } from "../../core/config.js";

export function ProfilesPage({ isActive }) {
    const { theme, state, actions } = useStore();
    const [highlighted, setHighlighted] = useState(null);
    const [running, setRunning] = useState(null);
    const detailW = useDetailWidth(48);

    const { profiles } = registrySnapshot();
    const current = highlighted && profiles.includes(highlighted) ? highlighted : profiles[0] || null;

    let expanded = [];
    let expandError = null;
    if (current) {
        try {
            expanded = expandProfile(current);
        } catch (err) {
            expandError = err.message;
        }
    }

    async function installProfile(profile) {
        if (!profile || running) return;
        const names = expandProfile(profile);
        const label = `profile install ${profile.name} (${names.length} components)`;
        setRunning({ step: 0, total: names.length, name: profile.name, lines: [] });
        actions.setBusy({ label });
        actions.log(`${label} started`);
        try {
            const { results } = await installPlan(names, {
                onStep: (pkg, index, total) => setRunning((r) => r && ({ ...r, step: index + 1, total, stepName: pkg.name })),
                onOutput: (text) => setRunning((r) => r && ({ ...r, lines: [...r.lines, ...text.split("\n").filter(Boolean)].slice(-6) }))
            });
            const failed = results.filter((r) => r.status === "failed").length;
            actions.notify(failed === 0
                ? `Profile '${profile.name}' installed (${results.length} components)`
                : `Profile '${profile.name}': ${failed} component(s) failed`, failed === 0 ? "success" : "error");
        } catch (err) {
            actions.notify(`Profile install failed: ${err.message}`, "error");
        } finally {
            setRunning(null);
            actions.setBusy(null);
        }
    }

    useInput((input) => {
        if (input === "a") installProfile(current);
        else if (input === "s" && current) {
            setConfigValue("defaultProfile", current.name);
            actions.notify(`Default profile set to '${current.name}'`, "success");
        }
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: `Profiles (${profiles.length})`, theme, isActive, flexGrow: 1 },
            h(SelectList, {
                // Items are now 2 rows tall (name + description), so
                // showing 8 at a time keeps the same ~16-row visual
                // footprint the old single-line list used; SelectList's
                // own scroll window handles the rest of the 50 profiles.
                items: profiles, isActive, height: 8, theme,
                onHighlight: setHighlighted,
                // Two-line card (bold name, then description indented
                // underneath) instead of cramming both onto one line -
                // see RecipesPage.js for the same treatment. Nested
                // <Text> per line, not a <Box> of sibling <Text>
                // elements, so a line truncates as a whole rather than
                // mid-word.
                renderItem: (p, selected) => {
                    const rowSelected = selected && isActive;
                    const bg = rowSelected ? theme.selection : undefined;
                    const nameColor = rowSelected ? theme.selectionText : theme.accent;
                    const descColor = rowSelected ? theme.selectionText : theme.textMuted;
                    const cursor = rowSelected ? "❯ " : "  ";
                    return h(Box, { key: p.name, flexDirection: "column" },
                        h(Text, { wrap: "truncate-end" },
                            h(Text, { backgroundColor: bg, color: nameColor, bold: true }, `${cursor}${p.name}`)),
                        h(Text, { backgroundColor: bg, color: descColor, wrap: "truncate-end" }, `   ${p.description || ""}`)
                    );
                }
            })
        ),
        h(Panel, { title: current ? `Profile: ${current.name}` : "Details", theme, width: detailW },
            current ? h(Box, { flexDirection: "column" },
                h(Text, { color: theme.text, wrap: "wrap" }, current.description || ""),
                h(KeyValue, {
                    theme, labelWidth: 14,
                    pairs: [
                        ["Collections", (current.collections || []).join(", ") || "none"],
                        ["Extra", (current.components || []).join(", ") || "none"],
                        ["Resolves to", expandError ? `error: ${expandError}` : `${expanded.length} components`],
                        ["Settings", current.settings ? Object.entries(current.settings).map(([k, v]) => `${k}=${v}`).join(" ") : "none"]
                    ]
                }),
                expandError ? null : h(Text, { color: theme.textMuted, wrap: "wrap" }, `\n${expanded.slice(0, 20).join(", ")}${expanded.length > 20 ? ", ..." : ""}`),
                h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints: [["a", "install"], ["s", "set as default"]] })),
                running ? h(Box, { flexDirection: "column", marginTop: 1 },
                    h(ProgressBar, { value: running.step, total: running.total, theme, label: running.stepName || "" }),
                    ...running.lines.map((line, i) => h(Text, { key: line + i, color: theme.textMuted }, line.slice(0, 44)))
                ) : null
            ) : h(Text, { color: theme.textMuted }, "No profiles found.")
        )
    );
}
