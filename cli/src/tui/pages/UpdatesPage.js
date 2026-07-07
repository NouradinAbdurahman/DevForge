// Updates: live `brew outdated` list (the same probe `devforgekit
// stats` uses), per-package update via the registry's own update
// commands where a manifest declares one, and a handoff to the full
// scripts/update.sh for the everything-at-once path. Registry/plugin/
// recipe/template "updates" are files in this repo - updating them is
// `git pull`, stated plainly rather than dressed up as a fake updater.
import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, SelectList, KeyValue, KeyHints, LoadingState, EmptyState, useDetailWidth } from "../components/ui.js";
import { useStore } from "../store.js";
import { outdated, refreshAll, getPackageSafe } from "../data.js";
import { update as updatePkg } from "../../core/installer.js";
import { runScript, runShellCommand } from "../../core/shell.js";
import { getPlatform } from "../../core/platform/index.js";

export function UpdatesPage({ isActive }) {
    const { theme, state, actions, suspend } = useStore();
    const [list, setList] = useState(null);
    const [highlighted, setHighlighted] = useState(null);
    const [running, setRunning] = useState(null);
    const detailW = useDetailWidth(48);

    useEffect(() => {
        let mounted = true;
        outdated().then((o) => mounted && setList(o)).catch(() => mounted && setList([]));
        return () => { mounted = false; };
    }, []);

    const items = list || [];
    const current = highlighted && items.includes(highlighted) ? highlighted : items[0] || null;

    async function updateOne(formula) {
        if (!formula || running) return;
        const name = formula.split(" ")[0];
        setRunning(name);
        actions.setBusy({ label: `updating ${name}` });
        actions.log(`update ${name} started`);
        try {
            // Prefer the registry manifest's own update command when this
            // formula is a known component; otherwise plain brew upgrade.
            const pkg = getPackageSafe(name);
            const code = pkg?.update
                ? await updatePkg(pkg, { onOutput: () => {} })
                : await runShellCommand(getPlatform().upgradeCommand(name), { onOutput: () => {} });
            actions.notify(`${name} ${code === 0 ? "updated" : "update failed"}`, code === 0 ? "success" : "error");
            refreshAll();
            setList(await outdated());
        } catch (err) {
            actions.notify(`Update failed: ${err.message}`, "error");
        } finally {
            setRunning(null);
            actions.setBusy(null);
        }
    }

    async function updateEverything() {
        actions.log("scripts/update.sh (suspended)");
        await suspend(async () => {
            await runScript("scripts/update.sh", []);
        });
        refreshAll();
        setList(await outdated());
    }

    useInput((input) => {
        if (input === "a" && current) updateOne(current);
        else if (input === "A") updateEverything();
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: "Package updates (brew outdated)", theme, isActive, flexGrow: 1 },
            list === null
                ? h(LoadingState, { label: "checking for updates...", theme })
                : items.length === 0
                    ? h(EmptyState, { title: "Everything is up to date.", theme })
                    : h(SelectList, {
                        items, isActive, height: 14, theme,
                        onHighlight: setHighlighted,
                        renderItem: (line, selected) => h(Text, {
                            key: line,
                            backgroundColor: selected && isActive ? theme.selection : undefined,
                            color: selected && isActive ? theme.selectionText : theme.warning,
                            wrap: "truncate-end"
                        }, `${selected ? "❯ " : "  "}${line}${running === line.split(" ")[0] ? "  (updating...)" : ""}`)
                    }),
            running ? h(Box, { marginTop: 1 }, h(LoadingState, { label: `updating ${running}...`, theme })) : null,
            h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints: [["a", "update selected"], ["A", "run full update.sh (suspends)"]] }))
        ),
        h(Panel, { title: "Other update channels", theme, width: detailW },
            h(KeyValue, {
                theme, labelWidth: 12,
                pairs: [
                    ["Packages", "this page (brew outdated, live)"],
                    ["Toolchains", "A - scripts/update.sh (brew, mise, Flutter, pnpm...)"],
                    ["Registry", "git pull (manifests live in this repo)"],
                    ["Recipes", "git pull (registry/recipes/)"],
                    ["Templates", "git pull (templates/)"],
                    ["Plugins", "devforgekit plugin install <newer .tar.gz>"],
                    ["CLI", "git pull (no self-update yet - v1.3 roadmap)"]
                ]
            }),
            h(Text, { color: theme.textMuted, wrap: "wrap" },
                "\nScheduling: the `updateSchedule` config field exists but no scheduler consumes it yet - stated honestly (see Configuration page).")
        )
    );
}
