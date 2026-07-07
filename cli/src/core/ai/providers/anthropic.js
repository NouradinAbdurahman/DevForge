// Anthropic's Messages API - a distinct wire shape from the OpenAI-
// compatible factory: the system prompt is its own top-level field (not a
// "system"-role message), and streamed events are typed
// (`content_block_delta`) rather than a flat `delta.content`.
import { AIProviderError, unsupported } from "./base.js";

const API_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

function splitSystemPrompt(messages) {
    const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
    const rest = messages.filter((m) => m.role !== "system");
    return { system: systemParts.join("\n\n") || undefined, rest };
}

async function parseAnthropicSSEStream(response, onToken) {
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
            if (!data) continue;
            let parsed;
            try {
                parsed = JSON.parse(data);
            } catch {
                continue;
            }
            if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
                full += parsed.delta.text;
                if (onToken) onToken(parsed.delta.text);
            }
        }
    }
    return full;
}

export function createAnthropicProvider({ apiKey, model, baseUrl = "https://api.anthropic.com/v1", fetchImpl = fetch }) {
    const id = "anthropic";
    const headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION
    };

    async function chat(messages, opts = {}) {
        const { system, rest } = splitSystemPrompt(messages);
        const response = await fetchImpl(`${baseUrl}/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: opts.model || model,
                system,
                messages: rest,
                max_tokens: opts.maxTokens || DEFAULT_MAX_TOKENS,
                temperature: opts.temperature,
                stream: false
            })
        });
        if (!response.ok) {
            throw new AIProviderError(`anthropic chat request failed: HTTP ${response.status}`, { code: "http_error" });
        }
        const data = await response.json();
        const content = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
        if (!content) {
            throw new AIProviderError("anthropic returned an unexpected response shape", { code: "bad_response" });
        }
        return { content, model: data.model || opts.model || model, raw: data };
    }

    async function stream(messages, opts = {}, onToken) {
        const { system, rest } = splitSystemPrompt(messages);
        const response = await fetchImpl(`${baseUrl}/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: opts.model || model,
                system,
                messages: rest,
                max_tokens: opts.maxTokens || DEFAULT_MAX_TOKENS,
                temperature: opts.temperature,
                stream: true
            })
        });
        if (!response.ok) {
            throw new AIProviderError(`anthropic stream request failed: HTTP ${response.status}`, { code: "http_error" });
        }
        if (!response.body) {
            const result = await chat(messages, opts);
            if (onToken) onToken(result.content);
            return result;
        }
        const content = await parseAnthropicSSEStream(response, onToken);
        return { content, model: opts.model || model };
    }

    async function embeddings() {
        throw unsupported(id, "embeddings");
    }

    async function listModels() {
        const response = await fetchImpl(`${baseUrl}/models`, { headers });
        if (!response.ok) {
            throw new AIProviderError(`anthropic models request failed: HTTP ${response.status}`, { code: "http_error" });
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

    return { id, chat, stream, embeddings, listModels, checkHealth, supportsStreaming: true };
}
