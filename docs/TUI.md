# Interactive Terminal Dashboard (TUI)

Run `devforgekit` with no arguments and the platform opens as a
full-screen terminal dashboard - a k9s/lazygit-style interface over the
exact same engine every classic command uses. `devforgekit dashboard`
(alias `ui`) opens the same thing explicitly, and `--page <id>` starts
on a specific page.

```bash
devforgekit                    # dashboard (on a capable TTY)
devforgekit dashboard --page doctor
devforgekit doctor             # classic commands unchanged
DEVFORGEKIT_NO_TUI=1 devforgekit   # force classic --help instead
```

Nothing about the classic CLI changed: every command works exactly as
before, and the dashboard is a *frontend* to the same services - it
contains no business logic of its own (see "Architecture" below).

## Graceful fallback

The dashboard only launches when the terminal can host it. Any of these
gets the classic `--help` output instead, and every feature remains
available as a classic command:

- stdin or stdout is not a TTY (pipes, CI, `devforgekit | less`)
- `TERM=dumb`
- `DEVFORGEKIT_NO_TUI=1`

Color themes use named ANSI colors, so 16-color terminals degrade
gracefully; the layout is responsive down to 80x24. Below that, a
minimum-size guard replaces the dashboard with a clear message.

## Startup animation

Launching the dashboard (`devforgekit` with no arguments, or
`dashboard`/`ui`) plays a brief boot sequence before the first real
frame - never on suspend/resume, and never for classic commands
(`devforgekit doctor`, `component install`, ...), which are completely
unaffected. Total time is capped well under a second:

1. Blank screen (100ms)
2. A subtle scatter of particles
3. The full "DevForgeKit" logo (spelled out completely in big block
   letters, not an abbreviation) draws itself, one row at a time,
   left-aligned a fixed 2 columns from the edge - never centered,
   never re-computed per terminal width
4. The wordmark and a rotating tagline fade in
5. A real boot checklist - `Loading registry`, `Loading plugins`,
   `Loading profiles`, `Loading recipes`, `Loading compatibility
   engine`, `Initializing workspace manager`, `Preparing dashboard` -
   each checked off the instant its actual initialization call
   resolves, never on a fake timer. If everything has already loaded
   by the time the checklist paints, every line renders checked
   immediately.
6. A short pause
7. Hand off into the dashboard - the logo, wordmark, and tagline on
   screen at this point are not a splash to be discarded: they become
   the dashboard's permanent header (see "Persistent dashboard header"
   below), so this step deliberately does not clear the screen first.
   Ink's own first render still repaints the whole screen the instant
   it mounts (real Ink behavior for any full-screen app, not something
   this module controls), but nothing *this* module does adds a second,
   purely decorative blank-then-redraw on top of that.

Because the checklist's tasks are the exact same cached calls the
dashboard's own pages make (`core/registry.js`, `core/plugins.js`,
`core/compatibility/rules.js`, `core/workspace/store.js`), the
animation doubles as a cache warm-up: by the time the dashboard mounts,
that data is already loaded, so the splash adds no net startup time.

### Configuration

```yaml
# ~/.config/devforgekit/config.yaml
startupAnimation: true       # true | false
startupAnimationSpeed: normal # normal | fast | off
```

Both are editable live from the dashboard's Configuration page (`o`).
`fast` (reduced motion) skips the particle step and draws the logo
instantly; the boot checklist still only checks off real work, it's
just not surrounded by any brand-moment pacing. `off` (either
`startupAnimation: false` or `startupAnimationSpeed: off`) skips the
animation entirely - the dashboard's own pages still load their data
lazily, exactly as they did before this feature existed.

`DEVFORGEKIT_NO_ANIMATION=1` disables it for a single run, same
precedence as any other env var. It's also automatically skipped
whenever the dashboard itself would be (non-TTY, CI, `TERM=dumb`).

### Architecture

```text
cli/src/tui/startup/
├── startupAnimation.js   # orchestrates the 7 steps; the only export tui/index.js calls
├── asciiLogo.js          # the fixed ASCII logo art + taglines
├── particleRenderer.js   # step 2's particle scatter
├── loadingRenderer.js    # step 5's real-task boot checklist
└── transition.js         # raw ANSI writes + theme-token color painting
```

This module knows nothing about Ink, React, or the dashboard - it
writes raw frames directly to the terminal (the same alt-screen buffer
`tui/index.js` already manages) and returns before `App`'s `render()`
is ever called. The dashboard, in turn, knows nothing about the
startup sequence. That isolation is what lets future additions
(holiday themes, plugin-provided startup themes, a random message pool)
land entirely inside `tui/startup/` with no changes to `App.js`.

Every raw-terminal call (`write`/`clear`/`hide`/`show`) is injectable
via an `io` parameter, the same `fetchImpl`-style dependency-injection
convention `core/ai`'s provider clients use - `cli/test/startup-animation.test.js`
captures frames through these overrides instead of mutating the global
`process.stdout`, which would race with Node's test runner executing
other tests in the same file concurrently.

## Persistent dashboard header

The DevForgeKit logo is not a splash screen - it's the dashboard's
permanent header (v1.4.1). Once the startup animation above hands off,
the exact same logo/wordmark/tagline (`tui/startup/asciiLogo.js` - the
same module, not a lookalike copy) renders as a normal Ink component,
`components/DashboardHeader.js`, at the top of every page:

```text
  ______          ______                   _   ___ _   
  |  _  \         |  ___|                 | | / (_) |  
  | | | |_____   _| |_ ___  _ __ __ _  ___| |/ / _| |_ 
  | | | / _ \ \ / /  _/ _ \| '__/ _` |/ _ \    \| | __|
  | |/ /  __/\ V /| || (_) | | | (_| |  __/ |\  \ | |_ 
  |___/ \___| \_/ \_| \___/|_|  \__, |\___\_| \_/_|\__|
                                 __/ |                 
                                |___/                  

  DevForgeKit
  Developer Environment Platform
  Version 1.4.1 • 251 Components • 50 Profiles • 8 Recipes
──────────────────────────────────────────────────────────────────
 Dashboard  Workspaces  Components  ...  │  page content
──────────────────────────────────────────────────────────────────
 Tab focus · ↑↓/jk move · Enter open · Esc back · / search · ...
```

It never disappears, never vertically centers, and never moves during
a resize - it always occupies the first rows of the terminal, and only
the content area below the separator resizes. It's left-aligned, not
centered: the logo/wordmark/tagline/version-stats-line all start at
the same fixed column (`LOGO_LEFT_MARGIN`, 2) from the very first
frame the startup animation draws, through to the persistent header -
so there's no jump sideways at handoff, matching the "always on the
left" requirement (a deliberate change from an earlier centered
layout).

### Responsive tiers

The header's height only ever grows on generously large terminals -
`layout/responsive.js`'s `headerMode(columns, rows)` picks one of
three tiers, chosen so that at or near any page's own declared minimum
size (`PAGE_MIN_SIZE`, max 28 rows) the header stays at its smallest,
3-row form - the same row budget the pre-redesign info-strip header
used, so no existing page's layout gets squeezed:

| Mode | When | Renders |
|---|---|---|
| `full` | rows >= 53 and columns >= 110 | logo (8 rows) + wordmark + tagline + version/stats line + separator (13 rows) |
| `compact` | rows >= 47 and columns >= 90 | logo (8 rows) + wordmark + separator, subtitle and version hidden first (11 rows) |
| `minimal` | otherwise (including this app's own 100x40 test default) | wordmark + tagline + separator, no ASCII logo (3 rows) |

Branding never fully disappears even in `minimal` mode - the ASCII
logo is the first thing to go, but the wordmark and tagline remain as
plain text. `headerHeight(columns, rows)` returns the exact row count
for `shellLayout()`'s content-height accounting, so the two never
drift out of sync.

### Version/stats line

`full` mode's stats line reads real data, not placeholders -
`registrySnapshot().stats` (the same cached call the Dashboard/
Components pages use) for the component/profile/recipe counts, and
`getVersion()` (the repo-root `VERSION` file) for the version. If the
registry fails to load, the line falls back to just the version rather
than crashing the header. It's rendered as distinct colored segments,
not one flat muted string - `components/DashboardHeader.js`'s
`StatsLine`: labels (`Version`, `Components`, `Profiles`, `Recipes`) in
`theme.textMuted`, the version and every count in bold `theme.accent`
so the numbers that matter actually stand out, and the `•` separators
in `theme.border` (deliberately the dimmest token in the line).

### Theme

The logo always renders in `theme.accent` - the same token in the
startup animation and the persistent header, so the color never shifts
at handoff (an earlier revision used a separate `panelTitle` token for
the header's logo, which was a visible, unintended color change the
instant the dashboard mounted; fixed by standardizing on `accent`
everywhere the logo appears). The wordmark uses `theme.text`, the
tagline uses `theme.textMuted` - the same semantic tokens every other
component uses, never a hardcoded color. `SESSION_TAGLINE` (picked once
per process, at module load) is what makes the tagline in the startup
animation and the persistent header always match within one session -
it only varies between separate launches of the CLI.

### Architecture

One component, reused by every page - `App.js`'s `Shell` renders
`DashboardHeader` once, above the `Nav`/page-content row, exactly where
the old always-visible info-strip `Header` used to sit (removed; its
health-score/workspace/profile/registry-count information is still
visible on the Dashboard page's own panels, which already duplicated
most of it). No page renders its own copy.

## Pages

| Page | Shortcut | What it shows / does |
|---|---|---|
| Dashboard | `1` | Machine overview: installed count, health score, outdated packages, storage, registry stats, real device info (OS, model, chip, memory, uptime, software update status), recent session actions, update notifications |
| Workspaces | `w` | Browse/create (`n`) isolated per-project environments, switch (`Enter`), verify (`v`), snapshot (`x`), deactivate (`z`), delete (`D`, press twice) - see [WorkspaceManager.md](WorkspaceManager.md) |
| Components | `c` | All 250 registry packages: filter by text (`f`) and status (`←`/`→`), inspect details, install/update/remove with live streamed output |
| Profiles | `p` | All 50 profiles: resolved component list, install (`a`), set default (`s`) |
| Recipes | `r` | All recipes with a step-by-step preview (install → configure → verify), run (`a`) with live progress and a verify report |
| Project Generator | `g` | The 16-stack wizard: pick stack → name → per-stack options → confirm; generation suspends the dashboard so the scaffolder owns the terminal. Also lists the static `templates/` |
| Plugins | `n` | Everything `discoverPlugins()` finds (valid and invalid with reasons), manifest details, run a plugin command (`x`, suspends) |
| Doctor | `d` | In-dashboard component diagnostics (`s` scan, `F` scan+repair) with recommended fixes, or hand off to the full `scripts/doctor.sh` (`D`/`X`) |
| Compatibility | `m` | Cross-tool/cross-version compatibility scan (`s`) with a 5-tier score and issue drill-down; repair (`F`) suspends the dashboard to run the repair plan, since a conflict removal needs a real confirmation prompt - see [CompatibilityEngine.md](CompatibilityEngine.md) |
| AI Assistant | `e` | Request/response chat (not token-streamed - see [AIAssistant.md](AIAssistant.md)) grounded in this machine's real context; shows a clear empty state when no AI provider is configured |
| Updates | `u` | Live `brew outdated` list; update one (`a`) via the manifest's own update command, or run the full `scripts/update.sh` (`A`, suspends) |
| Inventory | `i` | The Markdown reports `scripts/inventory.sh` writes under `reports/`, with preview and regeneration (`a`, suspends) |
| Configuration | `o` | Every config field, editable in place (writes through `core/config.js` to `~/.config/devforgekit/config.yaml`); the `tuiTheme` field applies live |
| Logs | `l` | The session's action log, filterable by level (`←`/`→`), exportable (`e`) to `~/.devforgekit/logs/` |
| Help | `?` | The full keyboard reference |
| About | `a` | Version, platform stats, links |

## Keyboard model

Two focus zones: the left **menu** and the **page**. `Tab` switches
between them; the status bar always shows the global keys - each one
as a bold accent key plus a muted description, separated by a dim
` · ` so the row reads as distinct chunks instead of one dense run-on
line (`components/ui.js`'s `KeyHints`). `Esc back` used to be the one
global key with no visible hint anywhere in the status bar (it was
only documented on the Help page) - it's now shown alongside every
other global key.

- **Global**: `Tab` focus, `↑↓`/`jk` move, `Enter` open, `Esc` back,
  `/` search, `R` refresh caches, `?` help, `q` quit
- **Menu focus**: single-letter page shortcuts, shown in the nav as a
  bracketed badge in front of each page's label (`[1] Dashboard`, `[w]
  Workspaces`, `[c] Components`...) instead of a bare trailing
  character
- **Page focus**: page-specific action keys - every page's own
  bottom-of-panel hint line uses the same `KeyHints` treatment as the
  status bar, so a page's local keys (`a` install, `u` update, `r`
  remove, `f` filter...) read consistently with the global ones

Single-letter page shortcuts only fire while the menu has focus, so
page action keys never collide with navigation. While a text field
owns the keyboard (search, filter, name inputs), all single-letter
shortcuts including `q` are suspended - typing "flutter" never quits
the app.

### KeyHints - the shared "what can I press" convention

Every keyboard hint in the dashboard - the global status bar, and
every page's own action-key line - is built from the same
`components/ui.js` component, `KeyHints({ hints, theme })`: `hints` is
`[[key, description], ...]`, rendered as a bold `theme.accent` key
plus a muted `theme.textMuted` description, separated by a dim
`theme.border` ` · `. One shared component means one place to change
the convention, and guarantees every page's hints look and read the
same way rather than each page inventing its own formatting.

It's built from nested `<Text>` spans, not a `<Box>` of sibling
`<Text>` elements - Ink treats nested Text as one reflowable text run
and wraps/truncates the whole line as a unit when space runs out,
where a `<Box>` of siblings instead gives each span its own
flex-shrink share of the width and truncates mid-word the moment the
row doesn't fit. This is a real Ink behavior every multi-color line in
the dashboard has to account for - see `KeyValue` (the shared label/
value row every detail panel uses), `DashboardHeader`'s stats line,
and the Recipes/Profiles pages' two-line list cards, all of which use
the same nested-Text pattern for the same reason.

## Global search

`/` from anywhere opens one search across components (using the
registry's ranked `searchPackages`), profiles, recipes, collections,
plugins, and generator stacks. Results are grouped by type; `↓` moves
into the results and `Enter` jumps to the owning page.

## Themes

The TUI has a professional theme system with 30 semantic color tokens
consumed by every component — no hardcoded colors anywhere. Twenty
built-in themes are included, and custom themes can be loaded from
`~/.config/devforgekit/themes/*.yaml`.

### Built-in themes

| ID | Name | Style |
|---|---|---|
| `dark` | DevForgeKit Dark | Default - high-contrast, GitHub Dark-inspired premium palette (v1.4.0 redesign) |
| `midnight` | DevForgeKit Midnight | Deep blue high-contrast |
| `carbon` | DevForgeKit Carbon | Near-black, enterprise gray |
| `slate` | DevForgeKit Slate | Minimal monochrome |
| `nord` | DevForgeKit Nord | Blue-gray, Nord-inspired |
| `dracula` | DevForgeKit Dracula | Purple accents, Dracula-inspired |
| `tokyo-night` | DevForgeKit Tokyo Night | Blue/purple, Tokyo Night-inspired |
| `one-dark` | DevForgeKit One Dark | VS Code One Dark-inspired |
| `catppuccin-mocha` | DevForgeKit Catppuccin Mocha | Warm dark, pastel accents |
| `gruvbox-dark` | DevForgeKit Gruvbox Dark | Earth tones |
| `solarized-dark` | DevForgeKit Solarized Dark | Low eye-strain professional |
| `github-dark` | DevForgeKit GitHub Dark | GitHub Dark-inspired |
| `matrix` | DevForgeKit Matrix | Black/green retro terminal |
| `cyberpunk` | DevForgeKit Cyberpunk | Purple/cyan/pink high contrast |
| `sapphire` | DevForgeKit Sapphire | Blue focused professional |
| `emerald` | DevForgeKit Emerald | Green focused minimal |
| `crimson` | DevForgeKit Crimson | Dark with red accents |
| `arctic` | DevForgeKit Arctic | Very light, bright environments |
| `github-light` | DevForgeKit GitHub Light | GitHub Light-inspired |
| `paper` | DevForgeKit Paper | Warm light, comfortable reading |

### Switching themes

On the Configuration page, the `tuiTheme` row cycles through all
available themes on Enter/Space and applies live (no restart needed).

From the CLI:

```bash
devforgekit theme list           # list all themes (marks current)
devforgekit theme use nord       # switch to nord (persists)
devforgekit theme preview dracula  # preview without saving
devforgekit theme random         # switch to a random theme
devforgekit theme export -o my-theme.yaml  # export current theme
devforgekit theme import ./my-theme.yaml    # import a custom theme
devforgekit theme gallery        # visual gallery in the dashboard
```

Or via the classic config command:

```bash
devforgekit config set tuiTheme nord
```

The preference persists through the existing configuration system —
same file, same precedence rules as every other setting.

### Custom themes

Create a YAML file in `~/.config/devforgekit/themes/` with the following
format:

```yaml
name: "My Custom Theme"
author: "Your Name"
version: "1.0.0"
description: "A custom theme"
homepage: "https://example.com"
license: "MIT"
colors:
  background: "#1a1b26"
  surface: "#16161e"
  surfaceAlt: "#24283b"
  text: "#c0caf5"
  textMuted: "#565f89"
  textDisabled: "#3b4261"
  primary: "#7aa2f7"
  secondary: "#bb9af7"
  accent: "#7aa2f7"
  success: "#9ece6a"
  warning: "#e0af68"
  error: "#f7768e"
  info: "#7dcfff"
  border: "#292e42"
  borderActive: "#7aa2f7"
  selection: "#33467c"
  selectionText: "#c0caf5"
  header: "#24283b"
  footer: "#16161e"
  sidebar: "#1f2335"
  progress: "#7aa2f7"
  progressBackground: "#24283b"
  tableHeader: "#7aa2f7"
  tableBorder: "#292e42"
  searchHighlight: "#e0af68"
  chart1: "#7aa2f7"
  chart2: "#9ece6a"
  chart3: "#e0af68"
  chart4: "#f7768e"
  chart5: "#bb9af7"
```

Custom themes are automatically discovered and listed alongside
built-ins. Use `devforgekit theme import <file>` to copy a theme file
into the themes directory. The system validates that all 30 tokens are
present and warns about WCAG contrast issues.

### Semantic tokens

No component hardcodes a raw color - every one reads a semantic token
off `theme`. All 30 required tokens (`THEME_TOKENS`) are listed below;
`panelTitle` is an extended 31st token every theme may optionally
define (falling back to `accent` if it doesn't), used for the one
built-in theme (`dark`) that wants its panel titles in a color
distinct from its border/accent blue:

| Token | Purpose |
|---|---|
| `background` | Reserved - see the Ink limitation note below |
| `surface` | Reserved - see the Ink limitation note below |
| `surfaceAlt` | Reserved - see the Ink limitation note below |
| `text` | Primary text |
| `textMuted` | Secondary/muted text (was `dim`) |
| `textDisabled` | Disabled controls (not yet wired to any control - the TUI has no disabled-state widgets today) |
| `primary` | Primary brand/action color |
| `secondary` | Secondary brand color |
| `accent` | Accent color (headers, highlights, borders) |
| `panelTitle` *(optional)* | Panel title color, if distinct from `accent` |
| `success` | Success states (PASS, installed) |
| `warning` | Warning states |
| `error` | Error states (FAIL, invalid) |
| `info` | Informational states |
| `border` | Default border color |
| `borderActive` | Active/focused border - Panel and the nav sidebar both switch to this the moment they hold keyboard focus |
| `selection` | Selection background (was `selectedBg`) |
| `selectionText` | Selection text (was `selectedText`) - always chosen for AA contrast against `selection` |
| `header` | Reserved - see the Ink limitation note below |
| `footer` | Reserved - see the Ink limitation note below |
| `sidebar` | Reserved - see the Ink limitation note below |
| `progress` | Progress bar fill |
| `progressBackground` | Progress bar track (the unfilled portion - a real second color, not the same glyph in a dimmer shade) |
| `tableHeader` | Table header text |
| `tableBorder` | Table border color |
| `searchHighlight` | Search match highlight - the Global search page colors the matched substring of a result's name this color (never on top of a selected/blue row, to avoid low-contrast color-on-color) |
| `chart1`–`chart5` | Chart/data visualization colors |

**Ink limitation:** `background`/`surface`/`surfaceAlt`/`header`/
`footer`/`sidebar` are defined by every built-in theme but not
currently painted anywhere - Ink's `<Box>` has no `backgroundColor`
support at all (only `<Text>` does; compare `ink/build/components/
Text.js` to `Box.js`), so there is no way to fill a panel/header/
sidebar's background short of manually padding and coloring every
line of text inside it, which no component does. These tokens are
kept in the schema for when/if that becomes practical (or Ink adds
box-fill support), rather than removed and re-added later. Borders
(`border`/`borderActive`) and all text colors work exactly as you'd
expect, since Ink does support `borderColor` and `<Text color=...>`.

### Accessibility

The theme system computes WCAG contrast ratios for text-vs-background
pairs. Themes with contrast below AA (4.5:1) are flagged in `devforgekit
theme list` and on import. The `dark` default theme (v1.4.0 redesign)
uses a real hex palette, checked to have zero AA contrast warnings
across every text/background pair `checkContrast()` tests, including
the selection state (`selectionText` on `selection` is >= 4.5:1) -
the redesign's main fix was exactly this: the old palette's
`selection: "cyan"` / `selectionText: "black"` pairing was replaced
because a selected row must always read as crisp white-on-solid-blue,
never a washed-out combination.

## Architecture

```text
cli/src/tui/
├── index.js              # launchDashboard() + isTuiCapable() + suspend/resume loop
├── App.js                # root layout, global key router, page registry
├── store.js              # one React context + reducer (page, focus, theme, logs, busy)
├── theme.js              # 30 semantic tokens, 20 built-in themes, validation, contrast, custom loading
├── themes/
│   └── builtin.js        # built-in theme definitions (metadata + colors)
├── data.js               # cached read-side wrappers around the real services
├── hooks/
│   └── useTerminalSize.js  # TerminalSizeProvider + useTerminalSize (debounced resize)
├── layout/
│   └── responsive.js        # navWidth(), breakpoint thresholds, headerMode()/headerHeight()
├── components/           # ui.js (SelectList, Panel, KeyHints, TextField...), DashboardHeader, StatusBar, TooSmallScreen
└── pages/                # one file per page
```

Design decisions, and why:

- **Alternate screen buffer.** The dashboard renders in the terminal's
  alt screen (`ESC[?1049h`), not the main buffer — the same mode every
  professional full-screen TUI (lazygit, k9s, btop, lazydocker) uses.
  Ink manages frames with `log-update`, which erases the previous frame
  by writing `eraseLines(previousLineCount)` — a count of *logical*
  (newline-separated) lines. In the main buffer, shrinking the terminal
  reflows old content (a 200-char line wraps to 2–3 physical lines at
  80 cols), but `eraseLines(24)` only erases 24 physical lines while
  the old frame now occupies 50+. The un-erased remainder stays visible
  as stale borders and duplicated dashboards. In the alt screen,
  content is not reflowed on resize and there is no scrollback, so
  physical lines always equal logical lines and `eraseLines` correctly
  clears the entire previous frame. On quit or suspend, `ESC[?1049l`
  restores the main buffer (and a `process.on('exit')` safety net
  covers SIGTERM/SIGHUP).
- **Ink (React for terminals), no JSX.** The whole tree is built with
  `React.createElement` (aliased `h`), because this CLI has no
  build/transpile step anywhere - `node bin/devforgekit.js` runs the
  source directly, and adding a build step just for JSX sugar would
  break that property.
- **Lazy everything.** The TUI module itself is only imported when the
  dashboard actually launches (`commands/dashboard.js` imports it inside
  the action), so classic commands never pay React/Ink's load cost.
  Pages mount only when visited; slow data resolves in the background
  after first paint.
- **No business logic in the TUI.** `data.js` and the pages call the
  exact functions the classic commands call: `core/registry.js`,
  `core/installer.js`, `core/recipes.js`, `core/plugins.js`,
  `core/config.js`, `commands/stats.js` helpers, `generators/`. If a
  behavior differs between `devforgekit component install x` and the
  Components page, that's a bug.
- **Streamed child output** (`onOutput`). A child process writing
  straight to the terminal would interleave with Ink's render loop, so
  `core/shell.js`'s `runShellCommand` (and `installer.js`,
  `recipes.js` on top of it) accept an optional `onOutput(text,
  stream)` callback that pipes stdout/stderr into the calling page's
  log pane. No existing caller changed: omitting it keeps the exact
  silent/inherit behavior the classic CLI has always had.
- **Suspend/resume for terminal-owning work.** Scaffolding CLIs
  (`flutter create`, `create-next-app`...), `scripts/doctor.sh`,
  `scripts/update.sh`, `scripts/inventory.sh`, and plugin commands all
  legitimately own the terminal. The dashboard unmounts, hands them the
  real TTY, waits for Enter, then re-renders on the page you left -
  the same pattern lazygit uses for `$EDITOR`. React state doesn't
  survive the remount; the target page reloads fresh data, which is
  what you want after an external operation anyway.
- **Background probes yield.** "Is X installed" for 250 components
  means 250 shell probes (~10-15s). They run in small parallel batches
  with explicit timer yields between batches - an unbroken await-chain
  of spawns starves stdin processing enough that keypresses coalesce
  into unmatchable chunks (found via PTY smoke testing). As extra
  defense, the global shortcut router matches on the last character of
  a coalesced chunk.
- **Caching with explicit refresh.** Registry YAML and probe results
  are cached per session (`R` drops all caches); Ink re-renders many
  times a second and re-parsing 250 manifests per render would lag
  visibly.
- **Centralized resize state.** A single `TerminalSizeProvider`
  mounts one `resize` listener (via Ink's `useStdout`, so it targets
  the correct stream even under test) and debounces bursts into one
  state update ~40ms after they settle. Every component that needs
  terminal dimensions reads from `useTerminalSize()` instead of
  `process.stdout.columns` directly — one listener, one coalesced
  re-render per resize burst, one place resize state lives.
- **Responsive layout with breakpoints.** `layout/responsive.js`
  exports `navWidth(columns)` and breakpoint thresholds
  (`verySmall < 80`, `small 80–109`, `medium 110–159`, `large 160–219`,
  `ultraWide 220+`). Detail panes use the `useDetailWidth(max, fraction)`
  hook, which reads from the centralized resize context so all panels
  resize in sync during a window drag.
- **Per-page minimum-size guard.** Each page declares its own minimum
  terminal size via `PAGE_MIN_SIZE` in `hooks/useTerminalSize.js`
  (e.g. Dashboard 80×24, Components 100×28, Workspaces 100×28). When the
  terminal falls below the *current page's* minimum, the entire
  dashboard is replaced by a centered, bordered `TooSmallScreen` card
  showing the app name, current dimensions, required dimensions, the
  active page label, a progress bar, and an "Expand the window to
  continue" hint — the same pattern used by lazygit, k9s, and btop.
  Dimensions update live as the user resizes. Growing past the minimum
  restores the exact page the user was on, with no extra state to reset.
  The global floor (80×24) always applies; per-page minimums can only
  be higher, never lower.
- **Memoized components.** `DashboardHeader`, `Nav`, `StatusBar`, and
  `SelectList` are wrapped in `React.memo` with explicit props
  (instead of reading context internally), so they only re-render when
  their own inputs change — not on every store or resize update.
- **Stable React keys.** List renders use stable identity-based keys
  (e.g. `entry.time + entry.message`, `line + i`) instead of bare
  array indices, preventing reconciliation bugs when items are added,
  removed, or reordered.

## Performance

- First frame renders in well under 500ms (test-asserted; typically
  ~150ms): only registry YAML parsing happens before paint.
- Install-state probing, `brew outdated`, and disk stats resolve in the
  background; affected numbers show "checking..." / spinners until they
  land.
- Terminal resize events are debounced to a single re-render ~40ms
  after a burst settles, and memoized components skip re-renders when
  their props haven't changed — keeping resize smooth even on rapid
  window drags.

## Session logs

The Logs page records what you did this session (installs, doctor runs,
config changes...). It is deliberately labeled a *session* log: the
platform has no persistent structured log file today, and the export
key (`e`) writes the session to `~/.devforgekit/logs/` rather than
pretending one existed all along.

## Honest scoping - what the dashboard does *not* do

Consistent with the platform's "no fake buttons" principle
(`docs/PlatformArchitecture.md`), the dashboard never renders a control
whose backend doesn't exist:

- **No mouse support.** Keyboard only, like k9s. Ink can report mouse
  events, but none of the platform's interactions need them and a
  half-working hover model is worse than none.
- **No recipe rollback/history UI.** The recipe engine has no rollback
  capability to call; the Recipes page says what a run *will do*
  (preview) and what a verify pass *found*, nothing more.
- **No plugin marketplace browser.** `plugin install` takes a
  path/URL; a hosted index is design-only (Platform Architecture
  section 19). The Plugins page says exactly that.
- **No plugin enable/disable toggles.** Plugins are plain directories
  with no enabled/disabled state in the platform; the page links to the
  real management story instead of faking switches.
- **No update scheduling.** The `updateSchedule` config field is
  stored but nothing consumes it yet - the Updates and Configuration
  pages both say so inline.
- **No screen-reader mode.** Ink paints a full-screen grid, which is
  fundamentally hostile to screen readers; the honest accessible path
  is the classic line-oriented CLI, which remains fully equivalent.

## Troubleshooting

- `DEVFORGEKIT_NO_TUI=1` - never launch the dashboard.
- `DEVFORGEKIT_TUI_DEBUG=1` - log raw stdin chunks and key routing to
  stderr (useful when a terminal emulator delivers odd sequences).
- The dashboard uses the alternate screen buffer (`ESC[?1049h`/`l`), so
  quitting (or crashing) always restores the terminal's main buffer with
  scrollback intact. If the terminal is somehow left in the alt screen,
  `reset` or running `printf '\\x1b[?1049l'` restores it.
- If a suspended script leaves the terminal in a bad state, `reset`
  fixes it - the dashboard re-enables raw mode only for itself.

## Testing

`cli/test/tui.test.js` drives real Ink renders through
ink-testing-library's fake stdin against the real registry - first
paint and timing, menu/shortcut/arrow navigation, focus toggling,
filtering, global search, live theme cycling, and typing-guard
behavior, plus the Workspaces page's create/switch/verify/snapshot/
delete/deactivate actions against the real `core/workspace/*.js` engine
(an isolated `$HOME` per test, no mocks - same approach as
`workspace-*.test.js`). Suspend/resume and real-PTY exit were verified
manually with a pseudo-terminal driver during development
(ink-testing-library can't observe process exit or TTY handoff).

`cli/test/tui-resize.test.js` tests the responsive layout engine with
a custom `FakeStdout` that can emit resize events and change
dimensions: breakpoint math, `navWidth` behavior, rendering at various
terminal sizes, the too-small fallback and recovery, per-page minimum
sizes (`getPageMinSize`, page-specific too-small and recovery), debounced
resize events, and listener cleanup on unmount.

`cli/test/theme.test.js` tests the professional theme system: 30-token
contract, all built-in themes have every token, backward-compat aliases
(dim→textMuted, selectedBg→selection, etc.), WCAG contrast ratio
computation, validation with missing-token reporting, YAML export,
custom theme discovery from `~/.config/devforgekit/themes/`, and
random theme selection.
