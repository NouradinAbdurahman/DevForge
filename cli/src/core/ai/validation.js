// AI configuration validation and health status. This module is the
// single source of truth for "is the AI configuration valid?" It checks
// provider existence, model validity, API key availability, and endpoint
// reachability. Used by:
//   - Startup validation (Phase 2)
//   - AI status display (Phase 3)
//   - `ai status` command (Phase 8)
//   - Provider/model consistency checks (Phase 1)
//   - Automatic repair recommendations (Phase 9)
import { loadConfig, setConfigValue } from "../config.js";
import { getActiveWorkspace } from "../workspace/store.js";
import { KNOWN_PROVIDERS, requiresApiKey } from "./providers/index.js";
import {
    resolveCredential, providerLabel,
    isSecureStorageAvailable, storageLocation
} from "./credentials/manager.js";
import { getCachedModels } from "./models/cache.js";

const DEFAULT_MODEL_BY_PROVIDER = {
    openai: "gpt-4o-mini",
    anthropic: "claude-3-5-sonnet-latest",
    gemini: "gemini-1.5-flash",
    groq: "llama-3.1-8b-instant",
    openrouter: "openai/gpt-4o-mini",
    ollama: "llama3",
    lmstudio: "local-model"
};

// validateAIConfig() -> { valid, issues[], config, recommendations[] }
// Synchronous validation — no network calls. Checks:
//   1. Provider exists and is known
//   2. Model is set (or defaults to provider default)
//   3. API key is available (for cloud providers)
//   4. Credential backend is operational
// Returns a structured report. Does NOT modify config.
export function validateAIConfig() {
    const config = loadConfig();
    const workspace = getActiveWorkspace();
    const issues = [];
    const recommendations = [];

    const providerId = config.aiProvider && config.aiProvider !== "none" ? config.aiProvider : null;
    const model = config.aiModel || null;
    const endpoint = config.aiEndpoint || null;

    // 1. Provider check
    if (!providerId) {
        issues.push({ field: "provider", severity: "error", message: "No AI provider configured." });
        recommendations.push({ action: "setup", command: "devforgekit ai setup", message: "Run the AI setup wizard." });
        return { valid: false, issues, config: { provider: null, model, endpoint }, recommendations };
    }

    if (!KNOWN_PROVIDERS.includes(providerId)) {
        issues.push({ field: "provider", severity: "error", message: `Unknown provider '${providerId}'. Known: ${KNOWN_PROVIDERS.join(", ")}` });
        recommendations.push({ action: "setup", command: "devforgekit ai setup", message: "Run setup to choose a valid provider." });
        return { valid: false, issues, config: { provider: providerId, model, endpoint }, recommendations };
    }

    // 2. Model check — if model is set, verify it's plausible for the provider.
    // We can't check against the live model list synchronously, but we can
    // catch obvious mismatches (e.g. model from a different provider).
    if (model) {
        const modelIssue = checkModelConsistency(providerId, model);
        if (modelIssue) {
            issues.push(modelIssue);
            recommendations.push({
                action: "reset-model",
                command: `devforgekit ai model use ${DEFAULT_MODEL_BY_PROVIDER[providerId]}`,
                message: `Reset model to ${providerLabel(providerId)}'s default: ${DEFAULT_MODEL_BY_PROVIDER[providerId]}`
            });
        }
    }

    // 3. API key check (cloud providers only)
    let keyAvailable = false;
    let keySource = null;
    if (requiresApiKey(providerId)) {
        const cred = resolveCredential(providerId, { workspace });
        if (cred) {
            keyAvailable = true;
            keySource = cred.source;
        } else {
            issues.push({
                field: "apiKey",
                severity: "error",
                message: `No API key found for ${providerLabel(providerId)}.`
            });
            recommendations.push({
                action: "add-key",
                command: `devforgekit ai key add ${providerId}`,
                message: `Add your ${providerLabel(providerId)} API key.`
            });
        }
    } else {
        keyAvailable = true;
        keySource = "local";
    }

    // 4. Credential backend check
    const backendOk = isSecureStorageAvailable();
    if (!backendOk) {
        issues.push({
            field: "backend",
            severity: "warning",
            message: `Credential backend (${storageLocation()}) is not fully operational.`
        });
        recommendations.push({
            action: "check-backend",
            command: "devforgekit ai status",
            message: "Run 'ai status' for details on credential storage."
        });
    }

    // 5. Cached models check
    const cached = providerId ? getCachedModels(providerId) : null;
    const modelCount = cached ? cached.models.length : null;

    // 6. Model consistency: if we have cached models, verify the current model is in the list
    if (model && cached && cached.models.length > 0 && !cached.models.includes(model)) {
        issues.push({
            field: "model",
            severity: "warning",
            message: `Model '${model}' is not in the cached model list for ${providerLabel(providerId)}.`
        });
        recommendations.push({
            action: "reset-model",
            command: `devforgekit ai model use ${DEFAULT_MODEL_BY_PROVIDER[providerId]}`,
            message: `Model may be invalid. Reset to default: ${DEFAULT_MODEL_BY_PROVIDER[providerId]}`
        });
    }

    const valid = issues.length === 0 || issues.every((i) => i.severity === "warning");

    return {
        valid,
        issues,
        config: {
            provider: providerId,
            model: model || DEFAULT_MODEL_BY_PROVIDER[providerId] || null,
            modelIsDefault: !model,
            endpoint,
            keyAvailable,
            keySource,
            backendOk,
            backendLocation: storageLocation(),
            modelCount,
            defaultModel: DEFAULT_MODEL_BY_PROVIDER[providerId] || null
        },
        recommendations
    };
}

// checkModelConsistency(providerId, model) -> issue | null
// Heuristic check: catches obvious cross-provider model mismatches
// without a network call. E.g. "claude-opus" under "openai" provider.
export function checkModelConsistency(providerId, model) {
    const lower = model.toLowerCase();

    // Local providers (ollama, lmstudio) can serve any model — they're
    // model-agnostic runtimes. OpenRouter also supports all providers' models.
    if (providerId === "ollama" || providerId === "lmstudio" || providerId === "openrouter") {
        return null;
    }

    // Provider-specific model prefixes/names that strongly indicate
    // the model belongs to a different provider
    const crossProviderPatterns = [
        { pattern: /^claude/, owner: "anthropic", label: "Anthropic Claude" },
        { pattern: /^gpt/, owner: "openai", label: "OpenAI GPT" },
        { pattern: /^gemini/, owner: "gemini", label: "Google Gemini" },
        { pattern: /^o1-|^o3-|^o4-/, owner: "openai", label: "OpenAI o-series" }
    ];

    for (const { pattern, owner, label } of crossProviderPatterns) {
        if (pattern.test(lower) && owner !== providerId && owner !== "openrouter") {
            // OpenRouter can use any provider's models
            if (providerId === "openrouter") continue;
            return {
                field: "model",
                severity: "warning",
                message: `Model '${model}' appears to be a ${label} model, but the active provider is ${providerLabel(providerId)}.`
            };
        }
    }

    return null;
}

// AI_HEALTH_TONE / aiHealthTone(status) -> one canonical severity mapping
// for aiHealthStatus()'s `status` field, so every surface that displays it
// (DashboardPage's AI card, AIStatusBar, AIStatusCard, `devforgekit ai
// status`) agrees on which statuses read as success/warning/error instead
// of each hand-rolling its own ternary (three of them used to, and two
// disagreed about "invalid-provider"). Returns a theme role name
// ("success"/"warning"/"error") - callers index their theme with it
// (`theme[aiHealthTone(status)]`).
export const AI_HEALTH_TONE = {
    ready: "success",
    "not-configured": "error",
    "missing-key": "warning",
    "invalid-model": "warning",
    "invalid-provider": "error",
    "backend-issue": "warning",
    error: "error"
};

export function aiHealthTone(status) {
    return AI_HEALTH_TONE[status] || "warning";
}

// aiHealthStatus() -> { status, color, label, detail }
// Returns a compact status for display in the TUI status bar and dashboard.
// status is one of: "ready", "not-configured", "missing-key", "invalid-model",
// "backend-issue", "unknown".
export function aiHealthStatus() {
    const report = validateAIConfig();
    const cfg = report.config;

    if (!cfg.provider) {
        return { status: "not-configured", label: "Not Configured", detail: "Run 'devforgekit ai setup'" };
    }

    const errorIssues = report.issues.filter((i) => i.severity === "error");
    if (errorIssues.length > 0) {
        const first = errorIssues[0];
        if (first.field === "apiKey") {
            return { status: "missing-key", label: "Missing API Key", detail: `devforgekit ai key add ${cfg.provider}` };
        }
        if (first.field === "provider") {
            return { status: "invalid-provider", label: "Provider Misconfigured", detail: "Run 'devforgekit ai setup'" };
        }
        return { status: "error", label: "Error", detail: first.message };
    }

    const warnIssues = report.issues.filter((i) => i.severity === "warning");
    if (warnIssues.length > 0) {
        const first = warnIssues[0];
        if (first.field === "model") {
            return { status: "invalid-model", label: "Invalid Model", detail: first.message };
        }
        if (first.field === "backend") {
            return { status: "backend-issue", label: "Backend Issue", detail: first.message };
        }
    }

    return { status: "ready", label: "Ready", detail: `${providerLabel(cfg.provider)} · ${cfg.model || "default"}` };
}

// autoRepairConfig() -> { repairs[], applied }
// Automatically fixes simple configuration issues without user interaction:
//   - Missing model → set to provider default
//   - Invalid model (cross-provider) → set to provider default
// Does NOT fix missing API keys (requires user input).
export function autoRepairConfig() {
    const report = validateAIConfig();
    const repairs = [];

    // Auto-fix: missing or invalid model
    if (report.config.provider && report.config.defaultModel) {
        const modelIssue = report.issues.find((i) => i.field === "model");
        if (modelIssue) {
            setConfigValue("aiModel", report.config.defaultModel);
            repairs.push({
                field: "model",
                from: report.config.model,
                to: report.config.defaultModel,
                reason: modelIssue.message
            });
        }
    }

    return { repairs, applied: repairs.length > 0 };
}

// getAIStatusReport() -> full status object for `ai status` command and TUI
// This is the comprehensive report that includes everything visible to the user.
export function getAIStatusReport() {
    const validation = validateAIConfig();
    const cfg = validation.config;
    const cached = cfg.provider ? getCachedModels(cfg.provider) : null;

    return {
        provider: cfg.provider ? {
            id: cfg.provider,
            label: providerLabel(cfg.provider),
            configured: true
        } : null,
        model: cfg.model || null,
        modelIsDefault: cfg.modelIsDefault,
        endpoint: cfg.endpoint || null,
        credentialBackend: {
            location: cfg.backendLocation,
            operational: cfg.backendOk
        },
        apiKey: {
            available: cfg.keyAvailable,
            source: cfg.keySource
        },
        models: {
            cached: cached !== null,
            count: cached ? cached.models.length : 0,
            age: cached ? cached.age : null
        },
        validation: {
            valid: validation.valid,
            issues: validation.issues,
            recommendations: validation.recommendations
        },
        health: aiHealthStatus()
    };
}
