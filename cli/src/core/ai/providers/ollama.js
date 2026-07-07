// Ollama's local HTTP API (no key - it's a local server). Chat responses
// are plain JSON; streamed responses are newline-delimited JSON (NDJSON),
// not Server-Sent-Events - a third distinct wire shape from the OpenAI-
// compatible and Anthropic/Gemini SSE dialects.
import { AIProviderError } from "./base.js";

async function parseNDJSONStream(response, onToken) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            let parsed;
            try {
                parsed = JSON.parse(line);
            } catch {
                continue;
            }
            const delta = parsed.message?.content;
            if (delta) {
                full += delta;
                if (onToken) onToken(delta);
            }
        }
    }
    return full;
}

export function createOllamaProvider({ model, embeddingsModel, baseUrl = "http://localhost:11434", fetchImpl = fetch }) {
    const id = "ollama";

    async function chat(messages, opts = {}) {
        const response = await fetchImpl(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: opts.model || model, messages, stream: false, options: { temperature: opts.temperature } })
        });
        if (!response.ok) {
            throw new AIProviderError(`ollama chat request failed: HTTP ${response.status}`, { code: "http_error" });
        }
        const data = await response.json();
        const content = data.message?.content;
        if (typeof content !== "string") {
            throw new AIProviderError("ollama returned an unexpected response shape", { code: "bad_response" });
        }
        return { content, model: data.model || opts.model || model, raw: data };
    }

    async function stream(messages, opts = {}, onToken) {
        const response = await fetchImpl(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: opts.model || model, messages, stream: true, options: { temperature: opts.temperature } })
        });
        if (!response.ok) {
            throw new AIProviderError(`ollama stream request failed: HTTP ${response.status}`, { code: "http_error" });
        }
        if (!response.body) {
            const result = await chat(messages, opts);
            if (onToken) onToken(result.content);
            return result;
        }
        const content = await parseNDJSONStream(response, onToken);
        return { content, model: opts.model || model };
    }

    // One request per input string (Ollama's /api/embeddings takes a
    // single `prompt`, not a batch) - simple and honest over reimplementing
    // batching for a corpus this small.
    async function embeddings(input, opts = {}) {
        const useModel = opts.model || embeddingsModel || model;
        const inputs = Array.isArray(input) ? input : [input];
        const vectors = [];
        for (const prompt of inputs) {
            const response = await fetchImpl(`${baseUrl}/api/embeddings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: useModel, prompt })
            });
            if (!response.ok) {
                throw new AIProviderError(`ollama embeddings request failed: HTTP ${response.status}`, { code: "http_error" });
            }
            const data = await response.json();
            vectors.push(data.embedding || []);
        }
        return { vectors, model: useModel };
    }

    async function listModels() {
        const response = await fetchImpl(`${baseUrl}/api/tags`);
        if (!response.ok) {
            throw new AIProviderError(`ollama tags request failed: HTTP ${response.status}`, { code: "http_error" });
        }
        const data = await response.json();
        return (data.models || []).map((m) => m.name).sort();
    }

    async function checkHealth() {
        try {
            await listModels();
            return { ok: true };
        } catch (err) {
            return { ok: false, reason: err.message };
        }
    }

    return { id, chat, stream, embeddings, listModels, checkHealth, supportsStreaming: true };
}
