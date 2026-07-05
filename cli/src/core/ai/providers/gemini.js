// Google's Generative Language API - yet another distinct shape: the
// system prompt is a separate `systemInstruction`, conversation turns are
// `contents: [{ role: "user"|"model", parts: [{ text }] }]` ("model" where
// OpenAI/Anthropic say "assistant"), and the API key is a query parameter
// rather than a header.
import { AIProviderError } from "./base.js";

function toGeminiContents(messages) {
    return messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
}

function toSystemInstruction(messages) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    return system ? { parts: [{ text: system }] } : undefined;
}

function extractText(data) {
    const parts = data.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p.text || "").join("");
}

async function parseGeminiSSEStream(response, onToken) {
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
            const delta = extractText(parsed);
            if (delta) {
                full += delta;
                if (onToken) onToken(delta);
            }
        }
    }
    return full;
}

export function createGeminiProvider({ apiKey, model, embeddingsModel = "text-embedding-004", baseUrl = "https://generativelanguage.googleapis.com/v1beta", fetchImpl = fetch }) {
    const id = "gemini";

    async function chat(messages, opts = {}) {
        const useModel = opts.model || model;
        const response = await fetchImpl(`${baseUrl}/models/${useModel}:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: toGeminiContents(messages),
                systemInstruction: toSystemInstruction(messages),
                generationConfig: { temperature: opts.temperature }
            })
        });
        if (!response.ok) {
            throw new AIProviderError(`gemini chat request failed: HTTP ${response.status}`, { code: "http_error" });
        }
        const data = await response.json();
        const content = extractText(data);
        if (!content) {
            throw new AIProviderError("gemini returned an unexpected response shape", { code: "bad_response" });
        }
        return { content, model: useModel, raw: data };
    }

    async function stream(messages, opts = {}, onToken) {
        const useModel = opts.model || model;
        const response = await fetchImpl(`${baseUrl}/models/${useModel}:streamGenerateContent?key=${apiKey}&alt=sse`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: toGeminiContents(messages),
                systemInstruction: toSystemInstruction(messages),
                generationConfig: { temperature: opts.temperature }
            })
        });
        if (!response.ok) {
            throw new AIProviderError(`gemini stream request failed: HTTP ${response.status}`, { code: "http_error" });
        }
        if (!response.body) {
            const result = await chat(messages, opts);
            if (onToken) onToken(result.content);
            return result;
        }
        const content = await parseGeminiSSEStream(response, onToken);
        return { content, model: useModel };
    }

    // Not batched (one request per input string) - simple and honest
    // rather than reimplementing Gemini's separate batchEmbedContents
    // shape for a corpus size (registry descriptions) small enough that
    // it doesn't matter.
    async function embeddings(input, opts = {}) {
        const useModel = opts.model || embeddingsModel;
        const inputs = Array.isArray(input) ? input : [input];
        const vectors = [];
        for (const text of inputs) {
            const response = await fetchImpl(`${baseUrl}/models/${useModel}:embedContent?key=${apiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: { parts: [{ text }] } })
            });
            if (!response.ok) {
                throw new AIProviderError(`gemini embeddings request failed: HTTP ${response.status}`, { code: "http_error" });
            }
            const data = await response.json();
            vectors.push(data.embedding?.values || []);
        }
        return { vectors, model: useModel };
    }

    async function listModels() {
        const response = await fetchImpl(`${baseUrl}/models?key=${apiKey}`);
        if (!response.ok) {
            throw new AIProviderError(`gemini models request failed: HTTP ${response.status}`, { code: "http_error" });
        }
        const data = await response.json();
        return (data.models || []).map((m) => (m.name || "").replace(/^models\//, "")).filter(Boolean).sort();
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
