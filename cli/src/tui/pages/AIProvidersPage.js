// AI Providers: rich card-based provider list with full keyboard
// shortcuts. Every supported provider always appears — configured or
// not. The active provider is visually highlighted. Actions: A=add key,
// P=make active, M=browse models, T=test, E=edit endpoint, R=remove key,
// I=info, Enter=details.
import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, DetailPanel, SelectList, LoadingState, useDetailWidth } from "../components/ui.js";
import { AIPageWrapper } from "../components/ai.js";
import { useStore } from "../store.js";
import { loadConfig, setConfigValue } from "../../core/config.js";
import { getActiveWorkspace } from "../../core/workspace/store.js";
import {
    listAllProviders, providerLabel,
    storageLocation, addKey, removeProviderKey
} from "../../core/ai/credentials/manager.js";
import { getProvider, requiresApiKey, KNOWN_PROVIDERS } from "../../core/ai/providers/index.js";
import { providerIcon } from "../../core/ai/providers/meta.js";
import { diagnoseProviderError } from "../../core/ai/diagnostics/errors.js";
import { checkModelConsistency } from "../../core/ai/validation.js";

const ACTIONS = [
    ["A", "Add Key"],
    ["P", "Make Active"],
    ["M", "Browse Models"],
    ["T", "Test Connection"],
    ["E", "Edit Endpoint"],
    ["R", "Remove Key"],
    ["I", "Info"],
    ["Enter", "Details"]
];

export function AIProvidersPage({ isActive }) {
    const { theme, state, actions } = useStore();
    const [providers, setProviders] = useState([]);
    const [highlighted, setHighlighted] = useState(null);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [latencies, setLatencies] = useState({});
    const [, forceRender] = useState(0);
    const detailW = useDetailWidth(44);

    const config = loadConfig();

    function refreshProviders() {
        const workspace = getActiveWorkspace();
        setProviders(listAllProviders({ workspace }));
    }

    useEffect(() => { refreshProviders(); }, []);

    const selected = highlighted && providers.some((p) => p.id === highlighted.id) ? highlighted : providers[0] || null;

    async function testConnection(providerId) {
        setTesting(true);
        setTestResult(null);
        actions.setBusy({ label: "testing " + providerId });
        try {
            const workspace = getActiveWorkspace();
            const provider = getProvider(providerId, { workspace });
            const start = Date.now();
            const health = await provider.checkHealth();
            const latency = Date.now() - start;
            if (health.ok) {
                setTestResult({ ok: true, latency, providerId });
                setLatencies((prev) => ({ ...prev, [providerId]: latency }));
                actions.notify(`${providerLabel(providerId)}: connected (${latency}ms)`, "success");
            } else {
                setTestResult({ ok: false, reason: health.reason, providerId });
                actions.notify(`${providerLabel(providerId)}: unreachable`, "error");
            }
        } catch (err) {
            const diag = diagnoseProviderError(providerId, err);
            setTestResult({ ok: false, reason: diag.message, providerId });
            actions.notify(`${providerLabel(providerId)}: ${diag.message}`, "error");
        } finally {
            setTesting(false);
            actions.setBusy(null);
        }
    }

    async function handleAddKey(providerId) {
        if (!requiresApiKey(providerId)) {
            actions.notify(`${providerLabel(providerId)} is local — no key needed`, "info");
            return;
        }
        const apiKey = await actions.promptTextAsync(`Paste your ${providerLabel(providerId)} API key`);
        if (!apiKey) { actions.log("Cancelled — no key provided."); return; }
        addKey(providerId, apiKey.trim());
        actions.log(`Added key for ${providerId}`);
        actions.notify(`Key for ${providerLabel(providerId)} stored`, "success");
        refreshProviders();
        forceRender((n) => n + 1);
    }

    async function handleRemoveKey(providerId) {
        if (!requiresApiKey(providerId)) {
            actions.notify(`${providerLabel(providerId)} is local — no key to remove`, "info");
            return;
        }
        const removed = removeProviderKey(providerId);
        if (removed) {
            actions.notify(`Key for ${providerLabel(providerId)} removed`, "success");
            actions.log(`Removed key for ${providerId}`);
        } else {
            actions.notify(`No stored key for ${providerLabel(providerId)}`, "info");
        }
        refreshProviders();
        forceRender((n) => n + 1);
    }

    function handleMakeActive(providerId) {
        const currentModel = loadConfig().aiModel;
        setConfigValue("aiProvider", providerId);

        // Validate model compatibility — reset to default if the current
        // model doesn't belong to the new provider (Phase 1 & 7).
        if (currentModel) {
            const issue = checkModelConsistency(providerId, currentModel);
            if (issue) {
                const defaults = { openai: "gpt-4o-mini", anthropic: "claude-3-5-sonnet-latest", gemini: "gemini-1.5-flash", groq: "llama-3.1-8b-instant", openrouter: "openai/gpt-4o-mini", ollama: "llama3", lmstudio: "local-model" };
                const newDefault = defaults[providerId] || null;
                if (newDefault) {
                    setConfigValue("aiModel", newDefault);
                    actions.notify(`Provider switched to ${providerLabel(providerId)}. Model reset to ${newDefault} (was incompatible)`, "warning");
                    actions.log(`Switched AI provider to ${providerId}, reset model from ${currentModel} to ${newDefault}`);
                } else {
                    setConfigValue("aiModel", null);
                    actions.notify(`Provider switched to ${providerLabel(providerId)}. Model cleared (was incompatible)`, "warning");
                }
            } else {
                actions.notify(`Active provider: ${providerLabel(providerId)}`, "success");
                actions.log(`Switched AI provider to ${providerId}`);
            }
        } else {
            actions.notify(`Active provider: ${providerLabel(providerId)}`, "success");
            actions.log(`Switched AI provider to ${providerId}`);
        }
        forceRender((n) => n + 1);
    }

    async function handleEditEndpoint(providerId) {
        const endpoint = await actions.promptTextAsync(`Endpoint URL for ${providerLabel(providerId)} (blank to clear)`);
        if (endpoint === null || endpoint === undefined) { actions.log("Cancelled."); return; }
        const value = endpoint.trim();
        if (value === "") {
            setConfigValue("aiEndpoint", null);
            actions.notify(`Endpoint cleared for ${providerLabel(providerId)}`, "success");
            actions.log(`Cleared aiEndpoint`);
        } else {
            setConfigValue("aiEndpoint", value);
            actions.notify(`Endpoint set for ${providerLabel(providerId)}`, "success");
            actions.log(`Set aiEndpoint to ${value}`);
        }
        forceRender((n) => n + 1);
    }

    useInput((input) => {
        if (testing || state.typing) return;
        if (input === "t" && selected) {
            testConnection(selected.id);
        } else if (input === "p" && selected) {
            handleMakeActive(selected.id);
        } else if (input === "a" && selected) {
            handleAddKey(selected.id);
        } else if (input === "r" && selected) {
            handleRemoveKey(selected.id);
        } else if (input === "e" && selected) {
            handleEditEndpoint(selected.id);
        } else if (input === "m" && selected) {
            actions.navigate("ai-models");
        } else if (input === "d") {
            actions.navigate("ai-diagnostics");
        } else if (input === "h") {
            actions.navigate("ai-history");
        } else if (input === "c") {
            actions.navigate("ai-capabilities");
        } else if (input === "o") {
            actions.navigate("ai-overview");
        } else if (input === "k") {
            actions.navigate("ai-credentials");
        }
    }, { isActive: Boolean(isActive) && !state.searchOpen && !testing });

    function providerCard(p, rowSelected) {
        const isActiveProv = config.aiProvider === p.id;
        const latency = latencies[p.id];
        const bg = rowSelected ? theme.selection : undefined;
        const fg = rowSelected ? theme.selectionText : isActiveProv ? theme.accent : p.hasKey ? theme.success : theme.textMuted;

        return h(Text, {
            key: p.id,
            backgroundColor: bg,
            color: fg,
            bold: isActiveProv
        },
            `${rowSelected ? "❯ " : "  "}${isActiveProv ? "▸ " : ""}${p.hasKey ? "✓" : "○"} ${providerIcon(p.id)} ${p.label.padEnd(14)} ${p.type === "local" ? "(local)" : "(cloud)"}${latency ? ` ${latency}ms` : p.hasKey ? "" : " — not configured"}`
        );
    }

    const aiConfig = { provider: config.aiProvider !== "none" ? config.aiProvider : null, model: config.aiModel, endpoint: config.aiEndpoint };

    return h(AIPageWrapper, { page: "ai-providers", config: aiConfig, theme, onNavigate: actions.navigate, showEmpty: true },
        h(Box, { flexGrow: 1 },
            h(Panel, { title: "AI Providers", theme, isActive, flexGrow: 1 },
                h(Box, { flexDirection: "column" },
                    h(SelectList, {
                        items: providers,
                        isActive: Boolean(isActive) && !testing,
                        height: 10,
                        theme,
                        onHighlight: setHighlighted,
                        renderItem: (p, selected_) => providerCard(p, selected_ && isActive)
                    }),
                    testing ? h(Box, { marginTop: 1 }, h(LoadingState, { label: "testing...", theme })) : null,
                    testResult ? h(Box, { marginTop: 1 }, h(Text, {
                        color: testResult.ok ? theme.success : theme.error
                    }, testResult.ok ? `✓ Connected (${testResult.latency}ms)` : `✗ ${testResult.reason}`)) : null
                )
            ),
            h(DetailPanel, {
                title: selected ? `${providerLabel(selected.id)}${config.aiProvider === selected.id ? " — ACTIVE" : ""}` : "Details",
                theme, width: detailW,
                emptyText: "Select a provider",
                sections: selected ? [{
                    pairs: [
                        ["Type", selected.type, theme.textMuted],
                        ["Configured", selected.hasKey ? "Yes" : "No", selected.hasKey ? theme.success : theme.error],
                        ["Auth Source", selected.source || "—", theme.text],
                        ["Streaming", "Supported", theme.success],
                        ["Latency", latencies[selected.id] ? `${latencies[selected.id]}ms` : "—", theme.textMuted],
                        ["Endpoint", config.aiEndpoint || (selected.id === "ollama" ? "localhost:11434" : selected.id === "lmstudio" ? "localhost:1234" : selected.type === "cloud" ? "cloud API" : "—"), theme.textMuted],
                        ["Key URL", selected.keyUrl || "—", theme.textMuted],
                        ["Storage", storageLocation(), theme.textMuted]
                    ]
                }] : [],
                hints: selected ? ACTIONS : undefined
            })
        )
    );
}
