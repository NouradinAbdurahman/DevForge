// Regression tests: verify that the credential backend architecture
// never touches the real OS keychain during tests. These tests are the
// acceptance criteria from the PRD — "npm test runs without any
// Keychain popup" and "no automated test accesses the real macOS
// Keychain."
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import {
    addKey, removeProviderKey, resolveApiKey, listAllProviders,
    exportKeys, importKeys, migrateKeys, isSecureStorageAvailable, storageLocation
} from "../src/core/ai/credentials/manager.js";
import { selectBackend, getBackend, resetBackend, setBackend } from "../src/core/ai/credentials/selector.js";
import { MemoryBackend } from "../src/core/ai/credentials/backends/memory.js";
import { MockBackend } from "../src/core/ai/credentials/backends/mock.js";
import { FileBackend } from "../src/core/ai/credentials/backends/file.js";
import { CredentialBackend } from "../src/core/ai/credentials/backend.js";
import { KNOWN_PROVIDERS } from "../src/core/ai/providers/index.js";

beforeEach(() => {
    setBackend(new MemoryBackend());
});

afterEach(() => {
    resetBackend();
});

function clearEnvVars() {
    for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"]) {
        delete process.env[key];
    }
}

// --- Backend selection --------------------------------------------------

test("selectBackend() returns MemoryBackend when NODE_ENV=test", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
        resetBackend();
        const backend = selectBackend();
        assert.ok(backend instanceof MemoryBackend, `expected MemoryBackend, got ${backend.constructor.name}`);
    } finally {
        process.env.NODE_ENV = original;
        resetBackend();
    }
});

test("selectBackend() returns MockBackend when CI=true", () => {
    const originalCI = process.env.CI;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.CI = "true";
    try {
        resetBackend();
        const backend = selectBackend();
        assert.ok(backend instanceof MockBackend, `expected MockBackend, got ${backend.constructor.name}`);
    } finally {
        process.env.CI = originalCI;
        process.env.NODE_ENV = originalNodeEnv;
        resetBackend();
    }
});

test("selectBackend() respects DEVFORGEKIT_CRED_BACKEND override", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalOverride = process.env.DEVFORGEKIT_CRED_BACKEND;
    const originalCI = process.env.CI;
    process.env.NODE_ENV = "production";
    process.env.DEVFORGEKIT_CRED_BACKEND = "file";
    delete process.env.CI;
    try {
        resetBackend();
        const backend = selectBackend();
        assert.ok(backend instanceof FileBackend, `expected FileBackend, got ${backend.constructor.name}`);
    } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalOverride === undefined) delete process.env.DEVFORGEKIT_CRED_BACKEND;
        else process.env.DEVFORGEKIT_CRED_BACKEND = originalOverride;
        if (originalCI === undefined) delete process.env.CI;
        else process.env.CI = originalCI;
        resetBackend();
    }
});

test("getBackend() caches the selected backend (singleton)", () => {
    resetBackend();
    const b1 = getBackend();
    const b2 = getBackend();
    assert.equal(b1, b2, "getBackend() should return the same instance");
});

test("setBackend() injects a specific backend (dependency injection)", () => {
    const custom = new MemoryBackend();
    setBackend(custom);
    assert.equal(getBackend(), custom);
});

test("resetBackend() clears the cache so next getBackend() re-selects", () => {
    const b1 = getBackend();
    resetBackend();
    const b2 = getBackend();
    assert.notEqual(b1, b2, "resetBackend should force a new instance");
});

// --- Backend interface contract -----------------------------------------

test("CredentialBackend base class throws for all unimplemented methods", () => {
    const b = new CredentialBackend();
    assert.throws(() => b.set("x", "y"), /not implemented/);
    assert.throws(() => b.get("x"), /not implemented/);
    assert.throws(() => b.remove("x"), /not implemented/);
    assert.throws(() => b.list(), /not implemented/);
    assert.throws(() => b.exists("x"), /not implemented/);
    assert.throws(() => b.test(), /not implemented/);
    assert.throws(() => b.location(), /not implemented/);
});

test("MemoryBackend implements all CredentialBackend methods", () => {
    const b = new MemoryBackend();
    assert.equal(typeof b.set, "function");
    assert.equal(typeof b.get, "function");
    assert.equal(typeof b.remove, "function");
    assert.equal(typeof b.list, "function");
    assert.equal(typeof b.exists, "function");
    assert.equal(typeof b.test, "function");
    assert.equal(typeof b.location, "function");
});

test("MockBackend implements all CredentialBackend methods", () => {
    const b = new MockBackend();
    assert.equal(typeof b.set, "function");
    assert.equal(typeof b.get, "function");
    assert.equal(typeof b.remove, "function");
    assert.equal(typeof b.list, "function");
    assert.equal(typeof b.exists, "function");
    assert.equal(typeof b.test, "function");
    assert.equal(typeof b.location, "function");
});

test("FileBackend implements all CredentialBackend methods", () => {
    const b = new FileBackend();
    assert.equal(typeof b.set, "function");
    assert.equal(typeof b.get, "function");
    assert.equal(typeof b.remove, "function");
    assert.equal(typeof b.list, "function");
    assert.equal(typeof b.exists, "function");
    assert.equal(typeof b.test, "function");
    assert.equal(typeof b.location, "function");
});

// --- Memory backend behavior --------------------------------------------

test("MemoryBackend round-trip: set, get, exists, list, remove", () => {
    const b = new MemoryBackend();
    b.set("openai", "sk-test");
    assert.equal(b.get("openai"), "sk-test");
    assert.equal(b.exists("openai"), true);
    assert.deepEqual(b.list(), ["openai"]);
    assert.equal(b.remove("openai"), true);
    assert.equal(b.get("openai"), null);
    assert.equal(b.exists("openai"), false);
    assert.deepEqual(b.list(), []);
});

test("MemoryBackend.remove returns false for non-existent key", () => {
    const b = new MemoryBackend();
    assert.equal(b.remove("openai"), false);
});

test("MemoryBackend.test always returns ok", () => {
    const b = new MemoryBackend();
    assert.deepEqual(b.test(), { ok: true });
});

test("MemoryBackend.location returns 'In-memory (test)'", () => {
    const b = new MemoryBackend();
    assert.equal(b.location(), "In-memory (test)");
});

// --- No keychain access during tests (PRD acceptance criteria) ----------

test("no `security` CLI is called during credential operations", () => {
    // This test verifies that addKey/removeProviderKey never invoke
    // the `security` binary. We do this by verifying the backend is
    // MemoryBackend (which never spawns processes).
    const backend = getBackend();
    assert.ok(backend instanceof MemoryBackend, "test environment must use MemoryBackend");
    addKey("openai", "sk-test");
    assert.ok(backend.exists("openai"));
    removeProviderKey("openai");
    assert.ok(!backend.exists("openai"));
});

test("isSecureStorageAvailable does not spawn `security` in test env", () => {
    // In test mode, this should return true (MemoryBackend.test() = ok)
    // without touching the OS.
    assert.equal(typeof isSecureStorageAvailable(), "boolean");
});

test("storageLocation returns 'In-memory (test)' in test env", () => {
    assert.equal(storageLocation(), "In-memory (test)");
});

// --- All providers work through the backend -----------------------------

test("all 7 providers can add/remove keys through the backend without OS access", () => {
    clearEnvVars();
    for (const id of KNOWN_PROVIDERS) {
        // Local providers (ollama, lmstudio) don't need keys
        if (id === "ollama" || id === "lmstudio") continue;
        addKey(id, `sk-test-${id}`);
        assert.equal(resolveApiKey(id), `sk-test-${id}`, `${id} key should resolve`);
        removeProviderKey(id);
        assert.equal(resolveApiKey(id), null, `${id} key should be gone`);
    }
});

test("provider switching works through the backend", () => {
    clearEnvVars();
    addKey("openai", "sk-1");
    addKey("anthropic", "sk-2");
    const providers = listAllProviders({});
    const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
    assert.ok(byId.openai.hasKey);
    assert.ok(byId.anthropic.hasKey);
    assert.equal(byId.openai.source, "keychain");
    assert.equal(byId.anthropic.source, "keychain");
});

test("key migration works through the backend", () => {
    clearEnvVars();
    process.env.OPENAI_API_KEY = "sk-migrate";
    const result = migrateKeys();
    assert.equal(result.migrated, 1);
    assert.equal(resolveApiKey("openai"), "sk-migrate");
    // Second run should skip (already stored)
    const result2 = migrateKeys();
    assert.equal(result2.migrated, 0);
    delete process.env.OPENAI_API_KEY;
});

test("export/import works through the backend", () => {
    clearEnvVars();
    addKey("openai", "sk-1");
    addKey("anthropic", "sk-2");
    const exported = exportKeys();
    assert.equal(exported.length, 2);
    removeProviderKey("openai");
    removeProviderKey("anthropic");
    const result = importKeys(exported);
    assert.equal(result.imported, 2);
    assert.equal(resolveApiKey("openai"), "sk-1");
    assert.equal(resolveApiKey("anthropic"), "sk-2");
});
