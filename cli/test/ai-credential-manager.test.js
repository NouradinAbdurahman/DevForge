import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    resolveApiKey, resolveCredential, addKey, removeProviderKey,
    hasProviderKey, listAllProviders, exportKeys, importKeys, migrateKeys,
    providerLabel, providerUrl, providerType,
    isSecureStorageAvailable, storageLocation
} from "../src/core/ai/credentials/manager.js";
import { resetBackend, setBackend, getBackend } from "../src/core/ai/credentials/selector.js";
import { MemoryBackend } from "../src/core/ai/credentials/backends/memory.js";
import { KNOWN_PROVIDERS, requiresApiKey, envVarForProvider } from "../src/core/ai/providers/index.js";
import { createWorkspace, saveWorkspace } from "../src/core/workspace/store.js";
import { setSecret } from "../src/core/workspace/env.js";

// Each test gets a fresh in-memory backend. This guarantees zero OS
// keychain access — the core requirement of the PRD.
beforeEach(() => {
    setBackend(new MemoryBackend());
});

afterEach(() => {
    resetBackend();
});

function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-cred-mgr-test-"));
    process.env.HOME = tempHome;
    return async () => {
        try {
            await fn(tempHome);
        } finally {
            process.env.HOME = originalHome;
            rmSync(tempHome, { recursive: true, force: true });
        }
    };
}

// Clear all env vars for cloud providers before each test
function clearEnvVars() {
    for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"]) {
        delete process.env[key];
    }
}

test("providerLabel/providerUrl/providerType return correct metadata for all 7 providers", () => {
    assert.equal(providerLabel("openai"), "OpenAI");
    assert.equal(providerLabel("anthropic"), "Anthropic");
    assert.equal(providerLabel("gemini"), "Google Gemini");
    assert.equal(providerLabel("groq"), "Groq");
    assert.equal(providerLabel("openrouter"), "OpenRouter");
    assert.equal(providerLabel("ollama"), "Ollama");
    assert.equal(providerLabel("lmstudio"), "LM Studio");
    assert.equal(providerType("ollama"), "local");
    assert.equal(providerType("openai"), "cloud");
    assert.ok(providerUrl("openai"));
    assert.equal(providerUrl("ollama"), "https://ollama.ai");
});

test("isSecureStorageAvailable returns boolean and storageLocation returns a string", () => {
    assert.equal(typeof isSecureStorageAvailable(), "boolean");
    assert.equal(typeof storageLocation(), "string");
});

test("addKey/loadKey/removeKey round-trip for a cloud provider", async () => {
    await withTempHome(async () => {
        clearEnvVars();
        addKey("openai", "sk-test-123");
        assert.equal(resolveApiKey("openai"), "sk-test-123");
        assert.ok(hasProviderKey("openai"));
        const removed = removeProviderKey("openai");
        assert.ok(removed);
        assert.equal(resolveApiKey("openai"), null);
        assert.equal(hasProviderKey("openai"), false);
    })();
});

test("addKey throws for local providers (no key needed)", async () => {
    await withTempHome(async () => {
        assert.throws(() => addKey("ollama", "fake-key"), /local provider/);
        assert.throws(() => addKey("lmstudio", "fake-key"), /local provider/);
    })();
});

test("addKey throws for empty/invalid key", async () => {
    await withTempHome(async () => {
        assert.throws(() => addKey("openai", ""), /non-empty string/);
        assert.throws(() => addKey("openai", null), /non-empty string/);
        assert.throws(() => addKey("openai", 123), /non-empty string/);
    })();
});

test("resolveCredential returns source='keychain' when key is in credential store", async () => {
    await withTempHome(async () => {
        clearEnvVars();
        addKey("openai", "sk-from-keychain");
        const result = resolveCredential("openai");
        assert.equal(result.source, "keychain");
        assert.equal(result.value, "sk-from-keychain");
    })();
});

test("resolveCredential falls back to env var when no keychain key", async () => {
    await withTempHome(async () => {
        clearEnvVars();
        process.env.OPENAI_API_KEY = "sk-from-env";
        const result = resolveCredential("openai");
        assert.equal(result.source, "env");
        assert.equal(result.value, "sk-from-env");
        delete process.env.OPENAI_API_KEY;
    })();
});

test("resolveCredential prefers workspace secret over keychain and env", async () => {
    await withTempHome(async () => {
        clearEnvVars();
        addKey("openai", "sk-from-keychain");
        process.env.OPENAI_API_KEY = "sk-from-env";

        let doc = createWorkspace({ name: "test-ws", description: "x" });
        doc = setSecret(doc, "MY_KEY", "sk-from-workspace");
        doc.ai.apiKeyRef = "MY_KEY";
        saveWorkspace(doc);

        const result = resolveCredential("openai", { workspace: doc });
        assert.equal(result.source, "workspace");
        assert.equal(result.value, "sk-from-workspace");
    })();
});

test("resolveCredential returns null when no key is found from any source", async () => {
    await withTempHome(async () => {
        clearEnvVars();
        const result = resolveCredential("openai");
        assert.equal(result, null);
    })();
});

test("resolveCredential returns source='local' for local providers", () => {
    clearEnvVars();
    const result = resolveCredential("ollama");
    assert.equal(result.source, "local");
    assert.equal(result.value, null);
});

test("listAllProviders returns all 7 providers with correct status", async () => {
    await withTempHome(async () => {
        clearEnvVars();
        addKey("openai", "sk-test");
        const providers = listAllProviders({});
        assert.equal(providers.length, 7);
        const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
        assert.ok(byId.openai.hasKey);
        assert.equal(byId.openai.source, "keychain");
        assert.ok(!byId.anthropic.hasKey);
        assert.ok(byId.ollama.hasKey); // local = always true
        assert.equal(byId.ollama.source, "local");
    })();
});

test("exportKeys returns only keys in the credential store", async () => {
    await withTempHome(async () => {
        clearEnvVars();
        addKey("openai", "sk-1");
        addKey("anthropic", "sk-2");
        const keys = exportKeys();
        assert.equal(keys.length, 2);
        const ids = keys.map((k) => k.providerId).sort();
        assert.deepEqual(ids, ["anthropic", "openai"]);
    })();
});

test("importKeys imports valid entries and skips invalid ones", async () => {
    await withTempHome(async () => {
        clearEnvVars();
        const result = importKeys([
            { providerId: "openai", apiKey: "sk-imported" },
            { providerId: "anthropic", apiKey: "sk-imported-2" },
            { providerId: "ollama", apiKey: "not-needed" }, // skipped: local
            { providerId: "not-real", apiKey: "x" }, // skipped: unknown
            { providerId: "gemini", apiKey: "" } // skipped: empty
        ]);
        assert.equal(result.imported, 2);
        assert.equal(result.skipped, 3);
        assert.equal(resolveApiKey("openai"), "sk-imported");
        assert.equal(resolveApiKey("anthropic"), "sk-imported-2");
    })();
});

test("migrateKeys moves env vars to credential store", async () => {
    await withTempHome(async () => {
        clearEnvVars();
        process.env.OPENAI_API_KEY = "sk-migrate-me";
        process.env.ANTHROPIC_API_KEY = "sk-migrate-me-2";
        const result = migrateKeys();
        assert.equal(result.migrated, 2);
        // Keys should now be in the credential store
        assert.equal(resolveApiKey("openai"), "sk-migrate-me");
        assert.equal(resolveApiKey("anthropic"), "sk-migrate-me-2");
        // Running again should skip (already in store)
        const result2 = migrateKeys();
        assert.equal(result2.migrated, 0);
        delete process.env.OPENAI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
    })();
});

test("removeProviderKey returns false when no key exists", async () => {
    await withTempHome(async () => {
        clearEnvVars();
        const removed = removeProviderKey("openai");
        assert.equal(removed, false);
    })();
});

test("hasProviderKey returns true for local providers without any key", () => {
    clearEnvVars();
    assert.ok(hasProviderKey("ollama"));
    assert.ok(hasProviderKey("lmstudio"));
});
