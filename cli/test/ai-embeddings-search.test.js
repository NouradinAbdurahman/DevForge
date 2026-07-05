import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildEmbeddingsIndex, hasEmbeddingsIndex, semanticSearch } from "../src/core/ai/embeddings/search.js";

function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-ai-embeddings-test-"));
    process.env.HOME = tempHome;
    return async () => {
        try {
            await fn();
        } finally {
            process.env.HOME = originalHome;
            rmSync(tempHome, { recursive: true, force: true });
        }
    };
}

test("semanticSearch falls back to the registry's real lexical search when no embeddings index has been built", async () => {
    await withTempHome(async () => {
        assert.equal(hasEmbeddingsIndex("openai"), false);
        const results = await semanticSearch("flutter");
        assert.ok(results.includes("flutter"), "expected the real lexical search to find the flutter package");
    })();
});

test("buildEmbeddingsIndex + semanticSearch rank by real cosine similarity against an injected fake embeddings API", async () => {
    await withTempHome(async () => {
        // A tiny fake embeddings space: each package gets a fixed vector
        // keyed by call order, and the query is engineered to be closest
        // to whichever package embedded third.
        let call = 0;
        const vectorsByCall = new Map();
        const fetchImpl = async (_url, init) => {
            const body = JSON.parse(init.body);
            const inputs = Array.isArray(body.input) ? body.input : [body.input];
            const data = inputs.map(() => {
                call++;
                const vector = call === 3 ? [1, 0, 0] : [0, 1, 0];
                vectorsByCall.set(call, vector);
                return { embedding: vector };
            });
            return { ok: true, status: 200, json: async () => ({ data, model: "text-embedding-3-small" }) };
        };

        const index = await buildEmbeddingsIndex("openai", { apiKey: "k", fetchImpl });
        assert.ok(index.length > 0);
        assert.equal(hasEmbeddingsIndex("openai"), true);

        const queryFetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ embedding: [1, 0, 0] }] }) });
        const results = await semanticSearch("query matching the third package", { providerId: "openai", apiKey: "k", fetchImpl: queryFetch });
        assert.equal(results[0], index[2].name); // the package embedded on the 3rd call is the real top match
    })();
});
