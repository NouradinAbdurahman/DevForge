// Unified AI credential manager: the single entry point for storing,
// resolving, listing, and testing API keys across all providers.
//
// Resolution order (per the PRD, Phase 4):
//   1. Workspace secret (via workspace.ai.apiKeyRef)
//   2. OS secure credential store (backend abstraction)
//   3. Environment variable (e.g. OPENAI_API_KEY)
//   4. Fail with explanation (never return null silently in command context)
//
// This module is the one place that knows about all three sources. The
// existing providers/index.js resolveApiKey() is updated to delegate here.
//
// The storage backend is selected automatically by selector.js based on
// the runtime environment (test → memory, CI → mock, macOS → keychain,
// fallback → file). This module never calls `security` or any OS API
// directly — only through the backend interface.
import { KNOWN_PROVIDERS, requiresApiKey, envVarForProvider } from "../providers/index.js";
import { getSecret } from "../../workspace/env.js";
import { getBackend } from "./selector.js";

// Provider metadata for display (labels, descriptions, URLs).
const PROVIDER_META = {
    openai: { label: "OpenAI", url: "https://platform.openai.com/api-keys", type: "cloud" },
    anthropic: { label: "Anthropic", url: "https://console.anthropic.com/settings/keys", type: "cloud" },
    gemini: { label: "Google Gemini", url: "https://aistudio.google.com/app/apikey", type: "cloud" },
    groq: { label: "Groq", url: "https://console.groq.com/keys", type: "cloud" },
    openrouter: { label: "OpenRouter", url: "https://openrouter.ai/keys", type: "cloud" },
    ollama: { label: "Ollama", url: "https://ollama.ai", type: "local" },
    lmstudio: { label: "LM Studio", url: "https://lmstudio.ai", type: "local" }
};

export function providerLabel(id) {
    return PROVIDER_META[id]?.label || id;
}

export function providerUrl(id) {
    return PROVIDER_META[id]?.url || null;
}

export function providerType(id) {
    return PROVIDER_META[id]?.type || "cloud";
}

// resolveCredential(providerId, opts) -> { source, value } | null.
// Checks all three sources in the standardized order. `source` is one of
// "workspace", "keychain", "env". Returns null if no key is found.
export function resolveCredential(providerId, { workspace, apiKeyRef } = {}) {
    if (!requiresApiKey(providerId)) return { source: "local", value: null };

    // 1. Workspace secret
    const ref = apiKeyRef || workspace?.ai?.apiKeyRef;
    if (workspace && ref) {
        const value = getSecret(workspace, ref);
        if (value) return { source: "workspace", value };
    }

    // 2. OS secure credential store (via backend abstraction)
    const stored = getBackend().get(providerId);
    if (stored) return { source: "keychain", value: stored };

    // 3. Environment variable
    const envVar = envVarForProvider(providerId);
    if (envVar && process.env[envVar]) return { source: "env", value: process.env[envVar] };

    // 4. Not found
    return null;
}

// resolveApiKey(providerId, opts) -> string | null. Convenience wrapper
// around resolveCredential that returns just the key value. This replaces
// the old resolveApiKey in providers/index.js.
export function resolveApiKey(providerId, opts = {}) {
    const result = resolveCredential(providerId, opts);
    return result?.value || null;
}

// addKey(providerId, apiKey) -> void. Stores the key in the OS keychain
// (or file fallback). For local providers, this is a no-op (no key needed).
export function addKey(providerId, apiKey) {
    if (!requiresApiKey(providerId)) {
        throw new Error(`${providerLabel(providerId)} is a local provider — no API key needed.`);
    }
    if (!apiKey || typeof apiKey !== "string") {
        throw new Error("API key must be a non-empty string.");
    }
    getBackend().set(providerId, apiKey);
}

// removeProviderKey(providerId) -> boolean. Removes the key from the
// keychain/file store. Returns true if a key was removed.
export function removeProviderKey(providerId) {
    return getBackend().remove(providerId);
}

// hasProviderKey(providerId, opts) -> boolean. Checks whether a key is
// available from any source.
export function hasProviderKey(providerId, opts = {}) {
    if (!requiresApiKey(providerId)) return true;
    return resolveCredential(providerId, opts) !== null;
}

// credentialSource(providerId, opts) -> string | null. Returns the source
// name ("workspace", "keychain", "env", "local") without the key value.
export function credentialSource(providerId, opts = {}) {
    const result = resolveCredential(providerId, opts);
    if (!result) return null;
    return result.source;
}

// listAllProviders(opts) -> [{ id, label, type, requiresKey, hasKey, source, defaultModel }]
// Full status report for `ai key list` and the TUI.
export function listAllProviders({ workspace } = {}) {
    const stored = getBackend().list();
    return KNOWN_PROVIDERS.map((id) => {
        const meta = PROVIDER_META[id] || { label: id, type: "cloud" };
        const needsKey = requiresApiKey(id);
        let source = null;
        let keyPresent = false;

        if (!needsKey) {
            source = "local";
            keyPresent = true;
        } else {
            const result = resolveCredential(id, { workspace });
            if (result) {
                source = result.source;
                keyPresent = true;
            }
        }

        return {
            id,
            label: meta.label,
            type: meta.type,
            requiresKey: needsKey,
            hasKey: keyPresent,
            source,
            storedInKeychain: stored.includes(id),
            keyUrl: meta.url
        };
    });
}

// exportKeys() -> [{ providerId, apiKey }]. Exports all keys from the
// keychain/file store (NOT from env vars or workspace secrets — those are
// already portable). Used by `ai key export`.
export function exportKeys() {
    const backend = getBackend();
    const stored = backend.list();
    return stored.map((id) => ({ providerId: id, apiKey: backend.get(id) }));
}

// importKeys(entries) -> { imported, skipped }. Imports keys from an
// export file. Used by `ai key import`.
export function importKeys(entries) {
    let imported = 0;
    let skipped = 0;
    for (const entry of entries) {
        if (!KNOWN_PROVIDERS.includes(entry.providerId)) {
            skipped++;
            continue;
        }
        if (!requiresApiKey(entry.providerId)) {
            skipped++;
            continue;
        }
        if (!entry.apiKey || typeof entry.apiKey !== "string") {
            skipped++;
            continue;
        }
        getBackend().set(entry.providerId, entry.apiKey);
        imported++;
    }
    return { imported, skipped };
}

// migrateKeys() -> { migrated, skipped }. Migrates keys from env vars
// to the keychain/file store, so they survive shell changes and are
// managed by `ai key` commands. Used by `ai key migrate`.
export function migrateKeys() {
    const backend = getBackend();
    let migrated = 0;
    let skipped = 0;
    for (const id of KNOWN_PROVIDERS) {
        if (!requiresApiKey(id)) { skipped++; continue; }
        const envVar = envVarForProvider(id);
        if (!envVar || !process.env[envVar]) { skipped++; continue; }
        if (backend.exists(id)) { skipped++; continue; } // already stored
        backend.set(id, process.env[envVar]);
        migrated++;
    }
    return { migrated, skipped };
}

// isSecureStorageAvailable() -> boolean. True when the credential backend
// reports its storage is operational (keychain unlocked, file writable, etc.).
export function isSecureStorageAvailable() {
    return getBackend().test().ok;
}

// storageLocation() -> string. Human-readable description of where keys
// are stored, for display in `ai key list` and the TUI.
export function storageLocation() {
    return getBackend().location();
}
