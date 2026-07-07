// Shared AI TUI components: sub-navigation bar, status header, and
// empty-state component used across all AI pages. These provide the
// consistent "AI application" feel described in the PRD.
import { Box, Text } from "ink";
import { h, KeyHints, KeyValue } from "./ui.js";
import { aiHealthStatus, aiHealthTone, getAIStatusReport } from "../../core/ai/validation.js";

// AI_SUBPAGES: the navigation items for the AI section. Each has a
// shortcut key, a label, and the page id it navigates to.
export const AI_SUBPAGES = [
    { key: "a", label: "Assistant", page: "ai" },
    { key: "o", label: "Overview", page: "ai-overview" },
    { key: "p", label: "Providers", page: "ai-providers" },
    { key: "m", label: "Models", page: "ai-models" },
    { key: "k", label: "Credentials", page: "ai-credentials" },
    { key: "d", label: "Diagnostics", page: "ai-diagnostics" },
    { key: "c", label: "Capabilities", page: "ai-capabilities" },
    { key: "h", label: "History", page: "ai-history" }
];

// AISubNav: a horizontal bar showing the AI sub-pages with shortcuts.
// Renders the current page highlighted. Keyboard shortcuts are handled
// by the parent page (via useInput) to avoid double-firing.
export function AISubNav({ currentPage, theme, _onNavigate }) {
    return h(Box, { borderStyle: "round", borderColor: theme.border, paddingX: 1, flexShrink: 0 },
        h(Text, null,
            h(Text, { color: theme.accent, bold: true }, "AI"),
            h(Text, { color: theme.textMuted }, "  "),
            ...AI_SUBPAGES.map((sp, i) => {
                const isCurrent = sp.page === currentPage;
                const sep = i > 0 ? "  " : "";
                return [
                    sep ? h(Text, { key: `sep-${i}`, color: theme.border }, sep) : null,
                    h(Text, {
                        key: sp.key,
                        color: isCurrent ? theme.accent : theme.textMuted,
                        bold: isCurrent
                    }, `${isCurrent ? "▸ " : ""}[${sp.key}] ${sp.label}`)
                ];
            }).flat()
        )
    );
}

// AIStatusBar: a compact one-line status showing provider, model, and
// real health state. Shown at the bottom of every AI page. Uses
// aiHealthStatus() for the actual validation — never silently shows
// "Ready" when something is wrong.
export function AIStatusBar({ config, theme, latency }) {
    const health = aiHealthStatus();
    const color = theme[aiHealthTone(health.status)] || theme.textMuted;

    if (!config.provider) {
        return h(Box, { borderStyle: "round", borderColor: theme.border, paddingX: 1, flexShrink: 0 },
            h(Text, null,
                h(Text, { color: theme.error, bold: true }, "AI"),
                h(Text, { color: theme.textMuted }, "  Not configured  "),
                h(Text, { color: theme.accent, bold: true }, "Press A"),
                h(Text, { color: theme.textMuted }, " to begin")
            )
        );
    }
    return h(Box, { borderStyle: "round", borderColor: theme.border, paddingX: 1, flexShrink: 0 },
        h(Text, null,
            h(Text, { color: color, bold: true }, "AI"),
            h(Text, { color: theme.textMuted }, "  "),
            h(Text, { color: theme.accent, bold: true }, config.provider),
            h(Text, { color: theme.textMuted }, "  "),
            h(Text, { color: theme.text }, config.model || "default"),
            latency ? h(Text, { color: theme.textMuted }, `  ${latency}ms`) : null,
            h(Text, { color: color, bold: true }, `  ${health.label}`)
        )
    );
}

// AIEmptyState: the consistent "no provider configured" screen shown
// across all AI pages when no provider is active.
export function AIEmptyState({ theme, _onSetup }) {
    const providers = ["OpenAI", "Anthropic", "Gemini", "Groq", "OpenRouter", "Ollama", "LM Studio"];
    return h(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1 },
        h(Text, { color: theme.warning, bold: true }, "No AI provider configured"),
        h(Text, { color: theme.textMuted }, "DevForgeKit supports"),
        h(Box, { flexDirection: "column", marginTop: 1, marginBottom: 1 },
            ...providers.map((p) => h(Text, { key: p, color: theme.text },
                `  ✓ ${p}`))
        ),
        h(Text, { color: theme.textMuted }, "To begin"),
        h(Box, { marginTop: 1 },
            h(KeyHints, { theme, hints: [
                ["A", "Add API Key"],
                ["Enter", "Setup Wizard"]
            ]})
        )
    );
}

// AIStatusCard: a compact panel showing the full AI configuration status.
// Displays provider, status, credential backend, API key state, model,
// endpoint, connection health, and cached model count. Used on the AI
// Overview page and available to any page that wants to show full status.
export function AIStatusCard({ theme, latency, testing }) {
    const report = getAIStatusReport();
    const health = report.health;

    const statusColorVal = theme[aiHealthTone(health.status)] || theme.warning;

    const connectionLabel = testing ? "Checking..." : latency !== null && latency !== undefined ? `Healthy (${latency}ms)` : "—";
    const connectionColor = testing ? theme.textMuted : latency !== null && latency !== undefined ? theme.success : theme.textMuted;

    return h(Box, { flexDirection: "column" },
        h(KeyValue, {
            theme, labelWidth: 22,
            pairs: [
                ["Status", health.label, statusColorVal],
                ["Provider", report.provider ? report.provider.label : "—", report.provider ? theme.accent : theme.textMuted],
                ["Credential Backend", report.credentialBackend.location, theme.text],
                ["API Key", report.apiKey.available ? "Stored" : "Missing", report.apiKey.available ? theme.success : theme.error],
                ["Model", report.model || "default", report.model && !report.modelIsDefault ? theme.text : theme.textMuted],
                ["Endpoint", report.endpoint || "default", theme.textMuted],
                ["Connection", connectionLabel, connectionColor],
                ["Models Cached", report.models.cached ? String(report.models.count) : "No", report.models.cached ? theme.text : theme.textMuted]
            ]
        })
    );
}

// AIPageWrapper: wraps every AI page with the sub-nav and status bar.
// `page` is the current page id (for sub-nav highlight). `config` is
// the AI config { provider, model, endpoint }. `onNavigate` is the
// store's navigate action. `children` is the page content.
// `showEmpty` overrides the empty-state check (some pages like Providers
// should show even without a configured provider).
export function AIPageWrapper({ page, config, theme, onNavigate, children, showEmpty = false, latency }) {
    return h(Box, { flexDirection: "column", flexGrow: 1 },
        h(AISubNav, { currentPage: page, theme, onNavigate }),
        h(Box, { flexGrow: 1 },
            (!config.provider && !showEmpty)
                ? h(AIEmptyState, { theme })
                : children
        ),
        h(AIStatusBar, { config, theme, latency })
    );
}
