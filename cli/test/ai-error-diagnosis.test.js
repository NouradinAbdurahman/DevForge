import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseProviderError, diagnoseNotConfigured } from "../src/core/ai/diagnostics/errors.js";

test("diagnoseProviderError: 401 -> invalid key with recovery command", () => {
    const err = { message: "openai chat request failed: HTTP 401", code: "http_error" };
    const diag = diagnoseProviderError("openai", err);
    assert.match(diag.message, /invalid or expired/i);
    assert.match(diag.recovery, /devforgekit ai key add openai/);
    assert.ok(diag.isKey);
});

test("diagnoseProviderError: 403 -> auth error", () => {
    const err = { message: "HTTP 403", code: "http_error" };
    const diag = diagnoseProviderError("anthropic", err);
    assert.match(diag.message, /invalid or expired/i);
    assert.ok(diag.isKey);
});

test("diagnoseProviderError: 429 -> rate limited", () => {
    const err = { message: "HTTP 429", code: "http_error" };
    const diag = diagnoseProviderError("openai", err);
    assert.match(diag.message, /rate-limited|quota|credits/i);
    assert.ok(!diag.isKey);
});

test("diagnoseProviderError: 500 -> server error", () => {
    const err = { message: "HTTP 500", code: "http_error" };
    const diag = diagnoseProviderError("openai", err);
    assert.match(diag.message, /provider-side/i);
    assert.ok(diag.isServer);
});

test("diagnoseProviderError: connection refused for ollama -> 'not running'", () => {
    const err = { message: "ollama chat request failed: HTTP 0", code: "http_error" };
    const diag = diagnoseProviderError("ollama", err);
    assert.match(diag.message, /not running/i);
    assert.match(diag.recovery, /ollama serve/);
    assert.ok(diag.isNetwork);
});

test("diagnoseProviderError: connection refused for lmstudio -> 'not running'", () => {
    const err = { message: "lmstudio request failed", code: "http_error" };
    const diag = diagnoseProviderError("lmstudio", err);
    assert.match(diag.message, /not running/i);
    assert.match(diag.recovery, /LM Studio server/i);
    assert.ok(diag.isNetwork);
});

test("diagnoseProviderError: bad_response -> API version mismatch", () => {
    const err = { message: "unexpected response shape", code: "bad_response" };
    const diag = diagnoseProviderError("gemini", err);
    assert.match(diag.message, /unexpected response/i);
});

test("diagnoseProviderError: generic fallback includes provider name", () => {
    const err = { message: "something weird happened", code: "unknown" };
    const diag = diagnoseProviderError("groq", err);
    assert.match(diag.message, /Groq/);
    assert.match(diag.recovery, /devforgekit ai key test groq/);
});

test("diagnoseNotConfigured: no provider -> 'ai setup' recovery", () => {
    const diag = diagnoseNotConfigured(null);
    assert.match(diag.message, /No AI provider configured/i);
    assert.match(diag.recovery, /devforgekit ai setup/);
});

test("diagnoseNotConfigured: cloud provider without key -> 'ai key add'", () => {
    const diag = diagnoseNotConfigured("openai");
    assert.match(diag.message, /OpenAI.*no API key/i);
    assert.match(diag.recovery, /devforgekit ai key add openai/);
});

test("diagnoseNotConfigured: ollama not reachable -> 'ollama serve'", () => {
    const diag = diagnoseNotConfigured("ollama");
    assert.match(diag.message, /not reachable/i);
    assert.match(diag.recovery, /ollama serve/);
});

test("diagnoseNotConfigured: lmstudio not reachable -> 'LM Studio server'", () => {
    const diag = diagnoseNotConfigured("lmstudio");
    assert.match(diag.message, /not reachable/i);
    assert.match(diag.recovery, /LM Studio server/);
});
