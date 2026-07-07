// The shared AIProvider contract every provider client implements (see
// docs/ProviderAPI.md). This file is deliberately mostly documentation -
// there's no abstract base class to extend (plain objects satisfying the
// shape are enough, matching how core/generators/*.js providers work) -
// plus the one error type and one small helper every provider shares.
//
// AIProvider shape:
//   id: string                                    - "openai" | "anthropic" | "gemini" | "groq" | "openrouter" | "lmstudio" | "ollama"
//   chat(messages, opts) -> Promise<{ content, model, raw }>
//   stream(messages, opts, onToken) -> Promise<{ content, model }>   - onToken(deltaText) called per chunk
//   embeddings(input, opts) -> Promise<{ vectors: number[][], model }>   - throws AIProviderError({ code: "unsupported" }) if the provider has no embeddings endpoint
//   listModels(opts) -> Promise<string[]>
//   checkHealth(opts) -> Promise<{ ok: boolean, reason? }>            - never throws; a failed health check is a normal { ok: false, reason } result
//   supportsStreaming: boolean                    - true for all four factories here (each implements a real stream()); a future provider without one should set this false rather than omit it (a real bug found in v2.1.3: `ai benchmark` read this field for years before any factory actually set it, so it always printed "No")
//
// `messages` is always [{ role: "system"|"user"|"assistant", content: string }, ...].
// Every network call accepts an optional `fetchImpl` (defaults to the
// global `fetch`) - the same dependency-injection convention this codebase
// already uses everywhere (core/compatibility/engine.js's `packages`/
// `rules` overrides, core/installer.js's `packages` override) - so tests
// exercise real request-building/response-parsing logic against an
// injected fake instead of a real network call.
export class AIProviderError extends Error {
    constructor(message, { code = "provider_error", cause } = {}) {
        super(message);
        this.name = "AIProviderError";
        this.code = code;
        if (cause) this.cause = cause;
    }
}

export function unsupported(providerId, feature) {
    return new AIProviderError(`${providerId} does not support ${feature}`, { code: "unsupported" });
}

// safeHealthCheck(fn) -> Promise<{ ok, reason? }>. Wraps a provider's own
// health probe so a network failure is reported, never thrown -
// `checkHealth` is meant to be called freely (e.g. `ai providers` health-
// checking every known provider at once) without one bad endpoint
// aborting the others.
export async function safeHealthCheck(fn) {
    try {
        await fn();
        return { ok: true };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}
