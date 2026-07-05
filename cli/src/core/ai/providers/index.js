// Provider registry: which providers exist, how to resolve their API key,
// and how to build a real client for one. The single place that knows
// about every provider - callers (commands/ai.js, chat/session.js,
// diagnostics/doctor.js, planner/planner.js) never construct a provider
// client directly.
import { createOpenAICompatibleProvider } from "./openaiCompatible.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createGeminiProvider } from "./gemini.js";
import { createOllamaProvider } from "./ollama.js";
import { getSecret } from "../../workspace/env.js";
import { DevForgeError } from "../../errors.js";

// Matches workspace.schema.json's `ai.provider` enum plus "lmstudio" (the
// PRD's own LM Studio entry - workspace's schema groups it under "local").
export const KNOWN_PROVIDERS = ["openai", "anthropic", "gemini", "groq", "openrouter", "ollama", "lmstudio"];

// Only cloud providers need a key - ollama/lmstudio are local servers.
const ENV_VAR_BY_PROVIDER = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
    groq: "GROQ_API_KEY",
    openrouter: "OPENROUTER_API_KEY"
};

const DEFAULT_MODEL_BY_PROVIDER = {
    openai: "gpt-4o-mini",
    anthropic: "claude-3-5-sonnet-latest",
    gemini: "gemini-1.5-flash",
    groq: "llama-3.1-8b-instant",
    openrouter: "openai/gpt-4o-mini",
    ollama: "llama3",
    lmstudio: "local-model"
};

export function requiresApiKey(providerId) {
    return Boolean(ENV_VAR_BY_PROVIDER[providerId]);
}

export function envVarForProvider(providerId) {
    return ENV_VAR_BY_PROVIDER[providerId] || null;
}

// resolveApiKey(providerId, opts) -> string | null. Resolution order: the
// provider's own env var -> the active workspace's declared secret named
// by `ai.apiKeyRef` (core/workspace/env.js's real AES-256-GCM store) ->
// null ("not configured"). Never guesses, never falls back to a fake key.
export function resolveApiKey(providerId, { workspace, apiKeyRef } = {}) {
    const envVar = ENV_VAR_BY_PROVIDER[providerId];
    if (envVar && process.env[envVar]) return process.env[envVar];

    const ref = apiKeyRef || workspace?.ai?.apiKeyRef;
    if (workspace && ref) {
        const value = getSecret(workspace, ref);
        if (value) return value;
    }
    return null;
}

// getProvider(providerId, opts) -> AIProvider (see providers/base.js).
// `apiKey`/`model`/`endpoint` override auto-resolution; `workspace` feeds
// resolveApiKey when `apiKey` isn't given explicitly. `fetchImpl` is an
// optional passthrough (defaults to each factory's own global `fetch`) -
// the same dependency-injection convention as every provider factory
// itself, so tests can exercise the real getProvider()/command-layer
// wiring against an injected fake instead of a real network call. Throws
// a clear DevForgeError for an unknown provider id - never silently falls
// back to a different one.
export function getProvider(providerId, { apiKey, model, endpoint, workspace, fetchImpl } = {}) {
    const resolvedKey = apiKey ?? resolveApiKey(providerId, { workspace });
    const resolvedModel = model || DEFAULT_MODEL_BY_PROVIDER[providerId];
    const fetchOverride = fetchImpl ? { fetchImpl } : {};

    switch (providerId) {
        case "openai":
            return createOpenAICompatibleProvider({
                id: "openai", baseUrl: endpoint || "https://api.openai.com/v1", apiKey: resolvedKey,
                model: resolvedModel, embeddingsModel: "text-embedding-3-small", supportsEmbeddings: true, ...fetchOverride
            });
        case "groq":
            return createOpenAICompatibleProvider({ id: "groq", baseUrl: endpoint || "https://api.groq.com/openai/v1", apiKey: resolvedKey, model: resolvedModel, ...fetchOverride });
        case "openrouter":
            return createOpenAICompatibleProvider({
                id: "openrouter", baseUrl: endpoint || "https://openrouter.ai/api/v1", apiKey: resolvedKey, model: resolvedModel,
                extraHeaders: { "HTTP-Referer": "https://devforgekit.dev", "X-Title": "DevForgeKit" }, ...fetchOverride
            });
        case "lmstudio":
            return createOpenAICompatibleProvider({ id: "lmstudio", baseUrl: endpoint || "http://localhost:1234/v1", apiKey: resolvedKey || "not-needed", model: resolvedModel, ...fetchOverride });
        case "anthropic":
            return createAnthropicProvider({ apiKey: resolvedKey, model: resolvedModel, ...(endpoint ? { baseUrl: endpoint } : {}), ...fetchOverride });
        case "gemini":
            return createGeminiProvider({ apiKey: resolvedKey, model: resolvedModel, ...(endpoint ? { baseUrl: endpoint } : {}), ...fetchOverride });
        case "ollama":
            return createOllamaProvider({ model: resolvedModel, baseUrl: endpoint || "http://localhost:11434", ...fetchOverride });
        default:
            throw new DevForgeError(`Unknown AI provider '${providerId}'. Known providers: ${KNOWN_PROVIDERS.join(", ")}`);
    }
}

// listProviders() -> [{ id, requiresApiKey, defaultModel, configured }] -
// `configured` is true only when a real key is resolvable for cloud
// providers, or always true for the two local ones (nothing to configure
// beyond having the server running, which `checkHealth` reports on
// separately).
export function listProviders({ workspace } = {}) {
    return KNOWN_PROVIDERS.map((id) => ({
        id,
        requiresApiKey: requiresApiKey(id),
        defaultModel: DEFAULT_MODEL_BY_PROVIDER[id],
        configured: requiresApiKey(id) ? Boolean(resolveApiKey(id, { workspace })) : true
    }));
}
