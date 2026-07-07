# TUI Keyboard Shortcuts

Complete reference for the interactive terminal dashboard (`devforgekit`
with no arguments, or `devforgekit dashboard`).

## Global keys

| Key | Action | Notes |
| --- | --- | --- |
| `q` | Quit | Disabled when typing in a text field |
| `?` | Help page | Shows all shortcuts |
| `R` | Refresh all data | Re-runs cached service calls |
| `/` | Global search | Searches across all registry entities |
| `:` | Command palette | Fuzzy page-jump and global actions |
| `Ctrl+P` | Command palette | Same as `:` |
| `Esc` | Back / close / cancel | Closes search, palette, modals |
| `Tab` | Toggle nav ↔ content focus | Single-letter page shortcuts only fire in nav focus |

## Navigation (nav focus)

Single-letter shortcuts switch to a page. These only fire when the nav
sidebar has focus (press `Tab` from content to get nav focus).

| Key | Page | Description |
| --- | --- | --- |
| `1` | Dashboard | Overview: health, updates, disk |
| `w` | Workspaces | Workspace manager |
| `c` | Components | Browse and install registry components |
| `y` | Registry | Registry audit and stats |
| `p` | Profiles | Environment profile browser |
| `r` | Recipes | Recipe browser and installer |
| `g` | Project Generator | Project generator wizard |
| `n` | Plugins | Plugin manager (tabs: Installed, Validation, Quality, Details) |
| `d` | Doctor | Diagnostics and health score |
| `R` | Repair Engine | Repair scanner, plan, and history |
| `B` | Benchmark | Benchmark engine |
| `m` | Compatibility | Compatibility engine |
| `G` | Environment Graph | Development Environment Graph |
| `e` | AI Assistant | AI chat interface |
| `E` | AI Overview | AI system overview |
| `P` | AI Providers | Provider list and status |
| `M` | AI Models | Available models |
| `K` | AI Credentials | Credential management |
| `D` | AI Diagnostics | AI health and provider status |
| `C` | AI Capabilities | AI capability matrix |
| `H` | AI History | AI event log |
| `u` | Updates | Outdated packages |
| `i` | Inventory | Machine inventory reports |
| `k` | Commands | Command reference |
| `o` | Configuration | Config editor + theme picker |
| `l` | Logs | Session logs |
| `?` | Help | Keyboard shortcut reference |
| `a` | About | About DevForgeKit |

## List navigation (content focus)

| Key | Action |
| --- | --- |
| `↑` / `k` | Move selection up |
| `↓` / `j` | Move selection down |
| `PageUp` | Move up by page |
| `PageDown` | Move down by page |
| `g` | Go to top |
| `G` | Go to bottom |
| `Enter` | Activate / select / run |
| `x` | Run highlighted item (e.g., plugin command) |
| `1`-`9` | Tab switch (where applicable, e.g., Plugins page) |

## Search

| Key | Action |
| --- | --- |
| `/` | Open global search |
| Type | Filter results (fuzzy matching) |
| `↑` / `↓` | Navigate search results |
| `Enter` | Jump to result's page |
| `Esc` | Close search |

## Command palette

| Key | Action |
| --- | --- |
| `:` or `Ctrl+P` | Open command palette |
| Type | Fuzzy-filter pages and actions |
| `↑` / `↓` | Navigate results |
| `Enter` | Execute selected action |
| `Esc` | Close palette |

## Plugins page tabs

| Key | Tab | Content |
| --- | --- | --- |
| `1` | Installed | Browse discovered plugins with capabilities/permissions |
| `2` | Validation | Per-plugin validation results with score |
| `3` | Quality | Per-plugin quality scores (9 categories) |
| `4` | Details | Full manifest breakdown |

## Configuration page

| Key | Action |
| --- | --- |
| `t` | Cycle theme |
| `Enter` | Edit selected config value |

## Text input

When a text field has focus (search, config editor, chat input):

| Key | Action |
| --- | --- |
| Type | Enter text |
| `Enter` | Submit |
| `Esc` | Cancel / blur |
| `Backspace` | Delete character |

All single-letter page shortcuts are disabled while typing.

## Suspend/resume

Some actions (running `doctor.sh`, scaffolding projects, running plugin
commands) need the real terminal. The TUI temporarily unmounts, hands
the TTY to the child process, and re-renders on the same page when it
finishes.

| Key | Action |
| --- | --- |
| `Enter` | Return to TUI after suspend/resume |

## Startup animation

| Config | Effect |
| --- | --- |
| `startupAnimation: true` (default) | Show boot animation |
| `startupAnimation: false` | Skip animation |
| `startupAnimationSpeed: fast` | Reduced motion (skip particles) |
| `startupAnimationSpeed: off` | Skip animation entirely |
| `DEVFORGEKIT_NO_ANIMATION=1` | Skip via env var |
| `reducedMotion: true` | Static spinners, no particle effects |

## Debug

| Env var | Effect |
| --- | --- |
| `DEVFORGEKIT_TUI_DEBUG=1` | Log stdin chunks + key routing to stderr |
| `DEVFORGEKIT_NO_TUI=1` | Skip TUI, show classic `--help` |
| `TERM=dumb` | Skip TUI, show classic `--help` |

## Theme shortcuts

| Key | Action |
| --- | --- |
| `t` | Cycle to next theme (on Configuration page) |

20 built-in themes: dark (default), midnight, carbon, slate, nord,
dracula, tokyo-night, one-dark, catppuccin-mocha, gruvbox-dark,
solarized-dark, github-dark, matrix, cyberpunk, sapphire, emerald,
crimson, arctic, github-light, paper.

Custom themes: `~/.config/devforgekit/themes/<name>.yaml`.
