# AI Provider System Audit — Pre-v1.3.8

**Date:** 2025-07-06
**Auditor:** Cascade (AI coding assistant)
**Scope:** Complete audit of the current AI provider implementation in DevForgeKit v1.3.7

---

## 1. Provider Audit

### 1.1 OpenAI

| Field | Value |
|---|---|
| **Provider ID** | `openai` |
| **API Protocol** | OpenAI Chat Completions (`/chat/completions`, `/models`, `/embeddings`) |
| **Authentication** | Bearer token in `Authorization` header |
| **Environment Variable** | `OPENAI_API_KEY` |
| **Config Values** | `aiProvider: "openai"`, `aiModel`, `aiEndpoint` |
| **Streaming Support** | Yes (SSE `data: {...}` lines) |
| **Local or Cloud** | Cloud |
| **Default Model** | `gpt-4o-mini` |
| **Default Endpoint** | `https://api.openai.com/v1` |
| **Custom Endpoint** | Yes (via `aiEndpoint` config or `--endpoint` flag) |
| **Embeddings** | Yes (`text-embedding-3-small`) |
| **Implementation** | `createOpenAICompatibleProvider()` in `providers/openaiCompatible.js` |

### 1.2 Anthropic

| Field | Value |
|---|---|
| **Provider ID** | `anthropic` |
| **API Protocol** | Anthropic Messages API (`/messages`, `/models`) |
| **Authentication** | `x-api-key` header + `anthropic-version: 2023-06-01` |
| **Environment Variable** | `ANTHROPIC_API_KEY` |
| **Config Values** | `aiProvider: "anthropic"`, `aiModel`, `aiEndpoint` |
| **Streaming Support** | Yes (SSE with typed `content_block_delta` events) |
| **Local or Cloud** | Cloud |
| **Default Model** | `claude-3-5-sonnet-latest` |
| **Default Endpoint** | `https://api.anthropic.com/v1` |
| **Custom Endpoint** | Yes (via `aiEndpoint` config or `--endpoint` flag) |
| **Embeddings** | No (throws `unsupported`) |
| **Implementation** | `createAnthropicProvider()` in `providers/anthropic.js` |

### 1.3 Gemini

| Field | Value |
|---|---|
| **Provider ID** | `gemini` |
| **API Protocol** | Google Generative Language API (`:generateContent`, `:streamGenerateContent`, `:embedContent`, `/models`) |
| **Authentication** | API key as query parameter (`?key=...`) |
| **Environment Variable** | `GEMINI_API_KEY` |
| **Config Values** | `aiProvider: "gemini"`, `aiModel`, `aiEndpoint` |
| **Streaming Support** | Yes (SSE with Gemini-specific `candidates[].content.parts[].text` shape) |
| **Local or Cloud** | Cloud |
| **Default Model** | `gemini-1.5-flash` |
| **Default Endpoint** | `https://generativelanguage.googleapis.com/v1beta` |
| **Custom Endpoint** | Yes (via `aiEndpoint` config or `--endpoint` flag) |
| **Embeddings** | Yes (`text-embedding-004`, one request per input) |
| **Implementation** | `createGeminiProvider()` in `providers/gemini.js` |

### 1.4 Groq

| Field | Value |
|---|---|
| **Provider ID** | `groq` |
| **API Protocol** | OpenAI-compatible (`/chat/completions`, `/models`) |
| **Authentication** | Bearer token in `Authorization` header |
| **Environment Variable** | `GROQ_API_KEY` |
| **Config Values** | `aiProvider: "groq"`, `aiModel`, `aiEndpoint` |
| **Streaming Support** | Yes (SSE, same as OpenAI) |
| **Local or Cloud** | Cloud |
| **Default Model** | `llama-3.1-8b-instant` |
| **Default Endpoint** | `https://api.groq.com/openai/v1` |
| **Custom Endpoint** | Yes (via `aiEndpoint` config or `--endpoint` flag) |
| **Embeddings** | No (not enabled in factory call) |
| **Implementation** | `createOpenAICompatibleProvider()` in `providers/openaiCompatible.js` |

### 1.5 OpenRouter

| Field | Value |
|---|---|
| **Provider ID** | `openrouter` |
| **API Protocol** | OpenAI-compatible (`/chat/completions`, `/models`) |
| **Authentication** | Bearer token + extra headers (`HTTP-Referer`, `X-Title`) |
| **Environment Variable** | `OPENROUTER_API_KEY` |
| **Config Values** | `aiProvider: "openrouter"`, `aiModel`, `aiEndpoint` |
| **Streaming Support** | Yes (SSE, same as OpenAI) |
| **Local or Cloud** | Cloud |
| **Default Model** | `openai/gpt-4o-mini` |
| **Default Endpoint** | `https://openrouter.ai/api/v1` |
| **Custom Endpoint** | Yes (via `aiEndpoint` config or `--endpoint` flag) |
| **Embeddings** | No (not enabled in factory call) |
| **Implementation** | `createOpenAICompatibleProvider()` in `providers/openaiCompatible.js` |

### 1.6 Ollama

| Field | Value |
|---|---|
| **Provider ID** | `ollama` |
| **API Protocol** | Ollama HTTP API (`/api/chat`, `/api/tags`, `/api/embeddings`) |
| **Authentication** | None (local server) |
| **Environment Variable** | None |
| **Config Values** | `aiProvider: "ollama"`, `aiModel`, `aiEndpoint` |
| **Streaming Support** | Yes (NDJSON, not SSE — distinct wire format) |
| **Local or Cloud** | Local |
| **Default Model** | `llama3` |
| **Default Endpoint** | `http://localhost:11434` |
| **Custom Endpoint** | Yes (via `aiEndpoint` config or `--endpoint` flag) |
| **Embeddings** | Yes (one request per input) |
| **Implementation** | `createOllamaProvider()` in `providers/ollama.js` |

### 1.7 LM Studio

| Field | Value |
|---|---|
| **Provider ID** | `lmstudio` |
| **API Protocol** | OpenAI-compatible (`/chat/completions`, `/models`) |
| **Authentication** | None (local server, uses `"not-needed"` placeholder) |
| **Environment Variable** | None |
| **Config Values** | `aiProvider: "lmstudio"`, `aiModel`, `aiEndpoint` |
| **Streaming Support** | Yes (SSE, same as OpenAI) |
| **Local or Cloud** | Local |
| **Default Model** | `local-model` |
| **Default Endpoint** | `http://localhost:1234/v1` |
| **Custom Endpoint** | Yes (via `aiEndpoint` config or `--endpoint` flag) |
| **Embeddings** | No (not enabled in factory call) |
| **Implementation** | `createOpenAICompatibleProvider()` in `providers/openaiCompatible.js` |

---

## 2. Configuration Audit — Credential Resolution

### Current Resolution Order (as implemented in `providers/index.js:resolveApiKey()`)

```
1. Environment variable (e.g. OPENAI_API_KEY)
2. Workspace secret (via workspace.ai.apiKeyRef → getSecret())
3. null ("not configured")
```

### Discrepancy from PRD

The PRD specifies the desired order as:
1. Workspace Secret
2. OS Secure Credential Store (new)
3. Environment Variables
4. Fail with explanation

**The current implementation puts env vars FIRST, workspace secrets second.** The PRD wants workspace secrets first. This is a real difference that needs to change.

### How Credentials Are Currently Stored

| Method | Where | Plaintext? | Used? |
|---|---|---|---|
| Environment variable | Shell profile / CI secrets | Yes (in env) | Yes — primary method |
| Workspace secret | `~/.config/devforgekit/workspaces/<name>/env/secrets.enc.json` | No (AES-256-GCM) | Yes — secondary, requires manual workspace setup |
| `config.yaml` | `~/.config/devforgekit/config.yaml` | Yes | **No** — config only stores `aiProvider`, `aiModel`, `aiEndpoint`, never the key itself |
| OS Keychain | N/A | N/A | **Not implemented** |

### Key Finding

**API keys are never stored in `config.yaml`** — this is already correct. The config only stores `aiProvider`, `aiModel`, `aiEndpoint`. Keys come from env vars or workspace secrets. However, there is **no OS-level secure storage** (macOS Keychain, etc.).

---

## 3. Command Audit

### All AI Commands

| Command | Requires Provider | Requires Model | Requires API Key | Works Offline | Supports Streaming | Supports Local |
|---|---|---|---|---|---|---|
| `ai` (bare) | Yes | No (uses default) | Yes (if cloud) | Yes (if local) | No | Yes |
| `ai chat` | Yes | No | Yes (if cloud) | Yes (if local) | Yes (`--stream`) | Yes |
| `ai doctor` | Yes | No | Yes (if cloud) | Yes (if local) | No | Yes |
| `ai explain <topic>` | Yes | No | Yes (if cloud) | Yes (if local) | No | Yes |
| `ai review` | Yes | No | Yes (if cloud) | Yes (if local) | No | Yes |
| `ai generate [prompt]` | Yes | No | Yes (if cloud) | Yes (if local) | No | Yes |
| `ai analyze` | Yes | No | Yes (if cloud) | Yes (if local) | No | Yes |
| `ai summarize` | Yes | No | Yes (if cloud) | Yes (if local) | No | Yes |
| `ai optimize` | Yes | No | Yes (if cloud) | Yes (if local) | No | Yes |
| `ai repair` | Yes | No | Yes (if cloud) | Yes (if local) | No | Yes |
| `ai planner <goal>` | Yes | No | Yes (if cloud) | Yes (if local) | No | Yes |
| `ai models` | Yes | No | Yes (if cloud) | Yes (if local) | No | Yes |
| `ai providers` | No (lists all) | No | No | No (health check hits network) | No | Yes |
| `ai history` | No | No | No | Yes | No | N/A |

### Key Finding

Every command that needs a provider goes through `ensureProviderReady()`, which:
1. Resolves provider from `--provider` flag or `config.aiProvider`
2. If no provider configured → prints "No AI provider configured" + hints
3. If provider needs API key but none found → prints "configured but no API key" + hints
4. Only then proceeds to create the provider client

**This is already good** — but the error messages are generic, not provider-specific. The PRD wants provider-specific diagnosis (e.g. "Ollama is not running" vs "OpenAI key invalid").

---

## 4. Configuration UX Audit — First-Time User Onboarding

### Current Steps to Enable AI (e.g. OpenAI)

1. **Read documentation** to learn which env var to set
2. **Set environment variable**: `export OPENAI_API_KEY=sk-...` in `~/.zshrc` or similar
3. **Reload shell** or `source ~/.zshrc`
4. **Set provider in config**: `devforgekit config set aiProvider openai`
5. **Optionally set model**: `devforgekit config set aiModel gpt-4o-mini`
6. **Run a command**: `devforgekit ai doctor`

### Alternative: Workspace Secret Path

1. **Create a workspace**: `devforgekit workspace create default`
2. **Add a secret**: `devforgekit workspace env set default OPENAI_KEY sk-... --secret`
3. **Edit workspace.json**: manually add `ai.apiKeyRef: "OPENAI_KEY"` to the workspace document
4. **Set provider in config**: `devforgekit config set aiProvider openai`
5. **Activate workspace**: `devforgekit workspace switch default`
6. **Run a command**: `devforgekit ai doctor`

### Step Count

- **Env var path**: 5-6 steps (including reading docs and reloading shell)
- **Workspace secret path**: 6+ steps (including manually editing JSON)

### Verdict

**Both paths require 5+ manual steps and reading documentation.** The PRD's goal of "under two minutes without reading documentation" is not met. The workspace secret path is particularly complex — it requires manually editing a JSON file to set `ai.apiKeyRef`.

---

## 5. TUI Integration Audit

### Current AI Page (`AIPage.js`)

- Shows a chat interface (request/response, no streaming)
- Empty state: "No AI provider configured" + text pointing to Configuration page
- No provider management, key management, or model selection
- No way to configure AI from within the TUI

### Current Configuration Page (`ConfigPage.js`)

- `aiProvider` field cycles through: `none`, `openai`, `anthropic`, `ollama` (only 4 of 7 providers!)
- No API key field
- No model selection
- No connection test
- No way to add/remove keys

### Key Finding

**The TUI provides no way to configure AI credentials.** A user must drop to the CLI, set env vars, and come back. The Configuration page only lets you pick a provider (and only 4 of 7), with no key management.

---

## 6. Inconsistencies Found

### 6.1 Config Page Provider List is Incomplete

`ConfigPage.js` line 24: `aiProvider` values are `["none", "openai", "anthropic", "ollama"]` — missing `gemini`, `groq`, `openrouter`, `lmstudio`.

### 6.2 Resolution Order Differs from PRD

Current: env var → workspace secret → null
PRD wants: workspace secret → OS keychain → env var → fail with explanation

### 6.3 No Secure Storage

No OS-level keychain integration. Env vars are the primary method, which means:
- Keys sit in plaintext in shell profiles
- Keys are visible in `ps`/`env` output
- No `ai key list` command to check status
- No `ai key remove` command to revoke

### 6.4 No `ai setup` Command

No guided onboarding. Users must know which env var to set for which provider.

### 6.5 No `ai key` Subcommands

No key management commands at all. Cannot list, add, remove, test, or rotate keys.

### 6.6 No `ai provider` Subcommands

No `ai provider list/use/current`. Provider switching requires `config set aiProvider <id>`.

### 6.7 No `ai model` Subcommands

No `ai model list/current/use`. Model selection requires `config set aiModel <name>` or `--model` flag.

### 6.8 Generic Error Messages

When AI commands fail, the error is a generic `AIProviderError` with HTTP status code. No provider-specific diagnosis:
- No "Ollama is not running" detection
- No "invalid API key" vs "insufficient credits" distinction
- No recovery commands in error output

### 6.9 No Model Caching

`ai models` always hits the provider's API. No local caching of model lists.

### 6.10 TUI AI Page Has No Provider Management

The AI page is chat-only. No provider status, no key management, no model selection, no connection testing.

---

## 7. What Already Works Well (Keep These)

- **Provider abstraction** — 7 providers, 3 distinct wire formats, clean factory pattern
- **`getProvider()` / `resolveApiKey()`** — centralized, well-tested
- **`listProviders()`** — already reports `configured` status per provider
- **`checkHealth()`** — every provider implements it, never throws
- **`listModels()`** — every provider implements it
- **`ai providers --check`** — live health check across all providers
- **`ai models`** — lists models for configured provider
- **`ai history`** — local event log
- **Workspace secrets** — real AES-256-GCM encryption, already works
- **`--provider`/`--model`/`--endpoint` flags** — per-command overrides
- **Dependency injection** — `fetchImpl` for testing without network calls
- **Empty state handling** — `ensureProviderReady()` catches unconfigured/missing-key states

---

## 8. Implementation Plan Summary

Based on the audit, here's what needs to be built:

| Phase | What | Files |
|---|---|---|
| 3 | OS Keychain integration | New: `core/ai/credentials/keychain.js` |
| 4 | Unified credential resolver | Modify: `providers/index.js` (add keychain to resolution) |
| 2 | `ai setup` command | New: `commands/ai.js` (add subcommand) |
| 5 | `ai key *` subcommands | New: `core/ai/credentials/manager.js`, modify: `commands/ai.js` |
| 6 | `ai provider *` subcommands | Modify: `commands/ai.js` |
| 7 | `ai model *` subcommands | New: `core/ai/models/cache.js`, modify: `commands/ai.js` |
| 8 | Provider-specific error diagnosis | New: `core/ai/diagnostics/errors.js`, modify: `commands/ai.js` |
| 9 | TUI AI Providers page | New: `tui/pages/AIProvidersPage.js`, modify: `tui/store.js` |
| 10 | Config page cleanup | Modify: `tui/pages/ConfigPage.js` |
| 11 | Documentation rewrite | Modify: `docs/AIAssistant.md` |

### Backward Compatibility

All existing env var workflows **must continue to work**. The new keychain layer is additive — it sits between workspace secrets and env vars in the resolution order. No existing code path changes behavior; the new layer is simply checked first.

---

## Conclusion

The current AI provider system has a solid architectural foundation — the provider abstraction, wire format implementations, and health checking are all well-built. The gaps are entirely in UX and credential management:

1. **No guided setup** — users must read docs to know which env var to set
2. **No secure storage** — keys live in plaintext env vars or require complex workspace setup
3. **No key management commands** — can't list, test, rotate, or remove keys
4. **No provider/model switching commands** — must use `config set`
5. **Generic error messages** — no provider-specific diagnosis
6. **TUI has no provider management** — chat-only AI page, incomplete provider list on config page

The PRD's phases 2-11 build directly on top of the existing architecture without replacing any provider implementations — exactly as specified.
