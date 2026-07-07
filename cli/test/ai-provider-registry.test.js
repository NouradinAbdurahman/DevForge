import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getProvider, resolveApiKey, requiresApiKey, envVarForProvider, listProviders, KNOWN_PROVIDERS } from "../src/core/ai/providers/index.js";
import { resetBackend, setBackend } from "../src/core/ai/credentials/selector.js";
import { MemoryBackend } from "../src/core/ai/credentials/backends/memory.js";
import { createWorkspace, saveWorkspace } from "../src/core/workspace/store.js";
import { setSecret } from "../src/core/workspace/env.js";

// Each test gets a fresh in-memory backend — zero OS keychain access.
beforeEach(() => {
    setBackend(new MemoryBackend());
});

afterEach(() => {
    resetBackend();
});

function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-ai-provider-registry-test-"));
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

test("requiresApiKey/envVarForProvider are true only for cloud providers, not the two local ones", () => {
    assert.equal(requiresApiKey("openai"), true);
    assert.equal(envVarForProvider("openai"), "OPENAI_API_KEY");
    assert.equal(requiresApiKey("ollama"), false);
    assert.equal(envVarForProvider("ollama"), null);
    assert.equal(requiresApiKey("lmstudio"), false);
});

test("resolveApiKey prefers the provider's own env var over anything else", () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-from-env";
    try {
        assert.equal(resolveApiKey("openai"), "sk-from-env");
    } finally {
        if (original === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = original;
    }
});

test("resolveApiKey falls back to the active workspace's declared secret via ai.apiKeyRef, then to null", async () => {
    await withTempHome(async () => {
        delete process.env.OPENAI_API_KEY;
        assert.equal(resolveApiKey("openai"), null);

        let doc = createWorkspace({ name: "acme", description: "x" });
        doc = setSecret(doc, "MY_OPENAI_KEY", "sk-from-workspace");
        doc.ai.apiKeyRef = "MY_OPENAI_KEY";
        saveWorkspace(doc);

        assert.equal(resolveApiKey("openai", { workspace: doc }), "sk-from-workspace");
    })();
});

test("getProvider throws a clear error for an unknown provider id", () => {
    assert.throws(() => getProvider("not-a-real-provider"), /Unknown AI provider/);
});

test("getProvider builds a client with the right id for every known provider", () => {
    for (const id of KNOWN_PROVIDERS) {
        const provider = getProvider(id, { apiKey: "k" });
        assert.equal(provider.id, id);
        assert.equal(typeof provider.chat, "function");
        assert.equal(typeof provider.stream, "function");
        assert.equal(typeof provider.embeddings, "function");
        assert.equal(typeof provider.listModels, "function");
        assert.equal(typeof provider.checkHealth, "function");
    }
});

test("listProviders reports cloud providers as unconfigured without a key, and local providers as always configured", () => {
    for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"]) {
        delete process.env[key];
    }
    const providers = listProviders();
    const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
    assert.equal(byId.openai.configured, false);
    assert.equal(byId.ollama.configured, true);
    assert.equal(byId.lmstudio.configured, true);
});
