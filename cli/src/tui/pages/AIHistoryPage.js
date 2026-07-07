// AI History: shows the AI event log (structured facts about what
// happened — repairs, generations, etc. — never chat contents).
// Displays recent events with timestamps, types, and summaries.
import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, DetailPanel, ScrollList, useDetailWidth } from "../components/ui.js";
import { AIPageWrapper } from "../components/ai.js";
import { useStore } from "../store.js";
import { loadConfig } from "../../core/config.js";
import { getHistory, clearHistory } from "../../core/ai/memory/history.js";

export function AIHistoryPage({ isActive }) {
    const { theme, state, actions } = useStore();
    const [history, setHistory] = useState([]);
    const [, forceRender] = useState(0);
    const detailW = useDetailWidth(44);

    const config = loadConfig();
    const providerId = config.aiProvider && config.aiProvider !== "none" ? config.aiProvider : null;

    function refresh() {
        setHistory(getHistory());
    }

    useEffect(() => { refresh(); }, []);

    useInput((input) => {
        if (state.typing) return;
        if (input === "c") {
            clearHistory();
            refresh();
            actions.notify("AI history cleared.", "success");
            actions.log("Cleared AI history");
        } else if (input === "r") {
            refresh();
            forceRender((n) => n + 1);
        } else if (input === "o") actions.navigate("ai-overview");
        else if (input === "p") actions.navigate("ai-providers");
        else if (input === "a") actions.navigate("ai");
        else if (input === "m") actions.navigate("ai-models");
        else if (input === "k") actions.navigate("ai-credentials");
        else if (input === "d") actions.navigate("ai-diagnostics");
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    const recent = [...history].reverse().slice(0, 50);

    const aiConfig = { provider: providerId, model: config.aiModel, endpoint: config.aiEndpoint };

    return h(AIPageWrapper, { page: "ai-history", config: aiConfig, theme, onNavigate: actions.navigate, showEmpty: true },
        h(Box, { flexGrow: 1 },
            h(Panel, { title: `AI History (${history.length} events)`, theme, isActive, flexGrow: 1 },
                h(ScrollList, {
                    items: recent,
                    isActive: Boolean(isActive) && !state.searchOpen,
                    height: 16,
                    theme,
                    emptyText: "No AI events recorded yet. Use AI commands (chat, doctor, generate, planner) to create history.",
                    renderItem: (entry, i) => h(Text, {
                        key: i,
                        color: theme.text,
                        wrap: "truncate-end"
                    }, `  ${entry.timestamp ? new Date(entry.timestamp).toLocaleString().slice(5, 19) : "—"}  ${entry.type.padEnd(12)} ${entry.summary.slice(0, 60)}`)
                })
            ),
            h(DetailPanel, {
                title: "Actions", theme, width: detailW,
                body: h(Text, { color: theme.textMuted, wrap: "wrap" },
                    "AI History logs structured events (repairs, generations, scans) — never chat contents."),
                hints: [["R", "Refresh"], ["C", "Clear History"]]
            })
        )
    );
}
