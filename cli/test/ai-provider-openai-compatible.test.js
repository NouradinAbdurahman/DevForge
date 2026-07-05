import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenAICompatibleProvider } from "../src/core/ai/providers/openaiCompatible.js";
import { AIProviderError } from "../src/core/ai/providers/base.js";

function jsonResponse(body, { ok = true, status = 200 } = {}) {
    return { ok, status, json: async () => body };
}

// fakeStreamResponse(chunks) -> a response-shaped object whose `.body`
// exposes the same getReader()/read() contract a real fetch Response does,
// so the SSE parser under test never touches a real network stream.
function fakeStreamResponse(chunks) {
    let index = 0;
    return {
        ok: true,
        body: {
            getReader() {
                return {
                    async read() {
                        if (index >= chunks.length) return { done: true, value: undefined };
                        return { done: false, value: new TextEncoder().encode(chunks[index++]) };
                    }
                };
            }
        }
    };
}

test("chat() posts to /chat/completions and extracts the message content", async () => {
    let capturedUrl;
    let capturedBody;
    const fetchImpl = async (url, init) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body);
        return jsonResponse({ choices: [{ message: { content: "hello there" } }], model: "gpt-4o-mini" });
    };
    const provider = createOpenAICompatibleProvider({ id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl });

    const result = await provider.chat([{ role: "user", content: "hi" }]);
    assert.equal(capturedUrl, "https://api.openai.com/v1/chat/completions");
    assert.equal(capturedBody.model, "gpt-4o-mini");
    assert.equal(capturedBody.stream, false);
    assert.equal(result.content, "hello there");
    assert.equal(result.model, "gpt-4o-mini");
});

test("chat() sends a Bearer auth header built from the given API key", async () => {
    let capturedHeaders;
    const fetchImpl = async (_url, init) => {
        capturedHeaders = init.headers;
        return jsonResponse({ choices: [{ message: { content: "x" } }] });
    };
    const provider = createOpenAICompatibleProvider({ id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "sk-secret", model: "m", fetchImpl });
    await provider.chat([{ role: "user", content: "hi" }]);
    assert.equal(capturedHeaders.Authorization, "Bearer sk-secret");
});

test("chat() throws AIProviderError on a non-ok HTTP response", async () => {
    const fetchImpl = async () => jsonResponse({}, { ok: false, status: 401 });
    const provider = createOpenAICompatibleProvider({ id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "bad", model: "m", fetchImpl });
    await assert.rejects(() => provider.chat([{ role: "user", content: "hi" }]), (err) => {
        assert.ok(err instanceof AIProviderError);
        assert.equal(err.code, "http_error");
        return true;
    });
});

test("chat() throws AIProviderError for a malformed response shape", async () => {
    const fetchImpl = async () => jsonResponse({ choices: [] });
    const provider = createOpenAICompatibleProvider({ id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "m", fetchImpl });
    await assert.rejects(() => provider.chat([{ role: "user", content: "hi" }]), /unexpected response shape/);
});

test("embeddings() is unsupported unless supportsEmbeddings is set, and posts to /embeddings otherwise", async () => {
    const noEmbeddings = createOpenAICompatibleProvider({ id: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m", fetchImpl: async () => jsonResponse({}) });
    await assert.rejects(() => noEmbeddings.embeddings("text"), /does not support embeddings/);

    let capturedUrl;
    const fetchImpl = async (url) => {
        capturedUrl = url;
        return jsonResponse({ data: [{ embedding: [0.1, 0.2, 0.3] }], model: "text-embedding-3-small" });
    };
    const withEmbeddings = createOpenAICompatibleProvider({
        id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "m",
        embeddingsModel: "text-embedding-3-small", supportsEmbeddings: true, fetchImpl
    });
    const result = await withEmbeddings.embeddings(["hello"]);
    assert.equal(capturedUrl, "https://api.openai.com/v1/embeddings");
    assert.deepEqual(result.vectors, [[0.1, 0.2, 0.3]]);
});

test("listModels() and checkHealth() reflect a real vs. a failing /models endpoint", async () => {
    const okFetch = async () => jsonResponse({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] });
    const okProvider = createOpenAICompatibleProvider({ id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "m", fetchImpl: okFetch });
    assert.deepEqual(await okProvider.listModels(), ["gpt-4o", "gpt-4o-mini"]);
    assert.deepEqual(await okProvider.checkHealth(), { ok: true });

    const failFetch = async () => jsonResponse({}, { ok: false, status: 500 });
    const failProvider = createOpenAICompatibleProvider({ id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "m", fetchImpl: failFetch });
    const health = await failProvider.checkHealth();
    assert.equal(health.ok, false);
    assert.match(health.reason, /HTTP 500/);
});

test("stream() parses SSE chunks, calls onToken per delta, and returns the full concatenated content", async () => {
    const chunks = [
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        "data: [DONE]\n\n"
    ];
    const fetchImpl = async () => fakeStreamResponse(chunks);
    const provider = createOpenAICompatibleProvider({ id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "m", fetchImpl });
    const tokens = [];
    const result = await provider.stream([{ role: "user", content: "hi" }], {}, (t) => tokens.push(t));
    assert.equal(result.content, "Hello");
    assert.deepEqual(tokens, ["Hel", "lo"]);
});

test("stream() tolerates a malformed SSE data line instead of crashing the stream", async () => {
    const chunks = ['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', "data: not-json\n\n"];
    const fetchImpl = async () => fakeStreamResponse(chunks);
    const provider = createOpenAICompatibleProvider({ id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "m", fetchImpl });
    const result = await provider.stream([{ role: "user", content: "hi" }], {});
    assert.equal(result.content, "ok");
});

test("openrouter includes its required attribution headers", async () => {
    let capturedHeaders;
    const fetchImpl = async (_url, init) => {
        capturedHeaders = init.headers;
        return jsonResponse({ choices: [{ message: { content: "x" } }] });
    };
    const provider = createOpenAICompatibleProvider({
        id: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "m",
        extraHeaders: { "HTTP-Referer": "https://devforgekit.dev", "X-Title": "DevForgeKit" }, fetchImpl
    });
    await provider.chat([{ role: "user", content: "hi" }]);
    assert.equal(capturedHeaders["HTTP-Referer"], "https://devforgekit.dev");
    assert.equal(capturedHeaders["X-Title"], "DevForgeKit");
});
