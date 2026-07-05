// Inventory: reuses the existing Layer 1 inventory system verbatim -
// lists the Markdown reports scripts/inventory.sh last wrote under
// reports/, previews the highlighted one, and regenerates them on
// demand (suspended, since inventory.sh prints its own progress).
import { useState } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Box, Text, useInput } from "ink";
import { h, Panel, SelectList, KeyHints, useDetailWidth } from "../components/ui.js";
import { useStore } from "../store.js";
import { inventoryReports } from "../data.js";
import { repoRoot } from "../../core/paths.js";
import { runScript } from "../../core/shell.js";

export function InventoryPage({ isActive }) {
    const { theme, state, actions, suspend } = useStore();
    const [reports, setReports] = useState(inventoryReports);
    const [highlighted, setHighlighted] = useState(null);
    const detailW = useDetailWidth(40);

    const current = highlighted && reports.includes(highlighted) ? highlighted : reports[0] || null;

    let preview = "";
    if (current) {
        try {
            preview = readFileSync(path.join(repoRoot(), "reports", current), "utf8")
                .split("\n").slice(0, 18).join("\n");
        } catch {
            preview = "(could not read report)";
        }
    }

    async function regenerate() {
        actions.log("scripts/inventory.sh (suspended)");
        await suspend(async () => {
            await runScript("scripts/inventory.sh", []);
        });
        setReports(inventoryReports());
        actions.notify("Inventory reports regenerated", "success");
    }

    useInput((input) => {
        if (input === "a") regenerate();
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    return h(Box, { flexGrow: 1 },
        h(Panel, { title: `Inventory reports (${reports.length})`, theme, isActive, width: detailW },
            h(SelectList, {
                items: reports, isActive, height: 14, theme,
                onHighlight: setHighlighted,
                emptyText: "No reports yet - press a to generate them (runs scripts/inventory.sh)."
            }),
            h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints: [["a", "regenerate (suspends - runs inventory.sh)"]] }))
        ),
        h(Panel, { title: current ? `reports/${current}` : "Preview", theme, flexGrow: 1 },
            current
                ? h(Text, { color: theme.text }, preview)
                : h(Text, { color: theme.textMuted },
                    "Inventory covers hardware, software, brew packages, fonts, editor extensions, services, databases, and network - masked serials, written as Markdown under reports/.")
        )
    );
}
