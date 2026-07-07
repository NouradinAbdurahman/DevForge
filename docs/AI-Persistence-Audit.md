# AI Persistence & Configuration Audit Report

## Methodology

Every file in the AI persistence chain was inspected:
- `core/config.js` — config load/save
- `core/ai/credentials/manager.js` — credential resolution
- `core/ai/credentials/selector.js` — backend selection
- `core/ai/credentials/backends/*.js` — storage backends
- `core/ai/providers/index.js` — provider registry
- `commands/ai.js` — CLI commands
- `tui/data.js` — TUI data wrappers
- `tui/store.js` — TUI global state
- `tui/pages/AIPage.js` — AI Assistant
- `tui/pages/AIProvidersPage.js` — AI Providers
- `tui/pages/AIModelsPage.js` — AI Models
- `tui/pages/AICredentialsPage.js` — AI Credentials
- `tui/pages/AIOverviewPage.js` — AI Overview
- `tui/pages/ConfigPage.js` — Configuration page

---

## Phase 1: Architecture Audit

### Configuration Storage

**Config file**: `~/.config/devforgekit/config.yaml` (YAML, via `js-yaml`)

**`setConfigValue(key, value)`** in `core/config.js:92`:
- Reads existing YAML from disk
- Sets the key
- Writes synchronously via `writeFileSync`
- **No async, no race, no cache** — immediate persistence

**`loadConfig()`** in `core/config.js:78`:
- Reads from disk on every call (defaults < repo `.devforgekit.yml` < user `config.yaml` < env vars)
- **No caching** — every `loadConfig()` call hits the file

### Field-by-Field Audit

| Field | Default | Stored In | Saves | Loads | Survives Restart |
|---|---|---|---|---|---|
| `aiProvider` | `"none"` | config.yaml | ✅ `setConfigValue("aiProvider", id)` | ✅ `loadConfig().aiProvider` | ✅ |
| `aiModel` | `null` | config.yaml | ✅ `setConfigValue("aiModel", model)` | ✅ `loadConfig().aiModel` | ✅ |
| `aiEndpoint` | `null` | config.yaml | ✅ `setConfigValue("aiEndpoint", url)` | ✅ `loadConfig().aiEndpoint` | ✅ |

Fields like `temperature`, `stream`, `maxTokens`, `systemPrompt` are **not in DEFAULTS** and were never part of the config system. They are per-invocation CLI flags only. This is not a bug — they were never designed to persist.

### API Key Audit

**Storage**: Credential backend (selected by `selector.js`)
- macOS production → `KeychainBackend` (macOS Keychain via `security` CLI)
- Fallback → `FileBackend` (`~/.config/devforgekit/credentials/ai-keys.json`, 0600 perms)
- Test → `MemoryBackend` (in-memory only)

**Resolution order** (`resolveCredential()` in `manager.js:47`):
1. Workspace secret (`workspace.ai.apiKeyRef`)
2. Credential backend (`getBackend().get(providerId)`)
3. Environment variable (`OPENAI_API_KEY`, etc.)

**Write path**: `addKey(providerId, apiKey)` → `getBackend().set(providerId, apiKey)` — synchronous, immediate.

**Read path**: `resolveCredential()` → `getBackend().get(providerId)` — no caching, reads from backend every time.

**Multiple providers**: Each provider has its own key slot (keyed by provider ID). Multiple providers can coexist. ✅

**Survives restart**: Yes on macOS (Keychain persists). ✅

### Startup Audit

When DevForgeKit TUI launches:
1. Each page calls `loadConfig()` on render → reads `~/.config/devforgekit/config.yaml` from disk
2. `getBackend()` lazily creates the credential backend (singleton)
3. `resolveCredential()` checks workspace → backend → env
4. Pages read `config.aiProvider`, `config.aiModel`, `config.aiEndpoint` directly from `loadConfig()`

**This works correctly.** No stale state, no missing restoration.

### Shutdown Audit

- `setConfigValue()` uses `writeFileSync` — synchronous, no pending writes
- `getBackend().set()` is synchronous (Keychain `execSync`, file `writeFileSync`)
- **No async race, no data loss on shutdown.** ✅

### TUI Audit

| Action | Persists? | How |
|---|---|---|
| Provider switch (P key) | ✅ | `setConfigValue("aiProvider", id)` |
| Model select (Enter on Models page) | ✅ | `setConfigValue("aiModel", model)` |
| Add API key (A key) | ✅ | `addKey()` → `getBackend().set()` |
| Remove API key (R key) | ✅ | `removeProviderKey()` → `getBackend().remove()` |
| Config page provider cycling | ✅ | `setConfigValue("aiProvider", value)` |
| **Edit Endpoint (E key)** | **✗ BROKEN** | **Action advertised but no handler wired** |

### CLI Audit

| Command | Persists? | How |
|---|---|---|
| `ai setup` | ✅ | `setConfigValue("aiProvider")` + `addKey()` + `setConfigValue("aiModel")` |
| `ai provider use <id>` | ✅ | `setConfigValue("aiProvider", id)` |
| `ai model use <model>` | ✅ | `setConfigValue("aiModel", model)` |
| `ai key add [provider]` | ✅ | `addKey()` → `getBackend().set()` |
| `ai key remove [provider]` | ✅ | `removeProviderKey()` → `getBackend().remove()` |
| `ai key rotate [provider]` | ✅ | `removeProviderKey()` + `addKey()` |
| `config set <key> <value>` | ✅ | `setConfigValue(key, value)` |

### Cache Audit

| Cache | Location | Invalidation |
|---|---|---|
| `aiProviders()` | `data.js` `cached()` | `refreshAll()` (R key) |
| `aiConfig()` | **Not cached** | Reads fresh every time ✅ |
| `aiHistory()` | `data.js` `cached()` | `refreshAll()` |
| Model list | `core/ai/models/cache.js` | 1-hour TTL, `clearModelCache()`, `--refresh` |
| Credential lookup | **Not cached** | Reads from backend every time ✅ |
| `loadConfig()` | **Not cached** | Reads from disk every time ✅ |

### Workspace Audit

AI configuration is **global**, not workspace-specific:
- `aiProvider`, `aiModel`, `aiEndpoint` → global `~/.config/devforgekit/config.yaml`
- API keys → global credential backend
- Workspace can override API key via `workspace.ai.apiKeyRef` (checked first in resolution)

This is correct for the PRD's desired behavior: "configure once, works everywhere."

---

## Phase 2: Findings

### Already Correct (leave untouched)

1. ✅ `aiProvider` stored in `config.yaml`, persists across restarts
2. ✅ `aiModel` stored in `config.yaml`, persists across restarts
3. ✅ `aiEndpoint` stored in `config.yaml`, persists across restarts (via CLI `config set`)
4. ✅ API keys stored in credential backend, persist across restarts on macOS
5. ✅ `setConfigValue()` is synchronous (`writeFileSync`) — no async race
6. ✅ `loadConfig()` reads from disk on every call — no stale cache
7. ✅ Credential resolution order: workspace → keychain → env
8. ✅ All CLI commands persist correctly
9. ✅ TUI provider switching persists immediately
10. ✅ TUI model selection persists immediately
11. ✅ TUI key add/remove persists immediately
12. ✅ Config page AI provider cycling persists immediately
13. ✅ Model list cache with TTL and manual refresh
14. ✅ No duplicate persistence exists
15. ✅ Startup restores complete AI configuration automatically

### Needs Fix

1. ✗ **`AIProvidersPage` "Edit Endpoint" action is advertised but not wired**
   - The ACTIONS list shows `["E", "Edit Endpoint"]`
   - There is no handler for the `"e"` key in the `useInput` callback
   - Users cannot edit the endpoint from the TUI
   - Must use CLI `devforgekit config set aiEndpoint <url>` instead
   - **Impact**: Minor — endpoint is rarely changed, and CLI works. But the TUI advertises a broken action.

---

## Phase 3: Minimal Changes

Only one fix needed: wire the "E" key handler in `AIProvidersPage` to prompt for an endpoint URL and persist it via `setConfigValue("aiEndpoint", ...)`.
