// Tests for the AI configuration validation module (Phase 1, 2, 3, 8, 9, 10).
// Verifies provider/model consistency checks, health status, auto-repair,
// and the full status report.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetBackend, setBackend } from "../src/core/ai/credentials/selector.js";
import { MemoryBackend } from "../src/core/ai/credentials/backends/memory.js";
import { addKey, removeProviderKey } from "../src/core/ai/credentials/manager.js";
import { setConfigValue, loadConfig } from "../src/core/config.js";
import {
    validateAIConfig,
    aiHealthStatus,
    autoRepairConfig,
    getAIStatusReport,
    checkModelConsistency
} from "../src/core/ai/validation.js";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setupTempHome() {
    const tempHome = mkdtempSync(path.join(tmpdir(), "ai-validation-test-"));
    process.env.HOME = tempHome;
    return tempHome;
}

function cleanupTempHome(tempHome) {
    process.env.HOME = ORIGINAL_HOME;
    try { rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe("AI Validation", () => {
    let tempHome;

    beforeEach(() => {
        tempHome = setupTempHome();
        process.env.NODE_ENV = "test";
        setBackend(new MemoryBackend());
        // Reset config to defaults
        setConfigValue("aiProvider", "none");
        setConfigValue("aiModel", null);
        setConfigValue("aiEndpoint", null);
    });

    afterEach(() => {
        cleanupTempHome(tempHome);
        resetBackend();
        process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    });

    describe("checkModelConsistency", () => {
        test("returns null for compatible provider/model", () => {
            assert.equal(checkModelConsistency("openai", "gpt-4o-mini"), null);
            assert.equal(checkModelConsistency("anthropic", "claude-3-5-sonnet-latest"), null);
            assert.equal(checkModelConsistency("ollama", "llama3"), null);
        });

        test("detects cross-provider model mismatch", () => {
            const issue = checkModelConsistency("openai", "claude-opus");
            assert.ok(issue);
            assert.equal(issue.field, "model");
            assert.equal(issue.severity, "warning");
            assert.ok(issue.message.includes("Anthropic Claude"));
            assert.ok(issue.message.includes("OpenAI"));
        });

        test("allows any model under openrouter", () => {
            assert.equal(checkModelConsistency("openrouter", "claude-opus"), null);
            assert.equal(checkModelConsistency("openrouter", "gpt-4o"), null);
        });

        test("detects GPT model under non-OpenAI provider", () => {
            const issue = checkModelConsistency("anthropic", "gpt-4");
            assert.ok(issue);
            assert.ok(issue.message.includes("OpenAI GPT"));
        });

        test("detects Gemini model under wrong provider", () => {
            const issue = checkModelConsistency("groq", "gemini-1.5-flash");
            assert.ok(issue);
            assert.ok(issue.message.includes("Google Gemini"));
        });
    });

    describe("validateAIConfig", () => {
        test("reports not-configured when no provider set", () => {
            setConfigValue("aiProvider", "none");
            const report = validateAIConfig();
            assert.equal(report.valid, false);
            assert.equal(report.config.provider, null);
            assert.ok(report.issues.some((i) => i.field === "provider"));
        });

        test("reports valid for configured provider with key", () => {
            setConfigValue("aiProvider", "openai");
            addKey("openai", "sk-test-key-123");
            const report = validateAIConfig();
            assert.equal(report.config.provider, "openai");
            assert.equal(report.config.keyAvailable, true);
            // Should not have error-level issues
            const errors = report.issues.filter((i) => i.severity === "error");
            assert.equal(errors.length, 0);
        });

        test("reports missing API key for cloud provider without key", () => {
            setConfigValue("aiProvider", "openai");
            const report = validateAIConfig();
            assert.equal(report.config.keyAvailable, false);
            assert.ok(report.issues.some((i) => i.field === "apiKey" && i.severity === "error"));
        });

        test("does not require key for local providers", () => {
            setConfigValue("aiProvider", "ollama");
            const report = validateAIConfig();
            assert.equal(report.config.keyAvailable, true);
            assert.equal(report.config.keySource, "local");
            const keyIssues = report.issues.filter((i) => i.field === "apiKey");
            assert.equal(keyIssues.length, 0);
        });

        test("detects unknown provider", () => {
            setConfigValue("aiProvider", "nonexistent");
            const report = validateAIConfig();
            assert.equal(report.valid, false);
            assert.ok(report.issues.some((i) => i.field === "provider" && i.severity === "error"));
        });

        test("provides recommendations for issues", () => {
            setConfigValue("aiProvider", "openai");
            const report = validateAIConfig();
            assert.ok(report.recommendations.length > 0);
            assert.ok(report.recommendations.some((r) => r.action === "add-key"));
        });
    });

    describe("aiHealthStatus", () => {
        test("returns not-configured when no provider", () => {
            setConfigValue("aiProvider", "none");
            const status = aiHealthStatus();
            assert.equal(status.status, "not-configured");
            assert.equal(status.label, "Not Configured");
        });

        test("returns missing-key for cloud provider without key", () => {
            setConfigValue("aiProvider", "openai");
            const status = aiHealthStatus();
            assert.equal(status.status, "missing-key");
            assert.equal(status.label, "Missing API Key");
        });

        test("returns ready for configured provider with key", () => {
            setConfigValue("aiProvider", "openai");
            addKey("openai", "sk-test-key-123");
            const status = aiHealthStatus();
            assert.equal(status.status, "ready");
            assert.equal(status.label, "Ready");
        });

        test("returns ready for local provider without key", () => {
            setConfigValue("aiProvider", "ollama");
            const status = aiHealthStatus();
            assert.equal(status.status, "ready");
        });
    });

    describe("autoRepairConfig", () => {
        test("fixes invalid model by resetting to provider default", () => {
            setConfigValue("aiProvider", "openai");
            setConfigValue("aiModel", "claude-opus"); // Wrong provider's model
            addKey("openai", "sk-test-key-123");

            const repair = autoRepairConfig();
            assert.equal(repair.applied, true);
            assert.equal(repair.repairs.length, 1);
            assert.equal(repair.repairs[0].field, "model");
            assert.equal(repair.repairs[0].from, "claude-opus");
            assert.equal(repair.repairs[0].to, "gpt-4o-mini");

            // Verify config was actually changed
            const config = loadConfig();
            assert.equal(config.aiModel, "gpt-4o-mini");
        });

        test("does not repair missing API key (requires user input)", () => {
            setConfigValue("aiProvider", "openai");
            // No key added
            const repair = autoRepairConfig();
            // Should not have any repairs for missing key
            assert.equal(repair.repairs.some((r) => r.field === "apiKey"), false);
        });

        test("returns no repairs when config is valid", () => {
            setConfigValue("aiProvider", "ollama");
            setConfigValue("aiModel", "llama3");
            const repair = autoRepairConfig();
            assert.equal(repair.applied, false);
            assert.equal(repair.repairs.length, 0);
        });
    });

    describe("getAIStatusReport", () => {
        test("returns comprehensive status report", () => {
            setConfigValue("aiProvider", "openai");
            setConfigValue("aiModel", "gpt-4o-mini");
            setConfigValue("aiEndpoint", "https://api.openai.com/v1");
            addKey("openai", "sk-test-key-123");

            const report = getAIStatusReport();
            assert.ok(report.provider);
            assert.equal(report.provider.id, "openai");
            assert.equal(report.model, "gpt-4o-mini");
            assert.equal(report.endpoint, "https://api.openai.com/v1");
            assert.equal(report.apiKey.available, true);
            assert.ok(report.credentialBackend.location);
            assert.ok(report.health);
            assert.ok(report.validation);
        });

        test("returns null provider when not configured", () => {
            setConfigValue("aiProvider", "none");
            const report = getAIStatusReport();
            assert.equal(report.provider, null);
            assert.equal(report.health.status, "not-configured");
        });

        test("includes model cache info", () => {
            setConfigValue("aiProvider", "ollama");
            const report = getAIStatusReport();
            assert.ok(report.models);
            assert.equal(typeof report.models.cached, "boolean");
        });
    });

    describe("Provider switching model validation", () => {
        test("switching from openai to anthropic with gpt model triggers reset", () => {
            setConfigValue("aiProvider", "openai");
            setConfigValue("aiModel", "gpt-4o-mini");
            addKey("openai", "sk-test-1");
            addKey("anthropic", "sk-ant-test-1");

            // Simulate switching to anthropic
            const issue = checkModelConsistency("anthropic", "gpt-4o-mini");
            assert.ok(issue, "gpt-4o-mini should be flagged as incompatible with anthropic");
        });

        test("switching from anthropic to openai with claude model triggers reset", () => {
            setConfigValue("aiProvider", "anthropic");
            setConfigValue("aiModel", "claude-3-5-sonnet-latest");

            const issue = checkModelConsistency("openai", "claude-3-5-sonnet-latest");
            assert.ok(issue, "claude model should be flagged as incompatible with openai");
        });

        test("switching to openrouter keeps any model", () => {
            setConfigValue("aiProvider", "openai");
            setConfigValue("aiModel", "gpt-4o-mini");

            // OpenRouter supports all providers' models
            const issue = checkModelConsistency("openrouter", "claude-3-5-sonnet-latest");
            assert.equal(issue, null, "openrouter should accept any model");
        });
    });
});
