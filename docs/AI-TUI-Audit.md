# AI TUI Experience Audit

## Scope

Audit of the current AI-related TUI pages and infrastructure in
`cli/src/tui/`, covering the AI Assistant page, AI Providers page,
Configuration page's AI section, and all supporting modules.

---

## Current State

### Pages

1. **AI Assistant** (`pages/AIPage.js`, 93 lines, shortcut `e`)
   - Simple request/response chat with a text input at the bottom
   - No streaming (by design — CLI `ai chat --stream` covers that)
   - Empty state: "No AI provider configured" + text pointing to CLI
   - Shows provider name in panel title: `AI Assistant (openai)`
   - No model display, no context panel, no quick actions

2. **AI Providers** (`pages/AIProvidersPage.js`, 122 lines, shortcut `P`)
   - Left panel: flat list of 7 providers with ✓/✗ and (local)/(cloud)
   - Right panel: details for selected provider (type, key, model, actions)
   - Actions: `t` test, `p` switch provider (only 2 of 6 wired)
   - `a` (Add Key), `r` (Remove Key), `m` (Change Model), `l` (List Models)
     are **listed but not implemented** — dead shortcuts
   - No card layout — just plain text rows
   - Active provider marked with "← current provider" text, no visual highlight
   - No latency display, no model count, no endpoint info

3. **Configuration** (`pages/ConfigPage.js`, 112 lines, shortcut `o`)
   - `aiProvider` field cycles through all 8 values (none + 7 providers)
   - Note says "or use 'ai setup' / AI Providers page (P)"
   - No API key field, no model field, no endpoint field
   - No AI-specific section — just one row in the general config list

### Infrastructure

- **Navigation**: AI pages are two separate entries in the global PAGES
  array (shortcut `e` for Assistant, `P` for Providers). No AI-specific
  sub-navigation. User must use global Tab+nav to switch between them.
- **Status bar**: Shows `state.page` and `theme.name` — no AI status
  (provider, model, latency)
- **KeyHints**: AI Providers page uses plain `Text` for action list
  instead of the `KeyHints` component used by Doctor/Compatibility pages
- **Empty states**: AIPage has a basic empty state. AIProvidersPage has
  no empty state (always shows all providers, which is correct).
- **Data layer** (`data.js`): No AI-specific cached wrappers. AIProvidersPage
  calls `listAllProviders()` directly from the credential manager.

---

## Findings

### Duplicated Functionality

1. **Provider selection** exists in three places:
   - ConfigPage's `aiProvider` enum field
   - AIProvidersPage's `p` shortcut
   - CLI `ai provider use` command
   - All three write to the same `config.yaml` field, but the user sees
    three different UIs for the same action.

2. **Provider list** is rendered in two places:
   - AIProvidersPage left panel
   - CLI `ai provider list` / `ai providers` command
   - Same data, different presentation.

### Hidden Functionality

1. **Add Key** (`a` shortcut on AIProvidersPage) — listed in the actions
   panel but **not wired**. Pressing `a` does nothing.
2. **Remove Key** (`r` shortcut) — listed but **not wired**.
3. **Change Model** (`m` shortcut) — listed but **not wired**.
4. **List Models** (`l` shortcut) — listed but **not wired**.
5. **Rotate Key** — available in CLI (`ai key rotate`) but not in TUI.
6. **Export/Import Keys** — available in CLI but not in TUI.
7. **Migrate Keys** — available in CLI but not in TUI.
8. **AI History** — available in CLI (`ai history`) but not in TUI.
9. **AI Doctor** — available in CLI (`ai doctor`) but not in TUI.
10. **AI Diagnostics** — `diagnostics/errors.js` exists but no TUI page.
11. **Model caching** — `models/cache.js` exists but no TUI model browser.

### Missing Actions

1. **No way to add an API key from the TUI** — the `a` shortcut is dead.
2. **No way to remove an API key from the TUI** — the `r` shortcut is dead.
3. **No way to rotate a key from the TUI**.
4. **No way to export/import keys from the TUI**.
5. **No way to browse and select models from the TUI** — user must use
   CLI `ai model use <model>` or ConfigPage's free-text `aiModel` field.
6. **No way to run AI diagnostics from the TUI**.
7. **No way to view AI history from the TUI**.
8. **No first-time setup wizard** — user must use CLI `ai setup`.
9. **No quick actions in the Assistant** (doctor, generate, planner, etc.)

### Inconsistent Layouts

1. **AIProvidersPage** uses plain `Text` for action list instead of the
   `KeyHints` component that Doctor/Compatibility/Config pages use.
2. **AIProvidersPage** has a two-panel layout (list + detail) but the
   detail panel doesn't use `KeyValue` like Doctor/Compatibility do.
3. **AIPage** has no detail panel at all — just a single chat panel +
   input. Other pages (Doctor, Compatibility) have list+detail layouts.
4. **AIPage** empty state uses `Panel` with plain text; AIProvidersPage
   has no empty state handling.

### Missing Status Indicators

1. **No active provider highlight** — AIProvidersPage marks the current
   provider with "← current provider" text. No color, no border, no badge.
2. **No active model display** — neither AI page shows the current model.
3. **No latency display** — test results show latency temporarily, but
   it's not persisted or shown in the provider card.
4. **No model count** — number of available models per provider not shown.
5. **No "last tested" timestamp**.
6. **No streaming support indicator**.
7. **No auth source display** (keychain vs env vs workspace).
8. **No status bar AI indicator** — the bottom status bar shows page name
   and theme, not AI provider/model.

### Inconsistent Instruction Text

1. **AIPage** empty state: "Run 'devforgekit ai setup'..." — references CLI.
2. **AIProvidersPage** bottom hint: "Press 't' to test, 'p' to switch" —
   informal, not using KeyHints component.
3. **AIProvidersPage** detail panel: "Actions:" followed by plain text
   list — not KeyHints format.
4. **ConfigPage** AI note: "or use 'ai setup' / AI Providers page (P)" —
   references both CLI and TUI in an inconsistent way.

### Missing Provider Information

1. **No endpoint URL** shown for any provider.
2. **No default model** shown (only `config.aiModel || "default"`).
3. **No provider description** or "what is this provider?" text.
4. **No key URL** (where to get an API key) — `providerUrl()` exists in
   the credential manager but is not displayed.
5. **No streaming/vision/function-calling support indicators**.
6. **No context length info**.
7. **No "last verified" timestamp** for connection tests.

### Missing Model Information

1. **No model browser page** at all.
2. **No model list** in the TUI — user can't see what models are available.
3. **No model metadata** (context length, vision, pricing, etc.).
4. **No "current model" highlight** anywhere in the TUI.
5. **No model search or filter**.

### Unnecessary CLI Dependency

1. **Adding a key** requires `devforgekit ai key add` — the TUI's `a`
   shortcut is dead.
2. **Removing a key** requires `devforgekit ai key remove` — the TUI's
   `r` shortcut is dead.
3. **Rotating a key** requires `devforgekit ai key rotate` — not in TUI.
4. **Exporting/importing keys** requires CLI — not in TUI.
5. **Migrating keys** requires `devforgekit ai key migrate` — not in TUI.
6. **Running setup** requires `devforgekit ai setup` — no TUI wizard.
7. **Running diagnostics** requires `devforgekit ai key test` — TUI has
   test but no dedicated diagnostics page.
8. **Viewing history** requires `devforgekit ai history` — not in TUI.
9. **Browsing models** requires `devforgekit ai model list` — not in TUI.
10. **AIPage empty state** explicitly tells the user to run a CLI command.

---

## Summary

The current AI TUI has **two pages with minimal functionality**. The
AI Providers page has 6 listed shortcuts but only 2 are wired. There is
no model browser, no credential manager page, no diagnostics page, no
history page, and no setup wizard. The user must drop to the CLI for
almost every AI management action. The active provider and model are
not consistently visible. Instruction panels don't match the rest of
the dashboard's design language.

The CLI implementation is comprehensive (`ai setup`, `ai key *`, `ai
provider *`, `ai model *`, `ai doctor`, `ai history`) — the TUI just
doesn't surface any of it.
