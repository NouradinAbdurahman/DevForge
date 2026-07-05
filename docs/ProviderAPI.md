# Provider API

The `AIProvider` contract every provider client implements
(`cli/src/core/ai/providers/base.js`), and how the seven supported
providers map onto it.

## The contract

```js
{
  id: string,
  chat(messages, opts) -> Promise<{ content, model, raw }>,
  stream(messages, opts, onToken) -> Promise<{ content, model }>,
  embeddings(input, opts) -> Promise<{ vectors, model }>,   // throws AIProviderError({ code: "unsupported" }) if unavailable
  listModels(opts) -> Promise<string[]>,
  checkHealth(opts) -> Promise<{ ok, reason? }>              // never throws
}
```

`messages` is always `[{ role: "system"|"user"|"assistant", content }, ...]`
regardless of provider - each client translates that into its own wire
shape internally. Every network call accepts an optional `fetchImpl`
(defaults to the global `fetch`) - the same dependency-injection
convention `core/compatibility/engine.js`'s `packages`/`rules` overrides
and `core/installer.js`'s `packages` override already use - so provider
clients are unit-tested against an injected fake instead of a real network
call (see `cli/test/ai-provider-*.test.js`).

## The seven providers, three wire dialects

| Provider | Factory | Dialect | Key needed | Embeddings |
| --- | --- | --- | --- | --- |
| OpenAI | `providers/openaiCompatible.js` | OpenAI `/chat/completions` | `OPENAI_API_KEY` | yes |
| Groq | `providers/openaiCompatible.js` | same (OpenAI-compatible) | `GROQ_API_KEY` | no |
| OpenRouter | `providers/openaiCompatible.js` | same, + attribution headers | `OPENROUTER_API_KEY` | no |
| LM Studio | `providers/openaiCompatible.js` | same, local server | none | no |
| Anthropic | `providers/anthropic.js` | Messages API (separate `system` field, typed SSE events) | `ANTHROPIC_API_KEY` | no (no such endpoint) |
| Gemini | `providers/gemini.js` | `generateContent`/`streamGenerateContent` (key as query param, "model" role) | `GEMINI_API_KEY` | yes (`embedContent`, one call per input) |
| Ollama | `providers/ollama.js` | `/api/chat` (NDJSON streaming, not SSE) | none (local server) | yes (`/api/embeddings`, one call per input) |

Four providers (OpenAI, Groq, OpenRouter, LM Studio) share one real
implementation - `openaiCompatible.js`'s factory - since they all speak the
same `/chat/completions` wire format; they differ only in base URL, auth
headers, and embeddings support. Anthropic, Gemini, and Ollama each have
genuinely different request/response shapes and streaming dialects, so
each gets its own file.

## Streaming dialects (why there are three SSE/NDJSON parsers)

- **OpenAI-compatible**: SSE, `data: {"choices":[{"delta":{"content":"..."}}]}` per line, terminated by `data: [DONE]`.
- **Anthropic**: SSE, typed events - only `content_block_delta` events with `delta.type === "text_delta"` carry text.
- **Gemini**: SSE (`&alt=sse`), each `data:` line is a full partial `candidates[0].content.parts[].text` object.
- **Ollama**: NDJSON, not SSE at all - one raw JSON object per line, `{ message: { content }, done }`.

Each parser is hand-rolled (no SSE library dependency) since the format is
simple and this is the only place in the codebase that needs it - see each
provider file's own doc comment.

## The provider registry (`providers/index.js`)

- `getProvider(providerId, { apiKey, model, endpoint, workspace, fetchImpl })` - the one place a client is constructed. Throws a clear error for an unknown id.
- `resolveApiKey(providerId, { workspace, apiKeyRef })` - env var → the active workspace's declared secret via `ai.apiKeyRef` (`core/workspace/env.js`'s real AES-256-GCM store) → `null`. Never guesses, never falls back to a placeholder key.
- `listProviders({ workspace })` - every known provider's id, default model, and whether it's currently configured (a key is resolvable, or it's a local provider).
- `requiresApiKey(providerId)` / `envVarForProvider(providerId)` - small lookups `commands/ai.js` uses to print an actionable "missing API key" message.

## Adding a new provider

Most new cloud providers that speak the OpenAI-compatible format need
**zero new code** - just a new `case` in `getProvider()` calling
`createOpenAICompatibleProvider` with the right `baseUrl` (see how
Groq/OpenRouter/LM Studio are each three lines). A genuinely different
wire format needs its own `providers/<name>.js` implementing the same
`AIProvider` shape, then one `case` in `getProvider()` and one entry in
`KNOWN_PROVIDERS`.
