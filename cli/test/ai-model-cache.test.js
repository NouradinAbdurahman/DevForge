import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getCachedModels, setCachedModels, clearModelCache, getModelsWithCache } from "../src/core/ai/models/cache.js";

function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-model-cache-test-"));
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

test("setCachedModels/getCachedModels round-trip", async () => {
    await withTempHome(async () => {
        setCachedModels("openai", ["gpt-4o", "gpt-4o-mini"]);
        const cached = getCachedModels("openai");
        assert.ok(cached);
        assert.deepEqual(cached.models, ["gpt-4o", "gpt-4o-mini"]);
        assert.ok(cached.age < 5000); // just set
    })();
});

test("getCachedModels returns null when no cache exists", async () => {
    await withTempHome(async () => {
        const result = getCachedModels("anthropic");
        assert.equal(result, null);
    })();
});

test("clearModelCache removes one provider's cache", async () => {
    await withTempHome(async () => {
        setCachedModels("openai", ["gpt-4o"]);
        setCachedModels("anthropic", ["claude-3"]);
        clearModelCache("openai");
        assert.equal(getCachedModels("openai"), null);
        assert.ok(getCachedModels("anthropic")); // still there
    })();
});

test("clearModelCache() without args clears all", async () => {
    await withTempHome(async () => {
        setCachedModels("openai", ["gpt-4o"]);
        setCachedModels("anthropic", ["claude-3"]);
        clearModelCache();
        assert.equal(getCachedModels("openai"), null);
        assert.equal(getCachedModels("anthropic"), null);
    })();
});

test("getModelsWithCache uses cache on second call", async () => {
    await withTempHome(async () => {
        let callCount = 0;
        const fakeFetch = async () => {
            callCount++;
            return {
                ok: true,
                json: async () => ({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] })
            };
        };
        // First call: hits the provider
        const models1 = await getModelsWithCache("openai", { apiKey: "k", fetchImpl: fakeFetch });
        assert.equal(callCount, 1);
        assert.deepEqual(models1, ["gpt-4o", "gpt-4o-mini"]);
        // Second call: should use cache (no new fetch)
        const models2 = await getModelsWithCache("openai", { apiKey: "k", fetchImpl: fakeFetch });
        assert.equal(callCount, 1); // no new call
        assert.deepEqual(models2, ["gpt-4o", "gpt-4o-mini"]);
    })();
});

test("getModelsWithCache with refresh=true bypasses cache", async () => {
    await withTempHome(async () => {
        let callCount = 0;
        const fakeFetch = async () => {
            callCount++;
            return {
                ok: true,
                json: async () => ({ data: [{ id: "gpt-4o" }] })
            };
        };
        await getModelsWithCache("openai", { apiKey: "k", fetchImpl: fakeFetch });
        assert.equal(callCount, 1);
        await getModelsWithCache("openai", { apiKey: "k", fetchImpl: fakeFetch, refresh: true });
        assert.equal(callCount, 2); // refresh forced a new call
    })();
});
