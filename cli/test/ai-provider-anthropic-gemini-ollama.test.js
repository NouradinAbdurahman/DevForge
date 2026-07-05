import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnthropicProvider } from "../src/core/ai/providers/anthropic.js";
import { createGeminiProvider } from "../src/core/ai/providers/gemini.js";
import { createOllamaProvider } from "../src/core/ai/providers/ollama.js";

function jsonResponse(body, { ok = true, status = 200 } = {}) {
    return { ok, status, json: async () => body };
}

// --- Anthropic: system prompt is a separate top-level field, not a
// "system"-role message -------------------------------------------------

test("anthropic chat() separates the system-role message into a top-level `system` field", async () => {
    let capturedBody;
    let capturedHeaders;
    const fetchImpl = async (_url, init) => {
        capturedBody = JSON.parse(init.body);
        capturedHeaders = init.headers;
        return jsonResponse({ content: [{ type: "text", text: "hi there" }], model: "claude-3-5-sonnet-latest" });
    };
    const provider = createAnthropicProvider({ apiKey: "sk-ant", model: "claude-3-5-sonnet-latest", fetchImpl });
    const result = await provider.chat([
        { role: "system", content: "Be concise." },
        { role: "user", content: "hello" }
    ]);
    assert.equal(capturedBody.system, "Be concise.");
    assert.deepEqual(capturedBody.messages, [{ role: "user", content: "hello" }]);
    assert.equal(capturedHeaders["x-api-key"], "sk-ant");
    assert.equal(capturedHeaders["anthropic-version"], "2023-06-01");
    assert.equal(result.content, "hi there");
});

test("anthropic embeddings() is always unsupported (no such endpoint exists)", async () => {
    const provider = createAnthropicProvider({ apiKey: "k", model: "m", fetchImpl: async () => jsonResponse({}) });
    await assert.rejects(() => provider.embeddings("text"), /does not support embeddings/);
});

test("anthropic joins multiple text content blocks into one string", async () => {
    const fetchImpl = async () => jsonResponse({ content: [{ type: "text", text: "part one " }, { type: "text", text: "part two" }] });
    const provider = createAnthropicProvider({ apiKey: "k", model: "m", fetchImpl });
    const result = await provider.chat([{ role: "user", content: "hi" }]);
    assert.equal(result.content, "part one part two");
});

// --- Gemini: "model" role instead of "assistant", system prompt is its
// own field, API key is a query param ------------------------------------

test("gemini chat() maps assistant->model role and puts the key in the query string", async () => {
    let capturedUrl;
    let capturedBody;
    const fetchImpl = async (url, init) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body);
        return jsonResponse({ candidates: [{ content: { parts: [{ text: "hi" }] } }] });
    };
    const provider = createGeminiProvider({ apiKey: "gk-123", model: "gemini-1.5-flash", fetchImpl });
    await provider.chat([
        { role: "system", content: "Be terse." },
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi back" }
    ]);
    assert.match(capturedUrl, /key=gk-123/);
    assert.match(capturedUrl, /gemini-1\.5-flash:generateContent/);
    assert.equal(capturedBody.systemInstruction.parts[0].text, "Be terse.");
    assert.deepEqual(capturedBody.contents, [
        { role: "user", parts: [{ text: "hello" }] },
        { role: "model", parts: [{ text: "hi back" }] }
    ]);
});

test("gemini listModels() strips the 'models/' prefix", async () => {
    const fetchImpl = async () => jsonResponse({ models: [{ name: "models/gemini-1.5-pro" }, { name: "models/gemini-1.5-flash" }] });
    const provider = createGeminiProvider({ apiKey: "k", model: "m", fetchImpl });
    assert.deepEqual(await provider.listModels(), ["gemini-1.5-flash", "gemini-1.5-pro"]);
});

test("gemini embeddings() embeds each input separately (one request per string)", async () => {
    let callCount = 0;
    const fetchImpl = async () => {
        callCount++;
        return jsonResponse({ embedding: { values: [callCount] } });
    };
    const provider = createGeminiProvider({ apiKey: "k", model: "m", fetchImpl });
    const { vectors } = await provider.embeddings(["a", "b"]);
    assert.equal(callCount, 2);
    assert.deepEqual(vectors, [[1], [2]]);
});

// --- Ollama: no key, NDJSON streaming (not SSE) -------------------------

test("ollama chat() needs no API key and posts to /api/chat", async () => {
    let capturedUrl;
    const fetchImpl = async (url) => {
        capturedUrl = url;
        return jsonResponse({ message: { content: "local response" }, model: "llama3" });
    };
    const provider = createOllamaProvider({ model: "llama3", fetchImpl });
    const result = await provider.chat([{ role: "user", content: "hi" }]);
    assert.equal(capturedUrl, "http://localhost:11434/api/chat");
    assert.equal(result.content, "local response");
});

test("ollama stream() parses NDJSON (not SSE) lines", async () => {
    const lines = ['{"message":{"content":"Hel"}}\n', '{"message":{"content":"lo"}}\n', '{"done":true}\n'];
    const fetchImpl = async () => ({
        ok: true,
        body: {
            getReader() {
                let i = 0;
                return { async read() { return i < lines.length ? { done: false, value: new TextEncoder().encode(lines[i++]) } : { done: true }; } };
            }
        }
    });
    const provider = createOllamaProvider({ model: "llama3", fetchImpl });
    const tokens = [];
    const result = await provider.stream([{ role: "user", content: "hi" }], {}, (t) => tokens.push(t));
    assert.equal(result.content, "Hello");
    assert.deepEqual(tokens, ["Hel", "lo"]);
});

test("ollama checkHealth() reports unreachable rather than throwing when the connection fails", async () => {
    const fetchImpl = async () => { throw new Error("connect ECONNREFUSED"); };
    const provider = createOllamaProvider({ model: "llama3", fetchImpl });
    const health = await provider.checkHealth();
    assert.equal(health.ok, false);
    assert.match(health.reason, /ECONNREFUSED/);
});
