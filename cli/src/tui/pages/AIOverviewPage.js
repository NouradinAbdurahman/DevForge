// AI Overview: the landing page for the AI section. Shows a complete
// status summary — provider, model, auth, latency, configured providers
// count, available models, last request, workspace, compatibility.
// The user should never have to wonder "what provider am I using?"
import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, DetailPanel } from "../components/ui.js";
import { AIPageWrapper, AIStatusCard } from "../components/ai.js";
import { useStore } from "../store.js";
import { aiProviders, aiConfig, aiStorageLocation, activeWorkspaceName } from "../data.js";
import { getProvider, KNOWN_PROVIDERS } from "../../core/ai/providers/index.js";
import { providerLabel, providerType, resolveCredential } from "../../core/ai/credentials/manager.js";
import { getActiveWorkspace } from "../../core/workspace/store.js";
import { getCachedModels } from "../../core/ai/models/cache.js";
import { getHistory } from "../../core/ai/memory/history.js";
import { scoreAIHealth } from "../../core/ai/health.js";

export function AIOverviewPage({ isActive }) {
    const { theme, state, actions } = useStore();
    const config = aiConfig();
    const [latency, setLatency] = useState(null);
    const [testing, setTesting] = useState(false);
    const [modelCount, setModelCount] = useState(null);
    const [healthScore, setHealthScore] = useState(null);

    const providers = aiProviders();
    const workspace = getActiveWorkspace();
    const wsName = activeWorkspaceName();
    const storage = aiStorageLocation();
    const history = getHistory();
    const lastEvent = history.length > 0 ? history[history.length - 1] : null;

    const configuredCount = providers.filter((p) => p.hasKey).length;
    const credInfo = config.provider ? resolveCredential(config.provider, { workspace }) : null;

    // Test connection on mount if a provider is configured, then score
    // overall AI health using that same real connection result (rather
    // than a second network call) - see core/ai/health.js.
    useEffect(() => {
        let mounted = true;
        if (!config.provider) {
            scoreAIHealth().then((scored) => { if (mounted) setHealthScore(scored.score); }).catch(() => {});
            return () => { mounted = false; };
        }
        if (testing) return undefined;
        setTesting(true);
        (async () => {
            let connectionResult = null;
            try {
                const provider = getProvider(config.provider, { workspace });
                const start = Date.now();
                const health = await provider.checkHealth();
                connectionResult = health;
                if (mounted) {
                    setLatency(health.ok ? Date.now() - start : null);
                }
                // Try to get model count from cache
                if (mounted) {
                    const cached = getCachedModels(config.provider);
                    setModelCount(cached ? cached.models.length : null);
                }
            } catch {
                if (mounted) setLatency(null);
            } finally {
                if (mounted) setTesting(false);
            }
            try {
                const scored = await scoreAIHealth({ connectionResult });
                if (mounted) setHealthScore(scored.score);
            } catch { /* health.js already never throws; belt-and-suspenders */ }
        })();
        return () => { mounted = false; };
    }, [config.provider]);

    // Sub-page navigation shortcuts
    useInput((input) => {
        const subPages = [
            { key: "a", page: "ai" },
            { key: "p", page: "ai-providers" },
            { key: "m", page: "ai-models" },
            { key: "k", page: "ai-credentials" },
            { key: "d", page: "ai-diagnostics" },
            { key: "c", page: "ai-capabilities" },
            { key: "h", page: "ai-history" }
        ];
        const target = subPages.find((sp) => sp.key === input);
        if (target) actions.navigate(target.page);
    }, { isActive: Boolean(isActive) && !state.searchOpen && !state.typing });

    return h(AIPageWrapper, { page: "ai-overview", config, theme, onNavigate: actions.navigate, latency, showEmpty: true },
        h(Box, { flexDirection: "column", flexGrow: 1 },
            h(Box, null,
                h(Panel, { title: healthScore == null ? "AI Status" : `AI Status - Health ${healthScore}%`, theme, isActive, flexGrow: 1 },
                    h(AIStatusCard, { theme, latency, testing })
                ),
                h(Panel, { title: "Providers", theme, width: 36 },
                    h(Box, { flexDirection: "column" },
                        ...providers.map((p) => {
                            const isActiveProv = config.provider === p.id;
                            return h(Text, {
                                key: p.id,
                                color: isActiveProv ? theme.accent : p.hasKey ? theme.success : theme.textMuted,
                                bold: isActiveProv
                            }, `  ${isActiveProv ? "▸" : " "} ${p.hasKey ? "✓" : "○"} ${p.label}${p.type === "local" ? " (local)" : ""}`);
                        })
                    )
                )
            ),
            h(DetailPanel, {
                title: "Storage & Compatibility", theme,
                sections: [{
                    labelWidth: 24,
                    pairs: [
                        ["Credential Storage", storage, theme.text],
                        ["Auth Source", credInfo ? credInfo.source : "—", theme.text],
                        ["Configured Providers", `${configuredCount} / ${KNOWN_PROVIDERS.length}`, configuredCount > 0 ? theme.success : theme.textMuted],
                        ["Available Models", modelCount !== null ? String(modelCount) : "—", theme.text],
                        ["Last Request", lastEvent ? lastEvent.summary.slice(0, 40) : "—", theme.textMuted],
                        ["Current Workspace", wsName || "—", theme.text],
                        ["Provider Type", config.provider ? providerType(config.provider) : "—", theme.textMuted],
                        ["Endpoint", config.endpoint || (config.provider === "ollama" ? "http://localhost:11434" : config.provider === "lmstudio" ? "http://localhost:1234/v1" : "default"), theme.textMuted]
                    ]
                }],
                hints: [
                    ["A", "Assistant"],
                    ["P", "Providers"],
                    ["M", "Models"],
                    ["K", "Credentials"],
                    ["D", "Diagnostics"],
                    ["H", "History"]
                ]
            })
        )
    );
}
