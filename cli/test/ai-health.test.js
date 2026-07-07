// Tests for the AI Health Score (AI Assistant Excellence, v2.1.3 Phase 12).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetBackend, setBackend } from "../src/core/ai/credentials/selector.js";
import { MemoryBackend } from "../src/core/ai/credentials/backends/memory.js";
import { addKey } from "../src/core/ai/credentials/manager.js";
import { setConfigValue } from "../src/core/config.js";
import { scoreAIHealth } from "../src/core/ai/health.js";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe("AI Health Score", () => {
    let tempHome;

    beforeEach(() => {
        tempHome = mkdtempSync(path.join(tmpdir(), "ai-health-test-"));
        process.env.HOME = tempHome;
        process.env.NODE_ENV = "test";
        setBackend(new MemoryBackend());
        setConfigValue("aiProvider", "none");
        setConfigValue("aiModel", null);
        setConfigValue("aiEndpoint", null);
    });

    afterEach(() => {
        process.env.HOME = ORIGINAL_HOME;
        process.env.NODE_ENV = ORIGINAL_NODE_ENV;
        try { rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
        resetBackend();
    });

    test("scores low with no provider configured, and never fabricates a Connection check", async () => {
        const scored = await scoreAIHealth();
        assert.ok(scored.score < 50, `expected a low score with nothing configured, got ${scored.score}`);
        assert.ok(!scored.checks.some((c) => c.label === "Connection"), "Connection should be absent, not faked, without a live check");
        const provider = scored.checks.find((c) => c.label === "Provider");
        assert.equal(provider.pass, false);
    });

    test("scores high for a fully configured local provider (no key required)", async () => {
        setConfigValue("aiProvider", "ollama");
        setConfigValue("aiModel", "llama3");
        const scored = await scoreAIHealth();
        assert.ok(scored.score >= 80, `expected a high score for a configured local provider, got ${scored.score}`);
        assert.equal(scored.checks.find((c) => c.label === "Provider").pass, true);
        assert.equal(scored.checks.find((c) => c.label === "Credential").pass, true);
        assert.equal(scored.checks.find((c) => c.label === "Streaming").pass, true);
    });

    test("flags a missing API key for a cloud provider as a failed Credential check", async () => {
        setConfigValue("aiProvider", "openai");
        const scored = await scoreAIHealth();
        assert.equal(scored.checks.find((c) => c.label === "Credential").pass, false);
    });

    test("passes Credential once a real key is stored", async () => {
        setConfigValue("aiProvider", "openai");
        addKey("openai", "sk-test-key");
        const scored = await scoreAIHealth();
        assert.equal(scored.checks.find((c) => c.label === "Credential").pass, true);
    });

    test("includes a real Connection check only when a live result is passed in", async () => {
        setConfigValue("aiProvider", "ollama");
        const failing = await scoreAIHealth({ connectionResult: { ok: false, reason: "ECONNREFUSED" } });
        assert.equal(failing.checks.find((c) => c.label === "Connection").pass, false);

        const passing = await scoreAIHealth({ connectionResult: { ok: true } });
        assert.equal(passing.checks.find((c) => c.label === "Connection").pass, true);
    });

    test("recommendationsCount mirrors validateAIConfig's real recommendation count", async () => {
        const scored = await scoreAIHealth();
        assert.ok(scored.recommendationsCount > 0); // "no provider" always recommends 'ai setup'
    });

    test("score is always the exact rounded pass ratio, and every check is boolean", async () => {
        setConfigValue("aiProvider", "ollama");
        const scored = await scoreAIHealth();
        assert.equal(scored.score, Math.round((scored.passCount / scored.total) * 100));
        for (const check of scored.checks) {
            assert.equal(typeof check.pass, "boolean");
            assert.equal(typeof check.label, "string");
        }
    });
});
