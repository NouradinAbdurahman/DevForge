// AI Credentials: a dedicated page for managing API keys without
// exposing secret values. Shows which providers have keys, where they're
// stored, and lets the user add/remove/test/rotate/export/import — all
// from the TUI. Never displays API key values.
import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, DetailPanel, SelectList, LoadingState, statusColor, useDetailWidth } from "../components/ui.js";
import { AIPageWrapper } from "../components/ai.js";
import { useStore } from "../store.js";
import { loadConfig } from "../../core/config.js";
import { getActiveWorkspace } from "../../core/workspace/store.js";
import {
    listAllProviders, providerLabel, storageLocation,
    addKey, removeProviderKey, exportKeys, importKeys, migrateKeys
} from "../../core/ai/credentials/manager.js";
import { requiresApiKey } from "../../core/ai/providers/index.js";
import { getProvider } from "../../core/ai/providers/index.js";
import { diagnoseProviderError } from "../../core/ai/diagnostics/errors.js";
import { writeFileSync, readFileSync } from "node:fs";

const ACTIONS = [
    ["A", "Add Key"],
    ["R", "Remove"],
    ["T", "Test"],
    ["X", "Rotate"],
    ["E", "Export"],
    ["I", "Import"],
    ["M", "Migrate Env"]
];

export function AICredentialsPage({ isActive }) {
    const { theme, state, actions } = useStore();
    const [providers, setProviders] = useState([]);
    const [highlighted, setHighlighted] = useState(null);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [, forceRender] = useState(0);
    const detailW = useDetailWidth(44);

    const config = loadConfig();

    function refreshProviders() {
        const workspace = getActiveWorkspace();
        setProviders(listAllProviders({ workspace }));
    }

    useEffect(() => { refreshProviders(); }, []);

    const cloudProviders = providers.filter((p) => p.requiresKey);
    const selected = highlighted && cloudProviders.some((p) => p.id === highlighted.id) ? highlighted : cloudProviders[0] || null;

    async function handleAddKey(providerId) {
        if (!requiresApiKey(providerId)) {
            actions.notify(`${providerLabel(providerId)} is local — no key needed`, "info");
            return;
        }
        const apiKey = await actions.promptTextAsync(`Paste your ${providerLabel(providerId)} API key`);
        if (!apiKey) { actions.log("Cancelled."); return; }
        addKey(providerId, apiKey.trim());
        actions.notify(`Key for ${providerLabel(providerId)} stored`, "success");
        refreshProviders();
        forceRender((n) => n + 1);
    }

    function handleRemoveKey(providerId) {
        if (!requiresApiKey(providerId)) return;
        const removed = removeProviderKey(providerId);
        if (removed) {
            actions.notify(`Key for ${providerLabel(providerId)} removed`, "success");
        } else {
            actions.notify(`No stored key for ${providerLabel(providerId)}`, "info");
        }
        refreshProviders();
        forceRender((n) => n + 1);
    }

    async function handleRotateKey(providerId) {
        if (!requiresApiKey(providerId)) return;
        const apiKey = await actions.promptTextAsync(`Paste new ${providerLabel(providerId)} API key (rotation)`);
        if (!apiKey) { actions.log("Cancelled."); return; }
        addKey(providerId, apiKey.trim());
        actions.notify(`Key for ${providerLabel(providerId)} rotated`, "success");
        refreshProviders();
        forceRender((n) => n + 1);
    }

    function handleExport() {
        const keys = exportKeys();
        if (keys.length === 0) {
            actions.notify("No keys in keychain to export", "info");
            return;
        }
        const json = JSON.stringify(keys, null, 2);
        const filename = `devforgekit-keys-export-${Date.now()}.json`;
        writeFileSync(filename, json);
        actions.notify(`Exported ${keys.length} key(s) to ${filename}`, "success");
        actions.log(`Exported keys to ${filename}`);
    }

    async function handleImport() {
        const filename = await actions.promptTextAsync("Path to import file");
        if (!filename) { actions.log("Cancelled."); return; }
        try {
            const data = JSON.parse(readFileSync(filename, "utf8"));
            const result = importKeys(data);
            actions.notify(`Imported ${result.imported}, skipped ${result.skipped}`, "success");
        } catch (err) {
            actions.notify(`Import failed: ${err.message}`, "error");
        }
        refreshProviders();
        forceRender((n) => n + 1);
    }

    function handleMigrate() {
        const result = migrateKeys();
        if (result.migrated > 0) {
            actions.notify(`Migrated ${result.migrated} key(s) from env vars`, "success");
        } else {
            actions.notify("No env var keys to migrate", "info");
        }
        refreshProviders();
        forceRender((n) => n + 1);
    }

    async function handleTest(providerId) {
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
                actions.notify(`${providerLabel(providerId)}: OK (${latency}ms)`, "success");
            } else {
                setTestResult({ ok: false, reason: health.reason, providerId });
                actions.notify(`${providerLabel(providerId)}: ${health.reason}`, "error");
            }
        } catch (err) {
            const diag = diagnoseProviderError(providerId, err);
            setTestResult({ ok: false, reason: diag.message, providerId });
            actions.notify(diag.message, "error");
        } finally {
            setTesting(false);
            actions.setBusy(null);
        }
    }

    useInput((input) => {
        if (testing || state.typing) return;
        if (!selected) return;
        if (input === "a") handleAddKey(selected.id);
        else if (input === "r") handleRemoveKey(selected.id);
        else if (input === "t") handleTest(selected.id);
        else if (input === "x") handleRotateKey(selected.id);
        else if (input === "e") handleExport();
        else if (input === "i") handleImport();
        else if (input === "m") handleMigrate();
        else if (input === "o") actions.navigate("ai-overview");
        else if (input === "p") actions.navigate("ai-providers");
        else if (input === "c") actions.navigate("ai-capabilities");
    }, { isActive: Boolean(isActive) && !state.searchOpen && !testing });

    const aiConfig = { provider: config.aiProvider !== "none" ? config.aiProvider : null, model: config.aiModel, endpoint: config.aiEndpoint };

    return h(AIPageWrapper, { page: "ai-credentials", config: aiConfig, theme, onNavigate: actions.navigate, showEmpty: true },
        h(Box, { flexGrow: 1 },
            h(Panel, { title: "Configured Credentials", theme, isActive, flexGrow: 1 },
                h(Box, { flexDirection: "column" },
                    h(SelectList, {
                        items: cloudProviders,
                        isActive: Boolean(isActive) && !testing,
                        height: 10,
                        theme,
                        onHighlight: setHighlighted,
                        renderItem: (p, selected_) => {
                            const rowSelected = selected_ && isActive;
                            const bg = rowSelected ? theme.selection : undefined;
                            const fg = rowSelected ? theme.selectionText : statusColor(p.hasKey ? "ok" : "not-configured", theme);
                            const icon = p.hasKey ? "✓" : "✗";
                            return h(Text, { key: p.id, backgroundColor: bg, color: fg },
                                `${rowSelected ? "❯ " : "  "}${icon} ${p.label.padEnd(14)} ${p.hasKey ? `(${p.source})` : "Not configured"}`);
                        }
                    }),
                    testing ? h(Box, { marginTop: 1 }, h(LoadingState, { label: "testing...", theme })) : null,
                    testResult ? h(Box, { marginTop: 1 }, h(Text, {
                        color: testResult.ok ? theme.success : theme.error
                    }, testResult.ok ? `✓ OK (${testResult.latency}ms)` : `✗ ${testResult.reason}`)) : null
                )
            ),
            h(DetailPanel, {
                title: selected ? providerLabel(selected.id) : "Details",
                theme, width: detailW,
                emptyText: "Select a credential",
                sections: selected ? [{
                    pairs: [
                        ["Provider", selected.label, theme.accent],
                        ["Status", selected.hasKey ? "Configured" : "Not configured", selected.hasKey ? theme.success : theme.error],
                        ["Source", selected.source || "—", theme.text],
                        ["Storage", selected.hasKey ? storageLocation() : "—", theme.textMuted],
                        ["In Keychain", selected.storedInKeychain ? "Yes" : "No", selected.storedInKeychain ? theme.success : theme.textMuted]
                    ]
                }] : [],
                hints: selected ? ACTIONS : undefined
            })
        )
    );
}
