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
| Components | `c` | All 261 registry packages: filter by text (`f`) and status (`←`/`→`), inspect details, install/update/remove with live streamed output |
| Registry | `y` | The registry health scorecard (v2.1.1 Registry Excellence): package/verified/quality counts, coverage percentages (compatibility/documentation/validation/aliases/architecture), the lowest-quality packages worth improving, and actionable recommendations - the dashboard form of `devforgekit registry audit` |
| Profiles | `p` | All 50 profiles: resolved component list, install (`a`), set default (`s`) |
| Recipes | `r` | All recipes with a step-by-step preview (install → configure → verify), run (`a`) with live progress and a verify report |
| Project Generator | `g` | The 17-stack wizard: pick stack → name → per-stack options → confirm; generation suspends the dashboard so the scaffolder owns the terminal. Also lists the static `templates/` |
| Plugins | `n` | Everything `discoverPlugins()` finds (valid and invalid with reasons), manifest details, run a plugin command (`x`, suspends) |
| Doctor | `d` | In-dashboard component diagnostics (`s` scan, `F` scan+repair) with recommended fixes, or hand off to the full `scripts/doctor.sh` (`D`/`X`) |
| Compatibility | `m` | Cross-tool/cross-version compatibility scan (`s`) with a 5-tier score and issue drill-down; repair (`F`) suspends the dashboard to run the repair plan, since a conflict removal needs a real confirmation prompt - see [CompatibilityEngine.md](CompatibilityEngine.md) |
| AI Assistant | `e` | Request/response chat (not token-streamed - see [AIAssistant.md](AIAssistant.md)) grounded in this machine's real context; shows a clear empty state when no AI provider is configured |
| Updates | `u` | Live outdated-package list (Homebrew on macOS, apt/dnf/pacman on Linux, winget/choco/scoop on Windows); update one (`a`) via the manifest's own update command, or run the full `scripts/update.sh` (`A`, suspends) |
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

- **Global**: `Tab` focus, `↑↓`/`jk` move, `PgUp`/`PgDn` page-jump,
  `g`/`G` jump to first/last item, `Enter` open, `Esc` back, `/` search
  (or a page's own filter, where one exists), `:`/`Ctrl+P` Command
  Palette, `R` refresh caches, `?` help, `q` quit
- **Menu focus**: single-letter page shortcuts, shown in the nav as a
  bracketed badge in front of each page's label (`[1] Dashboard`, `[w]
  Workspaces`, `[c] Components`...) instead of a bare trailing
  character
- **Page focus**: page-specific action keys - every page's own
  bottom-of-panel hint line uses the same `KeyHints` treatment as the
  status bar, so a page's local keys (`a` install, `u` update, `r`
  remove, `/` filter...) read consistently with the global ones

`PgUp`/`PgDn`/`g`/`G` work in every `SelectList`/`ScrollList` in the
dashboard (`components/ui.js`) - one scrolling contract everywhere,
not a per-page reinvention. `g`/`G` (not raw `Home`/`End` key codes)
is deliberate: `Home`/`End` aren't reliably reported across terminal
emulators, while `g`/`G` is the same portable vim/k9s/lazygit
convention this dashboard's `j`/`k` already borrows.

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
into the results and `Enter` jumps to the owning page. Profiles,
recipes, collections, plugins, and stacks are ranked with `tui/fuzzy.js`
(name + description, scattered-character fuzzy matching, not a plain
substring check) - components and commands keep the registry's/command
tree's own scored search, since rewriting those cross-cutting core
algorithms is a bigger change than this dashboard's own UI layer.

A handful of pages own their own local `/` filter instead of opening
global search (`components`, `commands`, `ai-models` -
`App.js`'s `PAGES_WITH_LOCAL_FILTER`) - `/` on those pages always means
"filter what I'm looking at", never global search. This is a static
list, not a per-keystroke decision: Ink's `useInput` dispatches every
active handler for one keystroke off the same pre-keystroke render (see
`components/ui.js`'s `useFilterField` for the full explanation), so a
page reacting to `/` can never win a race against `Shell`'s own
already-registered handler for that identical keystroke - the exclusion
has to be decided ahead of time, not reactively.

## Command Palette

`:` or `Ctrl+P` (`components/CommandPalette.js`) - fuzzy-jump to any
page or run a global action (refresh, help, about, quit), the same
"type a few letters, Enter, go anywhere" contract VS Code's Ctrl+P
popularized. Deliberately distinct from `/` search: the palette answers
"where do I go / what do I trigger", search answers "what am I looking
for". Rendered by `Shell` in place of the active page's content, the
same full-content-swap pattern `SearchPage`/`ModalHost` already use
(Ink has no floating overlay - see the Architecture section).

## First-run onboarding

A genuinely fresh install (`~/.config/devforgekit/config.yaml` has no
`onboardingSeen: true` yet) shows a short wizard
(`components/OnboardingWizard.js`) before the dashboard: welcome, pick a
theme (live preview via ↑↓), a keyboard-model tour, a what's-on-each-
page tour, a few suggested profiles, and an optional AI Assistant nudge.
`Enter`/`→` advances, `←` goes back, `Esc` skips the rest immediately -
either way, finishing calls `actions.dismissOnboarding()`, which writes
`onboardingSeen: true` to `config.yaml` synchronously before dispatching,
so it never shows again on any later launch.

Unlike `ModalHost`/`CommandPalette`/`SearchPage` (which swap only the
content pane next to `Nav`), onboarding takes over the *entire* screen -
the same full-screen-replace `Shell` uses for `TooSmallScreen` - since a
first-run wizard sharing screen space with a still-clickable Nav
sidebar behind it would undercut the "this is the only thing you can
interact with right now" intent. `Shell`'s own global `useInput` handler
returns immediately whenever `state.onboarding` is true, so no global
shortcut (search, palette, nav letters, refresh) can act silently
underneath the wizard.

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
theme list` and on import. `checkContrast()` checks 8 tokens against
`background` plus 3 pairs that are actually rendered as real Ink
`backgroundColor`+`color` combinations rather than just checked against
the page background: `selectionText`-on-`selection` (every selected row
in every `SelectList` across the dashboard), and `searchHighlight`/
`tableHeader`-on-`background` (v2.0.5 - these 3 pairs weren't checked at
all before, and a v2.0.5 audit found 4 of the 20 built-in themes
genuinely failing one of them: `arctic` and `paper`'s `searchHighlight`,
`solarized-dark` and `arctic`'s `tableHeader`, and `github-dark`'s
`selectionText`-on-`selection` - all fixed, and
`test/theme.test.js`'s "every built-in theme passes WCAG AA contrast"
test guards against a future theme edit regressing any of them again.
The `dark` default theme (v1.4.0 redesign) uses a real hex palette,
checked to have zero AA contrast warnings across every pair
`checkContrast()` tests - the redesign's main fix was exactly this: the
old palette's `selection: "cyan"` / `selectionText: "black"` pairing was
replaced because a selected row must always read as crisp
white-on-solid-blue, never a washed-out combination.

**Reduced motion** (v2.0.5, `hooks/useReducedMotion.js`): a dedicated
context - the same single-purpose pattern `useTerminalSize.js` already
established, rather than threading this through the full `store.js`
reducer - read once at launch from `config.yaml`'s `reducedMotion`
field (toggle it on the Configuration page; like
`startupAnimationSpeed`, it takes effect on the *next* launch, not
live). When true, `Spinner` shows one fixed glyph instead of cycling
frames every 200ms - still communicates "busy" via presence and accent
color, without the animation itself.

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
- **Background probes yield.** "Is X installed" for 261 components
  means 261 shell probes (~10-15s). They run in small parallel batches
  with explicit timer yields between batches - an unbroken await-chain
  of spawns starves stdin processing enough that keypresses coalesce
  into unmatchable chunks (found via PTY smoke testing). As extra
  defense, the global shortcut router matches on the last character of
  a coalesced chunk.
- **Caching with explicit refresh.** Registry YAML and probe results
  are cached per session (`R` drops all caches); Ink re-renders many
  times a second and re-parsing 261 manifests per render would lag
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
  `SelectList` are wrapped in `React.memo` with explicit props (instead
  of reading context internally), so they only re-render when their own
  inputs change — not on every store or resize update. `StatusBar` is a
  v2.0.6 fix, not original: it used to call `useStore()` directly, which
  silently made its own `React.memo` wrapper a no-op - `React.memo` only
  skips a re-render triggered by the *parent* re-rendering with the same
  props; it has no effect at all on a component that subscribes to a
  context directly, since a context update re-renders every consumer
  regardless of memo. It re-rendered on every single dispatch in the
  app (busy/notify/log fire constantly during a live install on a
  completely different page) despite the memo wrapper looking correct
  at a glance. Converting it to explicit props (`theme`, `page`, `busy`,
  `toast`, `dismissToast`) from `App.js`'s `Shell`, with `dismissToast`
  built via the same `useCallback(..., [dispatch])` trick `navigate`
  already used (so the prop reference stays stable across renders where
  nothing StatusBar cares about changed), is what actually made the memo
  effective. Worth checking for the same trap before adding a new
  `React.memo` wrapper anywhere else in this codebase.
- **Stable React keys.** List renders use stable identity-based keys
  (e.g. `entry.time + entry.message`, `line + i`) instead of bare
  array indices, preventing reconciliation bugs when items are added,
  removed, or reordered.

## Performance

- First frame renders in well under 500ms (test-asserted; typically
  ~150ms): only registry YAML parsing happens before paint.
- Install-state probing, outdated-package checks, and disk stats resolve in the
  background; affected numbers show "checking..." / spinners until they
  land.
- Terminal resize events are debounced to a single re-render ~40ms
  after a burst settles, and memoized components skip re-renders when
  their props haven't changed — keeping resize smooth even on rapid
  window drags.

## v2.1.0 UX & Product Consistency Audit

A polish-only pass (no new features) auditing every page against
`components/ui.js`'s own conventions for wording, spacing, color, key
hints, navigation, and destructive-action safety - the goal being that
switching pages never feels like switching apps. Findings came from five
independent page-by-page audits (each checking a batch of pages against
the shared component contract), then fixed in place and re-verified
against the full test suite after each batch. Representative fixes,
grouped by category:

- **A real bug, not just a style nit**: `AIDiagnosticsPage`'s scan used
  `"WARN"` as a status value, but `statusColor()`/`STATUS_ICON` only
  recognize `"WARNING"` - every warning-level check row silently rendered
  in muted gray instead of the warning color, indistinguishable from
  passing rows at a glance.
- **Three independent copies of the same AI-health severity mapping**
  (`DashboardPage`, `AIStatusCard`, `commands/ai.js`'s `ai status`) had
  quietly drifted - one of them didn't classify `"invalid-provider"` as
  an error the other two did. Replaced with one canonical
  `aiHealthTone(status)` export (`core/ai/validation.js`) all three now
  call, so the CLI and the dashboard can never disagree about the same
  fact again (the standing principle this codebase already applies
  elsewhere - see `docs/PlatformArchitecture.md`).
- **Hand-rolled list navigation**: `AICredentialsPage` and
  `AIProvidersPage` each drove their provider list with a bespoke
  `key.upArrow`/`key.downArrow` handler, silently missing the `j`/`k`,
  `PageUp`/`PageDown`, and `g`/`G` every other list in the app gets for
  free from `SelectList`. Both now use `SelectList` like everywhere else.
- **`statusColor()` extended** to also accept the app's other canonical
  severity vocabulary - the lowercase `"success"`/`"warning"`/`"error"`
  toast/log levels `notify()`/`actions.log()` use everywhere - so
  `LogsPage` no longer needs its own copy (it silently miscolored
  `"success"`/`"warning"` entries as muted gray before, since the
  original `statusColor()` only recognized uppercase `"WARNING"`).
  `AICapabilitiesPage`, `AICredentialsPage`, and `PluginsPage`'s
  hand-rolled ✓/✗ tone pairs now call the shared helper too.
- **Wording standardized**: "No provider configured" (was "No provider
  active" on one AI page, "No provider configured" on others); dropped
  inconsistent trailing periods from toast messages across the AI pages,
  Updates, and Commands (the app's dominant toast style never ends in a
  period); `CommandsPage`'s local filter now says "filter" (was
  "search"), matching `FilterBar`'s own vocabulary and every other
  filterable page; `HelpPage`'s documented Logs shortcut (`←→`) now
  matches what `LogsPage` actually renders (`←/→`).
  `AboutPage`'s stale hardcoded `"(v1.2.3)"` dashboard-version mention
  (from the dashboard's very first release) was removed.
- **Loading/empty/error states unified**: `CompatibilityPage`/`DoctorPage`
  had hand-rolled `Spinner`+accent-text loading rows instead of
  `LoadingState` (a different color than the shared component would have
  used); `DoctorPage`'s scan now renders through `InstallProgress` like
  every other scan/install flow; `DashboardPage`'s registry-load failure
  and `AboutPage`'s previously-silent registry-load failure both now
  render through `ErrorState`; `UpdatesPage`'s "Everything is up to
  date." became a real `EmptyState`; `RecipesPage`'s recipe-expansion
  failure (previously swallowed with no visible message at all) now
  surfaces through the same pattern `ProfilesPage` already used.
- **`ProfilesPage`/`RecipesPage` detail panels rebuilt on `DetailPanel`**
  instead of hand-rolled `Panel`+`KeyValue`+manual `Box{marginTop:1}`
  chains, matching `WorkspacePage`/`CompatibilityPage`'s existing pattern
  - same spacing, same empty-state wording, for free.
- **A safety inconsistency**: `ComponentsPage`'s `r` (remove) uninstalled
  immediately with no confirmation at all, while `WorkspacePage`'s
  equally destructive delete required a deliberate second keypress.
  `ComponentsPage` now confirms via `actions.confirmAsync` (previously
  defined in `store.js` but never actually called anywhere) before
  removing anything - `WorkspacePage`'s own press-twice pattern was left
  as-is deliberately (deleting a workspace also destroys its secrets/
  snapshot history, a meaningfully higher-stakes action that reasonably
  warrants its own, different guard rather than converging both onto one
  pattern for its own sake).
- **Silent "busy" states made visible**: `WorkspacePage`'s switch/verify
  actions blocked re-entrancy via a `busy` flag that was never actually
  rendered anywhere; `AIOverviewPage`'s mount-time health check had the
  same gap (plus two dead `statusText()`/`statusColor()` helpers that
  were clearly meant to render it and never got wired up). Both now show
  a `LoadingState` while the action runs, the same affordance
  `AICredentialsPage`/`AIProvidersPage`'s "testing..." already used.

See `cli/test/tui.test.js`/`tui-resize.test.js` for the regression
coverage this pass ran against - the full suite stayed green throughout,
re-verified after every batch of fixes rather than only at the end.

## v2.1.1 Registry Excellence: the Registry page and a real page-height lesson

The new Registry page (`y`) surfaces the registry health scorecard
(package/verified/quality counts, coverage percentages, lowest-quality
packages, recommendations) that `devforgekit registry audit` prints -
see `docs/Registry.md` and `docs/PlatformArchitecture.md` section 3 for
the underlying data. Built deliberately compact: one `Panel`, not four.

**The lesson worth recording**: an earlier revision spread this across
four stacked/side-by-side panels (a health `KeyValue`, a variable-height
wrapped Recommendations block, a 3-column `Table`, and a categories/tags
row) - individually reasonable, but the *combined* height exceeded this
app's own documented worst-case content budget (`PAGE_MIN_SIZE`, see
`hooks/useTerminalSize.js`). Past that budget, Ink's Yoga layout does not
cleanly truncate from the bottom the way a scrollable view would; it
silently drops or merges rows from wherever the layout ran out of room -
observed as specific `KeyValue` rows vanishing (not always the same one)
and a row's trailing text bleeding onto the next row's line, e.g.
`Average Quality        77%2%)` (the `2%)` is the tail of a *different*,
vanished row's `(2%)` value). This is a genuine, reproducible Ink
behavior, not speculation: the exact same corruption pattern was
confirmed on the pre-existing, shipped `DashboardPage` when forced to
render at exactly the documented 24-row floor with no debounced resize
settle - `cli/test/tui-resize.test.js`'s whole suite exists specifically
because this class of bug is invisible in code review and only shows up
by actually rendering at real terminal sizes. The fix was straightforward
once diagnosed: cut the page down to one panel with condensed rows
(coverage percentages folded into one text line, recommendations capped
to 2, a 3-row "needs attention" list instead of a `Table`) - comfortably
inside every page's minimum budget, verified render-clean from 80x24 up.
**Takeaway for any new page**: total content height (every panel's
border + title + rows, summed) must fit `PAGE_MIN_SIZE`'s worst case,
not just "looks fine at my own terminal size" - render it at the actual
floor (`renderApp` + `instance.stdout.rows = <floor>`) before trusting it.

## v2.1.3.1 AI Chat Rendering: a real Markdown renderer, not raw LLM output

Before this, the AI Assistant's Chat page (`e`) printed an assistant
message's raw string straight into a `<Text>` - so a response containing
`## Section`, `**bold**`, a fenced ` ```bash ` block, a Markdown table, or
an HTML `<br>` showed those literal characters on screen instead of
anything resembling formatted output. This was a real, reported gap: the
model's *answers* were fine, but the *presentation* looked unfinished.

**The fix is a real rendering pipeline, not a few regex replacements**:

- `tui/lib/markdown.js`'s `parseMarkdown(text)` is a pure, dependency-free
  parser (no Ink/React) - text in, a plain array of typed blocks out
  (`heading`/`paragraph`/`bullet-list`/`numbered-list`/`code-block`/
  `table`/`divider`, each paragraph/list-item further broken into
  bold/italic/inline-code/link `segments`). Hand-rolled rather than a new
  dependency, the same precedent `providers/openaiCompatible.js`'s own
  SSE parser already set for "hand-roll the one format actually needed
  instead of pulling in a library." `<br>` becomes a real line break;
  every other HTML tag is stripped outright rather than printed literally.
- `tui/components/markdown.js`'s `MarkdownText({ text, theme })` turns
  those blocks into real Ink elements - a heading gets a bottom border
  (levels 1-2) via the same "text-plus-border-only-Box" trick as the
  Divider block below it, a code block gets a rounded border, a table
  reuses the *existing* shared `Table` component (`components/ui.js`),
  bullets get a consistent `•` marker, and every paragraph/list item
  routes through one shared `InlineSegments` renderer for bold/italic/
  inline-code/link spans - the same "nested Text is one reflowable run"
  trick `KeyValue` already relies on, so long styled runs wrap as a unit
  instead of each span getting its own flex-shrink share of the width.
  This is the one component any future page should reach for whenever it
  needs to show AI-authored text - never print a raw model string again.
- `AIPage.js`'s message list now routes every **assistant** message
  through `MarkdownText`; **user** messages (typed by the person, not the
  model) stay as plain text - there's nothing to render there.
- A TUI-specific system prompt addendum (`core/ai/prompts/library.js`'s
  `TUI_SYSTEM_ADDENDUM`, layered in only when a caller passes
  `{ surface: "tui" }` to `buildPrompt`) asks the model itself for
  terminal-shaped output in the first place - concise, plain-text
  headings, no Markdown tables, no HTML, commands in their own fenced
  block, no repeating what's already on screen (provider/model/directory/
  health), no chatbot filler ("Great question!"). The renderer is a real
  safety net for whatever formatting still shows up regardless; the
  prompt reduces how much there is to catch. `AIPage.js`'s
  `createChatSession({ ..., surface: "tui" })` is the only caller that
  opts in - the plain CLI `ai chat` REPL is unaffected.

The chat input line moved at the same time: it used to be a detached row
below *both* the Chat and Context panels, with no visual link to the
conversation feeding it - a real, reported "where do I type" confusion.
It now lives inside the Chat panel itself, under the transcript, with a
`❯` prompt marker.

## v2.1.3.2 Quick Actions: a visibility bug, and another real row-budget lesson

Reported immediately after v2.1.3.1: the Chat page's `1 Doctor · 2
Generate · 3 Planner · 4 Explain · 5 Review · 6 Optimize · 7 Fix` hint
row only ever rendered inside the *empty-state* welcome message (`messages.length
=== 0`) - so it visually vanished the moment a first message was sent,
even though the underlying `1`-`7` keyboard shortcuts (gated on the input
field being empty, not on message count) kept working the whole time.
The fix moved the list into the Context panel, which is always visible
regardless of conversation length.

That change immediately reproduced the exact Ink row-budget corruption
`docs/TUI.md`'s v2.1.1 note and `AIOverviewPage`'s Health Score both
already hit: adding ~8 rows (`Quick Actions` label + 7 action rows) to
the narrow Context panel (`useDetailWidth`, ~26-42 columns depending on
terminal width) pushed the page's real content past its declared
`PAGE_MIN_SIZE` floor of 24 rows, and Ink silently corrupted the KeyValue
rows above it (`Provider`/`Workspace` vanished, quick-action lines bled
into each other - `1 Doctortions`, `3 Plannere`) rather than truncating
cleanly. Bisecting by actually rendering (`renderApp` + `instance.stdout.rows
= N` + emitting `resize`) found the real threshold: corrupt at 30 rows,
clean from 32 up. `hooks/useTerminalSize.js`'s `ai` entry is now `{
columns: 80, rows: 34 }` (30 + a safety margin) - below that floor the
page now shows the ordinary "resize your terminal" placeholder instead of
ever rendering corrupted content. **Takeaway, restated a third time
because it keeps being the actual root cause**: a page's true row
requirement has to be measured by rendering it at a candidate floor and
checking for corruption, never estimated from "how many lines does this
content look like on paper."

## v2.1.4 Environment Graph: a new page, and a real test-isolation lesson

The Environment Graph (`G`) is a genuinely new dashboard page - before
this, the graph (see `docs/EnvironmentGraph.md`) was CLI-only. It follows
the established list+detail shape (`CompatibilityPage`/`ComponentsPage`):
a searchable node list on the left, a detail panel on the right showing
the highlighted node's type/category/installed/quality/platforms plus
its real dependents (`analyzeImpact()`). `F` forces a rebuild bypassing
the 30-minute cache; `x` asks AI to explain the highlighted node.

**The lesson worth recording**: this page's underlying build is a real
~15-20s scan (the same one `graph stats` pays on the CLI side), auto-
triggered on mount the same way `CompatibilityPage`'s own scan already
is. Writing an automated test for it surfaced a real test-isolation
issue, not a product bug: a test that navigates to this page and
unmounts quickly (checking only the pre-build UI) leaves that real,
~15-20s background build still running in the same Node process - and
`node --test` runs every test in a file in one process, so a still-
running background scan from an *earlier* test can measurably increase
CPU/event-loop contention during a *later*, unrelated, timing-sensitive
test (this suite already had one such test, self-documented as "flaky
under full-suite load" from an unrelated background compatibility scan -
this page's heavier footprint made it flake more often). Two real fixes,
not one:

1. **An unmount guard** (`useRef` `mountedRef`, not a plain object -
   a plain `const` inside the component body is recreated every render
   and would silently stop guarding calls made from a later render's
   closure, e.g. the `F` key's own `load({refresh:true})`). Every state
   update and `actions.log()`/`actions.notify()` dispatch after the async
   build resolves is skipped if the page already unmounted.
2. **One test, not two, exercises the real build.** An earlier draft had
   a separate "fast" test that checked the pre-build UI and unmounted
   after 60ms, plus a comprehensive "slow" test that waited for the real
   result - each spawning its own independent ~15-20s background scan.
   Consolidating into one test (which checks the initial state, *then*
   waits for the real result) roughly halves the aggregate background-
   scan pressure within the file. Combined with placing this one
   remaining slow test at the very end of the file (not adjacent to the
   pre-existing flaky test) and raising the shared `withTempHome()`
   cleanup helper's `rmSync` retry budget (5×200ms → 10×300ms, since a
   real scan's own file writes can still be landing the instant a test's
   temp-HOME cleanup starts), five consecutive full-file runs came back
   clean. **Takeaway**: a page whose real data path is genuinely slow
   needs its test to *own* that slowness deliberately (one test, waited
   out fully, placed away from timing-sensitive neighbors) rather than
   letting it leak into the background as an unawaited side effect.

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
