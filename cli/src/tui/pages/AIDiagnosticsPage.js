// AI Diagnostics: runs a series of checks against the current AI
// provider — API key, authentication, endpoint, streaming, network,
// latency, model access — and displays results with recovery actions
// for every failure.
import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { h, Panel, DetailPanel, KeyHints, InstallProgress, statusColor, useDetailWidth } from "../components/ui.js";
import { AIPageWrapper } from "../components/ai.js";
import { useStore } from "../store.js";
import { loadConfig } from "../../core/config.js";
import { getActiveWorkspace } from "../../core/workspace/store.js";
import { providerLabel, resolveCredential } from "../../core/ai/credentials/manager.js";
import { getProvider } from "../../core/ai/providers/index.js";
import { diagnoseProviderError } from "../../core/ai/diagnostics/errors.js";
import { getCachedModels } from "../../core/ai/models/cache.js";

export function AIDiagnosticsPage({ isActive }) {
    const { theme, state, actions } = useStore();
    const [results, setResults] = useState(null);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(null);
    const detailW = useDetailWidth(44);

    const config = loadConfig();
    const providerId = config.aiProvider && config.aiProvider !== "none" ? config.aiProvider : null;

    async function runDiagnostics() {
        if (!providerId || running) return;
        setRunning(true);
        setResults(null);
        setProgress({ done: 0, total: 7 });
        actions.setBusy({ label: "AI diagnostics" });
        actions.log("AI diagnostics started");

        const workspace = getActiveWorkspace();
        const checks = [];

        // 1. API Key check
        const cred = resolveCredential(providerId, { workspace });
        checks.push({
            name: "API Key",
            status: cred ? "PASS" : "FAIL",
            detail: cred ? `Found via ${cred.source}` : "No key found",
            recovery: !cred ? `devforgekit ai key add ${providerId}` : null
        });
        setProgress((p) => ({ ...p, done: 1 }));

        // 2. Authentication check (try a health call)
        let authStatus = "PASS";
        let authDetail = "Authenticated";
        let authRecovery = null;
        try {
            const provider = getProvider(providerId, { workspace });
            const health = await provider.checkHealth();
            if (!health.ok) {
                authStatus = "FAIL";
                authDetail = health.reason || "Authentication failed";
                authRecovery = `devforgekit ai key test ${providerId}`;
            }
        } catch (err) {
            const diag = diagnoseProviderError(providerId, err);
            authStatus = diag.isKey ? "FAIL" : "WARNING";
            authDetail = diag.message;
            authRecovery = diag.recovery;
        }
        checks.push({ name: "Authentication", status: authStatus, detail: authDetail, recovery: authRecovery });
        setProgress((p) => ({ ...p, done: 2 }));

        // 3. Endpoint check
        const endpoint = config.aiEndpoint || (providerId === "ollama" ? "http://localhost:11434" : providerId === "lmstudio" ? "http://localhost:1234/v1" : "default");
        checks.push({ name: "Endpoint", status: "PASS", detail: endpoint, recovery: null });
        setProgress((p) => ({ ...p, done: 3 }));

        // 4. Network check (same as auth but separate concern)
        checks.push({
            name: "Network",
            status: authStatus === "FAIL" && authDetail.includes("connect") ? "FAIL" : "PASS",
            detail: authStatus === "FAIL" && authDetail.includes("connect") ? "Cannot reach server" : "Reachable",
            recovery: authStatus === "FAIL" && authDetail.includes("connect") ? "Check your network connection" : null
        });
        setProgress((p) => ({ ...p, done: 4 }));

        // 5. Latency check
        let latencyMs;
        try {
            const provider = getProvider(providerId, { workspace });
            const start = Date.now();
            await provider.checkHealth();
            latencyMs = Date.now() - start;
        } catch { latencyMs = null; }
        checks.push({
            name: "Latency",
            status: latencyMs === null ? "WARNING" : latencyMs < 1000 ? "PASS" : latencyMs < 3000 ? "WARNING" : "FAIL",
            detail: latencyMs !== null ? `${latencyMs}ms` : "No response",
            recovery: null
        });
        setProgress((p) => ({ ...p, done: 5 }));

        // 6. Streaming check - the provider client's own real capability
        // flag (this used to be hardcoded to PASS regardless of the
        // provider - streamable in practice for all four today, but a
        // real check now that supportsStreaming actually exists on the
        // returned provider object).
        const streamingProvider = getProvider(providerId, { workspace });
        checks.push({
            name: "Streaming",
            status: streamingProvider.supportsStreaming ? "PASS" : "WARNING",
            detail: streamingProvider.supportsStreaming ? "Supported" : "Not supported by this provider",
            recovery: null
        });
        setProgress((p) => ({ ...p, done: 6 }));

        // 7. Model access check
        const cached = getCachedModels(providerId);
        checks.push({
            name: "Model Access",
            status: cached && cached.models.length > 0 ? "PASS" : "WARNING",
            detail: cached ? `${cached.models.length} models available` : "No model list cached",
            recovery: !cached || cached.models.length === 0 ? `devforgekit ai model list --refresh` : null
        });
        setProgress((p) => ({ ...p, done: 7 }));

        setResults(checks);
        setRunning(false);
        setProgress(null);
        actions.setBusy(null);
        // Same "<Subject>: N% - verdict" shape DoctorPage/CompatibilityPage
        // use for their own post-scan notification, so all three scan-style
        // pages read consistently.
        const passCount = checks.filter((c) => c.status === "PASS").length;
        const failCount = checks.filter((c) => c.status === "FAIL").length;
        const scorePercent = Math.round((passCount / checks.length) * 100);
        const verdict = passCount === checks.length ? "Healthy" : failCount > 0 ? "Issues Found" : "Warnings";
        actions.notify(`AI Diagnostics: ${scorePercent}% - ${verdict}`, passCount === checks.length ? "success" : "warning");
    }

    useEffect(() => {
        if (providerId) runDiagnostics();
    }, [providerId]);

    useInput((input) => {
        if (running || state.typing) return;
        if (input === "s" && providerId) runDiagnostics();
        else if (input === "o") actions.navigate("ai-overview");
        else if (input === "p") actions.navigate("ai-providers");
        else if (input === "a") actions.navigate("ai");
        else if (input === "m") actions.navigate("ai-models");
        else if (input === "k") actions.navigate("ai-credentials");
        else if (input === "h") actions.navigate("ai-history");
        else if (input === "c") actions.navigate("ai-capabilities");
    }, { isActive: Boolean(isActive) && !state.searchOpen && !running });

    const overall = results ? (results.every((r) => r.status === "PASS") ? "Healthy" : results.some((r) => r.status === "FAIL") ? "Issues Found" : "Warnings") : "—";
    const overallColor = overall === "Healthy" ? theme.success : overall === "Issues Found" ? theme.error : overall === "Warnings" ? theme.warning : theme.textMuted;
    const passCount = results ? results.filter((r) => r.status === "PASS").length : 0;
    const failCount = results ? results.filter((r) => r.status === "FAIL").length : 0;
    const warnCount = results ? results.filter((r) => r.status === "WARNING").length : 0;

    const aiConfig = { provider: providerId, model: config.aiModel, endpoint: config.aiEndpoint };

    return h(AIPageWrapper, { page: "ai-diagnostics", config: aiConfig, theme, onNavigate: actions.navigate, showEmpty: true },
        h(Box, { flexGrow: 1 },
            h(Panel, { title: providerId ? `Diagnostics — ${providerLabel(providerId)}` : "Diagnostics", theme, isActive, flexGrow: 1 },
                !providerId ? h(Text, { color: theme.textMuted }, "No provider configured. Press P to choose one.") : null,
                providerId && !results && !running ? h(Box, { flexDirection: "column" },
                    h(Text, { color: theme.text }, `Run diagnostics for ${providerLabel(providerId)}.`),
                    h(Box, { marginTop: 1 }, h(KeyHints, { theme, hints: [["s", "run diagnostics"]] }))
                ) : null,
                running ? h(InstallProgress, { label: "Running diagnostics...", unit: "checks", value: progress.done, total: progress.total, theme }) : null,
                results && !running ? h(Box, { flexDirection: "column" },
                    h(Text, { color: theme.textMuted }, `${passCount} pass, ${warnCount} warn, ${failCount} fail:`),
                    ...results.map((r) => h(Text, {
                        key: r.name,
                        color: statusColor(r.status, theme)
                    }, `  ${r.status.padEnd(8)} ${r.name.padEnd(16)} ${r.detail}${r.recovery ? ` → ${r.recovery}` : ""}`))
                ) : null
            ),
            h(DetailPanel, {
                title: "Summary", theme, width: detailW,
                emptyText: "Run diagnostics first (s).",
                sections: results ? [{
                    labelWidth: 12,
                    pairs: [
                        ["Overall", overall, overallColor],
                        ["Provider", providerLabel(providerId), theme.accent],
                        ["Pass", passCount, theme.success],
                        ["Warn", warnCount, theme.warning],
                        ["Fail", failCount, theme.error]
                    ]
                }] : [],
                hints: results ? [["s", "re-run diagnostics"]] : undefined
            })
        )
    );
}
