// AI Capabilities: shows what each provider supports — chat, vision, tools,
// JSON, streaming, function calling, reasoning, embeddings. A quick
// reference matrix for choosing the right provider.
import { Box, Text, useInput } from "ink";
import { h, Panel, DetailPanel, statusColor } from "../components/ui.js";
import { AIPageWrapper } from "../components/ai.js";
import { useStore } from "../store.js";
import { loadConfig } from "../../core/config.js";
import { providerLabel } from "../../core/ai/credentials/manager.js";
import { providerIcon, capabilityList, capabilityLabels } from "../../core/ai/providers/meta.js";
import { KNOWN_PROVIDERS } from "../../core/ai/providers/index.js";

const ALL_CAPS = Object.entries(capabilityLabels());

export function AICapabilitiesPage({ isActive }) {
    const { theme, state, actions } = useStore();
    const config = loadConfig();
    const providerId = config.aiProvider && config.aiProvider !== "none" ? config.aiProvider : null;

    useInput((input) => {
        if (input === "o") actions.navigate("ai-overview");
        else if (input === "p") actions.navigate("ai-providers");
        else if (input === "m") actions.navigate("ai-models");
        else if (input === "a") actions.navigate("ai");
        else if (input === "k") actions.navigate("ai-credentials");
        else if (input === "d") actions.navigate("ai-diagnostics");
        else if (input === "h") actions.navigate("ai-history");
    }, { isActive: Boolean(isActive) && !state.searchOpen });

    const aiConfig = { provider: providerId, model: config.aiModel, endpoint: config.aiEndpoint };

    return h(AIPageWrapper, { page: "ai-capabilities", config: aiConfig, theme, onNavigate: actions.navigate, showEmpty: true },
        h(Box, { flexGrow: 1 },
            h(Panel, { title: "Provider Capabilities", theme, isActive, flexGrow: 1 },
                h(Box, { flexDirection: "column" },
                    // Header row
                    h(Box, null,
                        h(Text, { color: theme.textMuted, bold: true }, "  Provider".padEnd(16)),
                        ...ALL_CAPS.map(([key, label]) => {
                            const short = label.length > 8 ? label.slice(0, 7) + "…" : label;
                            return h(Text, { key, color: theme.textMuted, bold: true }, short.padEnd(10));
                        })
                    ),
                    h(Text, { color: theme.textMuted }, "  " + "─".repeat(16 + ALL_CAPS.length * 10)),
                    // Provider rows
                    ...KNOWN_PROVIDERS.map((pid) => {
                        const caps = capabilityList(pid);
                        const isActiveProv = pid === providerId;
                        return h(Box, { key: pid },
                            h(Text, {
                                color: isActiveProv ? theme.accent : theme.text,
                                bold: isActiveProv
                            }, `  ${providerIcon(pid)} ${providerLabel(pid)}`.padEnd(16)),
                            ...caps.map((c) => h(Text, {
                                key: c.key,
                                color: c.supported ? statusColor("ok", theme) : theme.textMuted
                            }, (c.supported ? "✓" : "○").padEnd(2) + " ".repeat(Math.max(0, 10 - 2))))
                        );
                    })
                )
            ),
            h(DetailPanel, {
                title: providerId ? `${providerIcon(providerId)} ${providerLabel(providerId)}` : "Active Provider",
                theme, width: 36,
                emptyText: "No provider configured. Press P to choose one.",
                sections: providerId ? [{
                    labelWidth: 18,
                    pairs: capabilityList(providerId).map((c) => [
                        c.label,
                        c.supported ? "✓ Yes" : "○ No",
                        c.supported ? theme.success : theme.textMuted
                    ])
                }] : [],
                hints: providerId ? [["P", "Providers"], ["M", "Models"], ["O", "Overview"]] : undefined
            })
        )
    );
}
