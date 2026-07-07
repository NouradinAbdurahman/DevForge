// Tests for AI Polish features: provider meta, model meta, usage stats.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("providerIcon returns a unique icon per known provider", async () => {
    const { providerIcon } = await import("../src/core/ai/providers/meta.js");
    const icons = ["openai", "anthropic", "gemini", "groq", "openrouter", "ollama", "lmstudio"]
        .map((id) => providerIcon(id));
    // All should be non-empty strings
    assert.ok(icons.every((i) => i && i.length > 0));
    // All should be unique
    assert.equal(new Set(icons).size, icons.length);
});

test("providerIcon returns fallback for unknown provider", async () => {
    const { providerIcon } = await import("../src/core/ai/providers/meta.js");
    assert.equal(providerIcon("unknown"), "●");
});

test("capabilityList returns correct capabilities for openai", async () => {
    const { capabilityList } = await import("../src/core/ai/providers/meta.js");
    const caps = capabilityList("openai");
    assert.ok(caps.length > 0);
    const chat = caps.find((c) => c.key === "chat");
    assert.ok(chat, "should have chat capability");
    assert.equal(chat.supported, true);
});

test("capabilityList returns empty array for unknown provider", async () => {
    const { capabilityList } = await import("../src/core/ai/providers/meta.js");
    const caps = capabilityList("unknown");
    assert.deepEqual(caps, []);
});

test("getModelMeta returns metadata for known models", async () => {
    const { getModelMeta } = await import("../src/core/ai/models/meta.js");
    const meta = getModelMeta("gpt-4o-mini");
    assert.ok(meta);
    assert.equal(meta.vision, true);
    assert.ok(meta.supports.includes("Text"));
});

test("getModelMeta matches by prefix for versioned models", async () => {
    const { getModelMeta } = await import("../src/core/ai/models/meta.js");
    const meta = getModelMeta("gpt-4o-2024-08-06");
    assert.ok(meta);
    // Should match the gpt-4o prefix
    assert.equal(meta.context, "128K tokens");
});

test("getModelMeta returns heuristic defaults for unknown models", async () => {
    const { getModelMeta } = await import("../src/core/ai/models/meta.js");
    const meta = getModelMeta("some-unknown-model-vision");
    assert.ok(meta);
    assert.equal(meta.vision, true);
    assert.ok(meta.supports.includes("Vision"));
});

test("getModelMeta returns null for empty input", async () => {
    const { getModelMeta } = await import("../src/core/ai/models/meta.js");
    assert.equal(getModelMeta(null), null);
    assert.equal(getModelMeta(""), null);
});

test("sortModels sorts by name alphabetically", async () => {
    const { sortModels } = await import("../src/core/ai/models/meta.js");
    const sorted = sortModels(["zeta", "alpha", "beta"], "name");
    assert.deepEqual(sorted, ["alpha", "beta", "zeta"]);
});

test("sortModels sorts by cheapest first", async () => {
    const { sortModels } = await import("../src/core/ai/models/meta.js");
    const sorted = sortModels(["gpt-4", "gpt-4o-mini", "llama3"], "cheapest");
    // gpt-4o-mini ($), llama3 (Free), gpt-4 ($$$$) -> Free first
    assert.equal(sorted[0], "llama3");
});

test("sortModels sorts by context window descending", async () => {
    const { sortModels } = await import("../src/core/ai/models/meta.js");
    const sorted = sortModels(["gpt-4o-mini", "gemini-1.5-pro", "gpt-4"], "context");
    // gemini-1.5-pro (2M) > gpt-4o-mini (128K) > gpt-4 (8K)
    assert.equal(sorted[0], "gemini-1.5-pro");
});

test("usage stats: record and retrieve", async () => {
    const tmpHome = mkdtempSync(path.join(tmpdir(), "devforgekit-stats-"));
    const origHome = process.env.HOME;
    process.env.HOME = tmpHome;
    try {
        const { recordRequest, getStatsSummary, clearStats } = await import("../src/core/ai/memory/stats.js");
        recordRequest({ provider: "openai", model: "gpt-4o-mini", command: "chat", responseTimeMs: 500 });
        recordRequest({ provider: "openai", model: "gpt-4o-mini", command: "chat", responseTimeMs: 300 });
        recordRequest({ provider: "anthropic", model: "claude-3-5-sonnet-latest", command: "doctor", responseTimeMs: 1000 });

        const summary = getStatsSummary();
        assert.equal(summary.totalRequests, 3);
        assert.equal(summary.mostUsedModel, "gpt-4o-mini");
        assert.equal(summary.favoriteProvider, "openai");
        assert.equal(summary.avgResponseTime, 600); // (500+300+1000)/3
        assert.ok(summary.todayCount >= 3);

        clearStats();
        const after = getStatsSummary();
        assert.equal(after.totalRequests, 0);
    } finally {
        process.env.HOME = origHome;
        rmSync(tmpHome, { recursive: true, force: true });
    }
});

test("usage stats: empty stats return defaults", async () => {
    const tmpHome = mkdtempSync(path.join(tmpdir(), "devforgekit-stats-empty-"));
    const origHome = process.env.HOME;
    process.env.HOME = tmpHome;
    try {
        const { getStatsSummary } = await import("../src/core/ai/memory/stats.js");
        const summary = getStatsSummary();
        assert.equal(summary.totalRequests, 0);
        assert.equal(summary.todayCount, 0);
        assert.equal(summary.mostUsedModel, null);
        assert.equal(summary.favoriteProvider, null);
        assert.equal(summary.avgResponseTime, null);
    } finally {
        process.env.HOME = origHome;
        rmSync(tmpHome, { recursive: true, force: true });
    }
});
