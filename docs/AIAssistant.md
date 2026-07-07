# AI Development Assistant

The AI Development Assistant (v1.3.0, enhanced in v1.3.8) is DevForgeKit's
intelligence layer: a unified provider abstraction over cloud and local
LLMs, a context engine that assembles what DevForgeKit already knows about
the machine, and a set of AI-assisted commands that turn that context into
human-readable guidance - not a chatbot bolted on the side, but every
existing subsystem (registry, compatibility, workspace, project generator)
made reasoned-over.

## Quick Start

```bash
devforgekit ai setup       # interactive wizard — provider → model → key → test, all in one flow
devforgekit ai status      # full configuration status — provider, model, credentials, validation
devforgekit ai doctor      # AI-narrated diagnosis of your environment
devforgekit ai fix         # automatically repair invalid AI configuration
devforgekit ai stats       # usage statistics — requests, most used model, avg response time
devforgekit ai benchmark   # compare all configured providers — latency, tokens, streaming
devforgekit ai export      # export config (no API keys) — perfect for teams
devforgekit ai import      # import config — asks for missing keys
devforgekit ai reset       # reset AI config — keeps keys unless --all
```

That's it. The `ai setup` wizard:
1. Shows a list of 7 providers with icons (◉ OpenAI, ◎ Anthropic, etc.)
2. Prompts for your API key (hidden input, stored in OS secure storage — Keychain on macOS, encrypted file on Linux/Windows)
3. Tests the connection
4. Fetches and presents available models for selection
5. Sets everything as active in one flow

No environment variables to set. No config files to edit. No documentation
to read.

## Supported Providers

| Provider | Type | Auth | Streaming |
|---|---|---|---|
| ◉ OpenAI | Cloud | API key | Yes |
| ◎ Anthropic | Cloud | API key | Yes |
| ◆ Google Gemini | Cloud | API key | Yes |
| ⬣ Groq | Cloud | API key | Yes |
| ⬢ OpenRouter | Cloud | API key | Yes |
| Ollama | ◈ Local | None | Yes |
| LM Studio | ▣ Local | None | Yes |

## Credential Management

API keys are stored in the OS secure credential store (macOS Keychain),
never in `config.yaml` or `.env`. If keychain is unavailable, a
0600-permission encrypted file is used as fallback. The credential
backend is automatically selected based on environment:

| Environment | Backend |
|---|---|
| `NODE_ENV=test` | In-memory (test) |
| `CI=true` | Mock (CI) |
| macOS (production) | Keychain |
| Other (production) | Encrypted file |

The active backend is shown in `ai status` and on the AI Overview page.

```bash
devforgekit ai key list              # show which providers have keys (never shows values)
devforgekit ai key add openai        # add or update a key
devforgekit ai key remove openai     # remove a key
devforgekit ai key test openai       # test connection + auth
devforgekit ai key rotate openai     # replace a key with a new one
devforgekit ai key export keys.json  # backup keys to a file
devforgekit ai key import keys.json  # restore keys from a file
devforgekit ai key migrate           # move env-var keys to keychain
```

### Credential Resolution Order

When an AI command needs an API key, DevForgeKit checks in this order:

1. **Workspace secret** (via `workspace.ai.apiKeyRef`)
2. **OS secure credential store** (macOS Keychain)
3. **Environment variable** (e.g. `OPENAI_API_KEY`)
4. **Fail with explanation** (never silently use a fake key)

This means environment variables continue to work for CI/CD and advanced
users, but keys stored via `ai setup` or `ai key add` take precedence.

## Model Browser

The TUI Models page (shortcut `M`) provides a full model browsing experience:

- **Search**: Press `/` to filter models by name
- **Sort**: Press `S` to cycle through sort modes (Name, Newest, Fastest, Cheapest, Context)
- **Tabs**: Press `T` to switch between All Models, Favorites, and Recent
- **Favorites**: Press `F` to star/unstar the highlighted model (persisted to config)
- **Recent**: Last 10 used models are tracked automatically
- **Model Info Panel**: Selecting a model shows context window, vision support, reasoning quality, coding rating, latency, cost, release year, and supported features

## Usage Statistics

DevForgeKit tracks AI usage locally (never uploaded):

```bash
devforgekit ai stats              # show usage statistics
devforgekit ai stats --clear      # clear all statistics
```

Shows total requests, today's count, this week's count, most used model, favorite provider, average response time, and per-command breakdown.

## Benchmark

```bash
devforgekit ai benchmark          # compare all configured providers
devforgekit ai benchmark --prompt "custom prompt"
```

Runs the same prompt against every configured provider and reports latency, token count, streaming support, and status. Identifies the fastest provider.

## Export and Import

```bash
devforgekit ai export [file]      # export config (no API keys)
devforgekit ai import <file>      # import config, asks for missing keys
```

Export includes provider, model, endpoint, favorites, and recent models — never API keys. Import restores the configuration and interactively asks for any missing API keys.

## Reset

```bash
devforgekit ai reset              # reset config, keeps API keys
devforgekit ai reset --all        # reset config AND remove all API keys
```

Clears provider, model, endpoint, model cache, history, usage stats, favorites, and recent models. API keys are preserved unless `--all` is specified.

## Provider and Model Management

```bash
devforgekit ai provider list         # list all providers with status
devforgekit ai provider use openai   # switch active provider (validates model compatibility)
devforgekit ai provider current      # show current provider details

devforgekit ai model list            # list available models (cached)
devforgekit ai model list --refresh  # force fresh fetch
devforgekit ai model current         # show current model
devforgekit ai model use gpt-4o      # set default model
```

### Safe Provider Switching

When switching providers, DevForgeKit automatically validates the current
model against the new provider. If the model is incompatible (e.g. a Claude
model under the OpenAI provider), it is automatically reset to the new
provider's default model with a warning. This prevents invalid
provider/model combinations from persisting.

Local providers (Ollama, LM Studio) and OpenRouter accept any model — no
reset is performed when switching to these providers.

## Configuration Validation and Recovery

DevForgeKit validates the AI configuration at startup and on every status
check. The validation verifies:

- **Provider exists** and is known
- **Model is compatible** with the active provider
- **API key is available** (for cloud providers)
- **Credential backend is operational**

If any check fails, the issue is displayed with a specific recovery
command. The `ai fix` command automatically repairs what it can (invalid
models are reset to provider defaults) and offers interactive recovery
actions for issues that require user input.

```bash
devforgekit ai status              # full status report with validation
devforgekit ai fix                 # auto-repair + interactive recovery
```

### AI Health Status

Every AI page in the TUI dashboard shows a real-time health indicator:

| Status | Meaning |
|---|---|
| ✓ Ready | Provider configured, key available, model valid |
| ⚠ Missing API Key | Provider set but no key found |
| ⚠ Invalid Model | Model may not belong to the active provider |
| ⚠ Backend Issue | Credential backend not fully operational |
| ✗ Not Configured | No provider set |
| ✗ Provider Misconfigured | Unknown or invalid provider |

### AI Status Card

The AI Overview page displays a complete status card showing:

- Provider name and status
- Credential backend (e.g. "Apple Keychain", "Encrypted File")
- API key state (Stored/Missing)
- Current model (with default indicator)
- Endpoint URL
- Connection health (with latency)
- Cached model count

## Error Diagnosis

When an AI command fails, DevForgeKit explains exactly what went wrong and
what to do:

- **Missing key**: "OpenAI is not configured. Run `devforgekit ai setup`"
- **Invalid key**: "Authentication failed. Run `devforgekit ai key add openai`"
- **Rate limited**: "Your request was rate-limited. Check your account usage."
- **Ollama not running**: "Start it with `ollama serve`"
- **LM Studio not running**: "Start the LM Studio server"
- **Server error**: "This is a provider-side issue, not your configuration."

Every failure includes a specific recovery command.

## Honesty first

With no provider configured (the default), every `ai` command prints a
clear, actionable message instead of crashing or faking a response:

```text
! No AI provider configured.
i Run 'devforgekit ai setup' to get started in under a minute.
```

Every provider client is a real REST client - no mocked responses ship in
production code. See [ProviderAPI.md](ProviderAPI.md) for the wire-format
details and [PlatformArchitecture.md](PlatformArchitecture.md)'s
Compatibility Engine section for the same honesty precedent this module
follows (LTS status, `compatibility update`'s "local files only" scope).

## Architecture

`cli/src/core/ai/`, one concern per directory (mirrors `core/compatibility/`
and `core/workspace/`):

| Module | Responsibility | Doc |
| --- | --- | --- |
| `providers/` | Real REST clients for every provider + the registry that builds them | [ProviderAPI.md](ProviderAPI.md) |
| `credentials/` | Unified credential manager + OS keychain integration | this doc |
| `context/` | Pure aggregation of what DevForgeKit already knows - no new data collection | [ContextEngine.md](ContextEngine.md) |
| `prompts/` | Base system prompt, 10 domain snippets, one instruction template per command | [PromptLibrary.md](PromptLibrary.md) |
| `memory/` | A capped local event log - never a chat transcript | [MemorySystem.md](MemorySystem.md) |
| `diagnostics/doctor.js` | Turns a scan into the worked "summary/reason/fix/estimatedTime/risk" example | this doc |
| `diagnostics/errors.js` | Provider-specific error diagnosis with recovery commands | this doc |
| `planner/planner.js` | Maps a goal onto real registry collections/recipes/components | this doc |
| `chat/session.js` | In-memory turn-taking chat session | this doc |
| `embeddings/search.js` | Real embeddings when supported, lexical fallback otherwise | this doc |
| `tools/registry.js` | A plain function registry the code above calls - not an autonomous agent loop | this doc |
| `models/models.js` | Lists a provider's available models | this doc |
| `models/cache.js` | Model list caching with TTL | this doc |
| `models/meta.js` | Static model metadata knowledge base (context, vision, cost, etc.) | this doc |
| `providers/meta.js` | Provider icons, capabilities matrix | this doc |
| `validation.js` | Configuration validation, health status, auto-repair, safe provider switching | this doc |
| `memory/stats.js` | Local usage statistics tracking (never uploaded) | this doc |

## CLI

```bash
# Setup and management
devforgekit ai setup                 # guided provider setup (recommended first step)
devforgekit ai key list              # show configured providers
devforgekit ai key add <provider>    # add/update a key
devforgekit ai key remove <provider> # remove a key
devforgekit ai key test [provider]   # test connection
devforgekit ai key rotate [provider] # replace a key
devforgekit ai key export [file]     # backup keys
devforgekit ai key import <file>     # restore keys
devforgekit ai key migrate           # move env-var keys to keychain

devforgekit ai provider list         # list all providers
devforgekit ai provider use <id>     # switch provider
devforgekit ai provider current      # show current provider

devforgekit ai model list [--refresh] # list models (cached)
devforgekit ai model current         # show current model
devforgekit ai model use <model>     # set default model

# AI commands
devforgekit ai                       # status if unconfigured, else opens chat
devforgekit ai chat [--stream]
devforgekit ai status                # full configuration status report
devforgekit ai fix                   # auto-repair AI configuration issues
devforgekit ai doctor                # AI-narrated diagnosis (includes config audit)
devforgekit ai stats                 # usage statistics (local only)
devforgekit ai benchmark [--prompt]  # compare all configured providers
devforgekit ai export [file]         # export config (no API keys)
devforgekit ai import <file>         # import config, asks for missing keys
devforgekit ai reset [--all]         # reset AI config (keeps keys unless --all)
devforgekit ai explain <topic>       # e.g. "compatibility", or a component name
devforgekit ai review                # inside a project directory
devforgekit ai compare <a> <b>       # compare two real components/stacks (v2.1.3)
devforgekit ai generate [prompt]     # maps onto a real Project Generator stack
devforgekit ai analyze
devforgekit ai summarize
devforgekit ai optimize
devforgekit ai repair [-y]           # AI-narrated compatibility repair
devforgekit ai planner <goal>        # e.g. "I want to become a backend engineer"
devforgekit ai models                # list models (alias for 'ai model list')
devforgekit ai providers [--check]   # show all providers' health
devforgekit ai health [--live]       # AI Health Score - one percentage + a per-check breakdown (v2.1.3)
devforgekit ai history [--clear|--export <file>]  # local AI event log
```

## Never invents, never executes without confirmation

Two scope boundaries carried through every command:

- **`ai generate`/`ai planner` select from what's real.** `generate` maps
  a description onto one of the Project Generator's actual 17 stacks
  (`cli/src/generators/index.js`) and runs the exact same
  `runProjectGenerator` every `devforgekit new` call already uses - never
  freehand file generation. `planner` maps a goal onto real registry
  collections/recipes/components (passed to the model as grounding data);
  any name the model returns that isn't real is dropped and reported in
  `plan.dropped`, never silently acted on.
- **No autonomous execution.** `ai repair` explains a repair plan, then
  runs it through the exact same `core/compatibility/repair.js`
  `executeRepairPlan` every `compatibility repair` call uses - a
  conflicting-package removal still requires explicit confirmation. The
  `tools/` module (PRD naming) is a plain function registry the
  assistant's own code calls directly (gather context, run a scan) - not
  an LLM function-calling loop that decides what to execute on its own.

## Dashboard

The TUI dashboard has a dedicated AI section with eight sub-pages, plus an AI widget on the main Dashboard:

- **AI Assistant** (shortcut `e`/`a`): request/response chat, grounded the same
  way `ai chat` is. Not token-streamed - the CLI's `ai chat --stream`
  covers real token streaming.
- **AI Overview** (shortcut `o`): complete status card showing provider,
  model, credential backend, API key state, endpoint, connection health,
  and cached model count. The landing page for the AI section.
- **AI Providers** (shortcut `p`): provider list with ✓/✗ status, detail
  panel showing current provider/model/auth source, and actions to test
  connections, switch providers (with safe model validation), edit
  endpoints, and add/remove keys. Never displays secret values.
- **AI Models** (shortcut `m`): full model browser with search (`/`), sort (`S` — Name, Newest, Fastest, Cheapest, Context), tabs (`T` — All, Favorites, Recent), star favorites (`F`), and a model info panel showing context window, vision, reasoning, coding, latency, cost, and supported features.
- **AI Credentials** (shortcut `k`): credential management — add, remove,
  test, export, import, and migrate API keys.
- **AI Diagnostics** (shortcut `d`): runs a series of health checks
  (API key, authentication, endpoint, network, latency, streaming, model
  access) and displays results with recovery actions.
- **AI Capabilities** (shortcut `c`): provider capability matrix showing
  which providers support chat, vision, tools, JSON, streaming, function
  calling, reasoning, and embeddings.
- **AI History** (shortcut `h`): local AI event log.

The main Dashboard page includes an AI widget showing status, provider
(with icon), model, credential backend, and cached model count.

Every AI page shows a real-time health status bar at the bottom with the
current provider, model, and validation state.

## Config and workspace integration

`core/config.js`'s `aiProvider`/`aiModel`/`aiEndpoint` set the default
provider/model/endpoint for every `ai` command; `--provider`/`--model`/
`--endpoint` override them per-invocation. API key resolution order:
workspace secret → OS keychain → environment variable → fail with
explanation. Ollama/LM Studio need no key (local servers).

For CI/CD and advanced users, environment variables (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`,
`OPENROUTER_API_KEY`) continue to work exactly as before.

## AI Assistant Excellence (v2.1.3)

The same "make what exists exceptional" treatment `docs/ProjectGenerator.md`
and the Registry (`docs/PlatformArchitecture.md` section 25) already
received, applied to the AI Assistant - not a pile of new commands, but
real bugs fixed, a genuine health-scoring surface, and a broader,
honestly-scoped context engine.

- **A real bug, found auditing every provider client**: `AIProvider`
  objects never actually set a `supportsStreaming` field, even though
  `ai benchmark` and the TUI's AI Diagnostics page both read it - so
  `ai benchmark` always printed "stream: No" and Diagnostics always
  hardcoded a "PASS · Supported" line regardless of the real provider.
  Every provider factory (`providers/openaiCompatible.js`, `anthropic.js`,
  `gemini.js`, `ollama.js`) now sets `supportsStreaming: true` (all four
  genuinely implement `stream()`), and the Diagnostics page reads the
  real flag instead of a hardcoded pass.
- **AI Health Score** (`core/ai/health.js`'s `scoreAIHealth()`) - the
  Manifest/Generator Quality Score's sibling for the AI Assistant: a
  single percentage plus a transparent Provider/Credential/Model/
  Configuration/Memory/Context/Diagnostics/Streaming checklist, each a
  real, distinct signal already computed elsewhere in this codebase
  (`validateAIConfig`, the credential manager, the context engine, the
  local memory store) - never invented. `Connection` is included only
  when a live `provider.checkHealth()` result is passed in (`ai health
  --live`, or the TUI's AI Overview page reusing its own mount-time
  connection test) - omitted rather than faked when no live check ran.
  Surfaced via `devforgekit ai health` and the AI Overview page's "AI
  Status" panel title.
- **A broader Context Engine** (`core/ai/context/gather.js`) - every
  `gatherContext()` call now includes a real platform/architecture
  summary (`core/platform`'s OS Abstraction Layer, not a raw
  `process.platform` string), the real list of available Project
  Generator stack ids, and the last few AI memory events (never chat
  contents) - all cheap, no-I/O-or-tiny-file-read facts, so they're part
  of the default (non-`full`) gather every `ai chat`/`ai explain` call
  already pays for. Registry-wide stats (`getRegistryStats` - counts
  across ~261 packages/collections/profiles/recipes) join
  `installedComponents`/`compatibility` under `full: true` instead,
  since reading the whole registry isn't cheap enough for every turn.
- **AI Package/Project Intelligence** (`core/ai/compare.js`,
  `devforgekit ai compare <a> <b>`) - compares two real registry
  components or Project Generator stacks (auto-detected), grounded only
  in their actual manifest/generator fields and real quality scores
  (`scoreManifest`/`scoreGenerator`) - the model is explicitly told to
  treat a missing fact as unknown, never to invent one.
- **`ai history` gained `--clear`/`--export <file>`**, matching the
  parity `ai stats --clear` already had - the same local memory command
  should offer the same shape of controls as its sibling.
- **TUI**: the AI Assistant chat page's input line moved from a
  detached, page-level row below both panels into the bottom of the Chat
  panel itself, with a `❯` prompt marker - a real, reported UX issue
  where it wasn't visually obvious where typing went. Adding the Health
  Score to the AI Overview page reused an existing lesson from the
  Registry Excellence pass (`docs/TUI.md`'s v2.1.1 note): a new fact
  folds into an existing panel *title* rather than adding a new content
  row, since this TUI's Ink/Yoga layout silently drops/merges rows once
  a page's content exceeds its height budget rather than truncating
  cleanly.

## AI Chat Rendering & Response Experience (v2.1.3.1)

A direct follow-up, reported immediately after v2.1.3 shipped: the AI
Assistant's *answers* were reasonable, but the TUI's Chat page was
printing a response's raw string almost verbatim - `## Section` headers,
`**bold**` asterisks, `<br>` tags, and `| A | B |` table syntax all showed
up as literal characters instead of anything resembling terminal output.
The intelligence didn't need to change; the presentation did.

**A real rendering pipeline stands between the model and the screen now**
(see `docs/TUI.md`'s own v2.1.3.1 section for the full technical
breakdown): `tui/lib/markdown.js` parses a response into typed blocks
(headings, paragraphs, bullet/numbered lists, fenced code blocks, tables,
dividers - each with bold/italic/inline-code/link spans resolved),
`tui/components/markdown.js`'s `MarkdownText` turns those into real Ink
elements (a bottom-bordered heading, a rounded code box, the existing
shared `Table` component for markdown tables, a consistent `•` bullet),
and `AIPage.js`'s message list routes every assistant reply through it -
never a raw string again. `<br>` becomes a real newline; every other HTML
tag is stripped outright.

**A TUI-specific system prompt** (`prompts/library.js`'s
`TUI_SYSTEM_ADDENDUM`, layered in only via `buildPrompt(kind, context,
input, { surface: "tui" })`) asks the model itself to write for a
terminal panel: concise by default, plain-text section headings, commands
in their own fenced block, no Markdown tables, no HTML, and no repeating
facts already visible on screen (the current provider/model/directory/
health status are always shown in the UI). It also asks the model to
drop chatbot filler ("Great question!", "As an AI...") in favor of
direct, technical, actionable answers. The renderer above is a real
safety net regardless of how well the model follows this - the two work
together, not one instead of the other. Only `AIPage.js`'s chat session
opts into `surface: "tui"`; the plain-text CLI `ai chat` REPL is
unaffected.

**The chat input line moved** from a detached row below both the Chat
and Context panels into the bottom of the Chat panel itself, with a `❯`
prompt marker - fixing a real, reported "where do I type" confusion that
had nothing to do with markdown rendering but was reported alongside it.

Every construct is covered by dependency-free unit tests
(`cli/test/markdown-parser.test.js`) plus Ink-level render tests
(`cli/test/markdown-render.test.js`) that assert the exact failure this
milestone fixes: no raw `##`/`**`/`<br>`/table-pipe syntax ever reaches
`lastFrame()`.
