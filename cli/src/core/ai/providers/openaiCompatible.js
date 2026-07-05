// One factory shared by every provider that speaks the OpenAI
// `/chat/completions` wire format: OpenAI itself, Groq, OpenRouter, and a
// local LM Studio server - four providers, one real implementation,
// distinguished only by base URL/auth headers/embeddings support.
import { AIProviderError, unsupported } from "./base.js";

function authHeaders(apiKey, extraHeaders) {
    const headers = { "Content-Type": "application/json", ...extraHeaders };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
}

// parseSSEStream(response, onToken) -> Promise<string> (the full
// concatenated content). Hand-rolled rather than an SSE library: the wire
// format is exactly `data: {...}\n\n` lines ending in `data: [DONE]`, and
// this is the only place in the codebase that needs it.
async function parseSSEStream(response, onToken) {
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
            if (!line.startsWith("data:")) continue;
            const data = line.slice("data:".length).trim();
            if (data === "[DONE]" || data === "") continue;
            let parsed;
            try {
                parsed = JSON.parse(data);
            } catch {
                continue; // A malformed/partial SSE chunk - skip rather than crash the stream.
            }
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
                full += delta;
                if (onToken) onToken(delta);
            }
        }
    }
    return full;
}

export function createOpenAICompatibleProvider({
    id,
    baseUrl,
    apiKey,
    model,
    embeddingsModel,
    supportsEmbeddings = false,
    extraHeaders = {},
    fetchImpl = fetch
}) {
    const headers = authHeaders(apiKey, extraHeaders);

    async function chat(messages, opts = {}) {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({ model: opts.model || model, messages, temperature: opts.temperature, stream: false })
        });
        if (!response.ok) {
            throw new AIProviderError(`${id} chat request failed: HTTP ${response.status}`, { code: "http_error" });
        }
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== "string") {
            throw new AIProviderError(`${id} returned an unexpected response shape`, { code: "bad_response" });
        }
        return { content, model: data.model || opts.model || model, raw: data };
    }

    async function stream(messages, opts = {}, onToken) {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({ model: opts.model || model, messages, temperature: opts.temperature, stream: true })
        });
        if (!response.ok) {
            throw new AIProviderError(`${id} stream request failed: HTTP ${response.status}`, { code: "http_error" });
        }
        if (!response.body) {
            // No streaming body available (e.g. a fake in a test that
            // returns a plain object) - fall back to the non-streaming
            // path rather than failing outright.
            const result = await chat(messages, opts);
            if (onToken) onToken(result.content);
            return result;
        }
        const content = await parseSSEStream(response, onToken);
        return { content, model: opts.model || model };
    }

    async function embeddings(input, opts = {}) {
        if (!supportsEmbeddings) throw unsupported(id, "embeddings");
        const response = await fetchImpl(`${baseUrl}/embeddings`, {
            method: "POST",
            headers,
            body: JSON.stringify({ model: opts.model || embeddingsModel, input })
        });
        if (!response.ok) {
            throw new AIProviderError(`${id} embeddings request failed: HTTP ${response.status}`, { code: "http_error" });
        }
        const data = await response.json();
        const vectors = (data.data || []).map((d) => d.embedding);
        return { vectors, model: data.model || opts.model || embeddingsModel };
    }

    async function listModels() {
        const response = await fetchImpl(`${baseUrl}/models`, { headers });
        if (!response.ok) {
            throw new AIProviderError(`${id} models request failed: HTTP ${response.status}`, { code: "http_error" });
        }
        const data = await response.json();
        return (data.data || []).map((m) => m.id).sort();
    }

    async function checkHealth() {
        try {
            await listModels();
            return { ok: true };
        } catch (err) {
            return { ok: false, reason: err.message };
        }
    }

    return { id, chat, stream, embeddings, listModels, checkHealth };
}
