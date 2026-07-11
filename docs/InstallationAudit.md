# Installation Audit

A pre-implementation audit of DevForgeKit's install/update/uninstall/first-run
experience, produced as Phase 1 of the "Installation Experience Excellence"
milestone (pre-v3.0.0 public distribution). Documents what `git clone` →
`./devforgekit install` → first launch → `devforgekit` actually does today,
what already exists that later phases can build on, what's genuinely missing,
and the risks of shipping the current flow to a wider audience via
npm/Homebrew.

## Current Flow

### `git clone` → `cd DevForgeKit`

No hooks fire. Nothing is installed yet.

### `./devforgekit install` (→ `exec bootstrap.sh "$@"`, `devforgekit:114`)

`bootstrap.sh` (250 lines, pure bash, must run before Node exists) runs, in
order:

1. **Preflight** — macOS check (`os_is_macos`, exits non-zero on Linux/Windows,
   `bootstrap.sh:75-78`), internet check, disk-space check. `confirm()` is the
   only interactive gate, and only fires for low-disk/no-internet warnings
   (`common.sh`'s `confirm`, honors `DEV_SETUP_ASSUME_YES=1`).
2. **Profile resolution** — `--profile <name>` / `--minimal` / `--full`
   flags, or a persisted `.devprofile` default, resolve to one Brewfile via
   `resolve_profile`/`profile_brewfile_path` (`common.sh:219-240`). **No flag
   → the root `Brewfile` (the "full" set) is used.** There is no interactive
   picker; a first-time user who runs `./devforgekit install` with no flags
   gets the full package set with zero prompting beyond the disk/internet
   confirms.
3. **Homebrew** — `ensure_homebrew` + one `brew bundle --file="$BREWFILE_PATH"`
   (`bootstrap.sh:118`) installs every `brew`/`cask`/`vscode`/`npm` line in
   that Brewfile. No preview of what's in it, no per-package confirmation,
   no size/time estimate.
4. **Runtimes & dotfiles** — `restore_mise`, `restore_zsh`, `restore_git`,
   `restore_editor` (VS Code *and* Cursor) all run unconditionally.
   `restore_editor` (`common.sh:501-521`) installs every extension listed in
   `vscode/extensions.txt`/`cursor/extensions.txt` via
   `code --install-extension --force`, with no opt-out flag.
5. **Services** — `service_start_all` (`common.sh:549-554`) starts
   postgresql@17/mysql/redis **unconditionally** unless `--skip-services` or
   `--dry-run` was passed (`bootstrap.sh:171-178`). Opt-out, not opt-in.
6. **Global command** — `install_global_command` (`common.sh:400-420`)
   symlinks this repo's `devforgekit` into the Homebrew prefix's `bin/`
   (idempotent, only rewrites if the symlink is wrong/missing).
7. **Report + summary** — `scripts/report.sh` runs, then a colored PASS/WARN
   summary + `print_health_score` + a final tool checklist
   (`_check_tool "DevForgeKit" devforgekit`, `bootstrap.sh:237`) — this last
   check only confirms the `devforgekit` binary resolves on PATH; it does not
   verify the TUI actually launches, and does not attempt any repair if it's
   wrong.
8. Bootstrap exits to the shell. **Nothing auto-launches the TUI or shows any
   onboarding.**

### First launch: `devforgekit` (no args)

Once `cli/node_modules` exists (installed by bootstrap's own
`ensure_cli_dependencies`) and `node` is on PATH, the root dispatcher execs
`node cli/bin/devforgekit.js` with no args. `bin/devforgekit.js` checks
`isTuiCapable()` (real TTY, not `TERM=dumb`, not `DEVFORGEKIT_NO_TUI=1`) and
either launches the Ink dashboard (with a real first-run `OnboardingWizard`,
`cli/src/tui/components/OnboardingWizard.js`) or falls back to Commander's
own `--help`. This part already works correctly — see the two verification
passes earlier in this thread, which confirmed `cli_available()`, symlink
resolution, and TTY-gated fallback all behave as designed. **This step is not
in scope for further work**; it's included here only for completeness of the
end-to-end flow.

### What gets modified on disk (macOS, full profile)

- `~/.zshrc`, `~/.gitconfig`, mise config, editor `settings.json`/
  `keybindings.json` (both VS Code and Cursor) — via `fs_safe_copy`, which
  backs up differing files as `<file>.backup-<timestamp>` before overwriting.
- `~/Library/LaunchAgents`/service files for started services.
- A symlink at `$(brew --prefix)/bin/devforgekit`.
- `~/.config/devforgekit/` (Node CLI config, once first touched).
- Every package Homebrew installs (currently up to 261 registry-tracked
  components' worth if a user later runs `component install` broadly, though
  `bootstrap.sh` itself only installs what's in the chosen Brewfile, not the
  full registry).

## Problems

1. **No interactive choice on a fresh machine.** A first-time user running
   the documented quick-start (`./bootstrap.sh` or `./devforgekit install`
   with no flags) gets the *full* package set — every cask, every brew
   formula, every VS Code/Cursor extension, every service started — with no
   prompt, no preview, and no easy way to know in advance what's about to
   happen. This is the PRD's central complaint and it's accurate.
2. **VS Code/Cursor extensions install unconditionally**, no opt-out flag
   exists in Layer 1 at all (not even a hidden one).
3. **Services start unconditionally** (opt-*out* via `--skip-services`, not
   opt-*in*) — the inverse of what a cautious first-run experience wants.
4. **No install preview anywhere in Layer 1.** The user sees `brew bundle`'s
   own output scrolling by, not a curated "here's what's about to happen"
   summary with package count, extension count, services, or size/time
   estimate.
5. **No global `devforgekit uninstall`.** The bash dispatcher still prints
   "not implemented yet" (`devforgekit:139-140`); the Node CLI has no
   uninstall command family either. Only per-component uninstall exists
   (`component uninstall <name>`, `cli/src/commands/component.js:142-147`).
   There's no safe, reviewable way to undo a `bootstrap.sh` run.
6. **No install-specific repair.** The existing Intelligent Repair Engine
   (`cli/src/core/repair.js`, 2149 lines, 26 categories, real and mature) has
   no scanner for the specific failure modes a broken CLI install produces:
   the `devforgekit` symlink missing/stale, `cli/node_modules` missing or
   corrupt, `npm install` having failed partway. `doctor.sh --fix` only
   repairs PATH entries, not the Node CLI's own install state.
7. **No resume for a failed/interrupted install.** If `brew bundle` dies
   partway (network drop, a formula failing to build), the next
   `./devforgekit install` just reruns `brew bundle` from scratch — Homebrew
   itself is idempotent enough that this mostly works by luck, not by design,
   and there's no "resume where you left off" concept, no persisted progress
   state, and no failure summary distinguishing "installed/skipped/failed"
   the way the PRD wants.
8. **Two disconnected profile systems.** Layer 1's `profiles/<name>/Brewfile`
   (`minimal`/`flutter`/`backend`/`custom`/root-as-"full") is flat and
   Homebrew-only. Layer 2's `registry/profiles/*.yaml` (49 files) is richer
   (registry-driven, collections+components+settings, no hardcoded Brewfile)
   but is role/stack-oriented (`flutter`, `backend`, `devops`, ...), not
   install-size-tiered, and is a *separate, non-overlapping* system
   (`cli/src/commands/profile.js:1-13` says so explicitly). Neither system
   currently drives the other, so a "Minimal / Recommended / Full / Custom"
   picker has no single existing profile source to read from — it would need
   a new mapping layer or a decision to unify the two systems.
9. **The main install path is macOS/Homebrew-only end to end**, despite a
   genuinely complete cross-platform package-manager abstraction already
   existing at `cli/src/core/platform/{base,macos,linux,windows}.js` (real
   apt/dnf/pacman/winget/choco/scoop support, per CLAUDE.md's v2.2.3 entry).
   That abstraction is only wired into registry-driven installs
   (`component install`, `profile install`, `recipe install` via
   `core/installer.js`) — `bootstrap.sh` hardcodes `brew bundle` and exits
   outright on non-macOS (`bootstrap.sh:75-78`), and the Node CLI's own
   `devforgekit install` command is just a thin `exec bootstrap.sh` wrapper
   (`cli/src/commands/install.js:1-15`). Extending true cross-platform parity
   to the *main* install path is a materially larger effort than the rest of
   this audit's findings combined — see Risks below.
10. **No disk-usage or time estimate anywhere** in the install path (Layer 1
    or Layer 2).
11. **Android Studio and other heavy casks install whenever they're in the
    selected Brewfile tier**, with no per-item opt-out short of hand-editing
    a Brewfile — there's no "you selected Flutter, so we're suggesting
    Android Studio, accept?" negotiation.
12. **No auto-launch of the TUI / onboarding after a successful install.**
    `bootstrap.sh` ends at a bash summary; the (real, already-built)
    `OnboardingWizard` only ever appears on whatever `devforgekit`'s next
    independent invocation happens to be.

## Risks

- **First-impression risk (highest, most fixable):** anyone publishing this
  through npm/Homebrew today, and following the documented quick-start
  verbatim, gets a large, silent, mostly-irreversible install. This is the
  actual product risk driving this milestone and is real.
- **Behavior-change risk on services/extensions:** flipping services and VS
  Code extensions from "on by default" to "prompted/opt-in" is a *breaking
  change* for any existing user who scripts `bootstrap.sh --yes` expecting
  today's behavior. Needs an explicit default decision (e.g., prompt only in
  an interactive TTY; preserve today's behavior under `--yes`/CI) rather than
  a silent flip.
- **Two-profile-systems risk:** building the wizard on top of just one of the
  two existing profile systems (most likely Layer 1's Brewfile tiers, since
  `bootstrap.sh` must work before Node exists) means the richer, role-based
  Layer 2 profiles (Developer/Frontend/Flutter/AI Engineer/...) can't be
  offered from the wizard without either (a) teaching `bootstrap.sh` to be
  registry-aware — a real bash-3.2-constrained undertaking — or (b) accepting
  that the wizard only offers size tiers at install time, and role-based
  profiles remain a separate, later, Node-CLI-only step
  (`devforgekit profile install <name>`) — which is arguably already fine,
  but should be a conscious choice, not an accident.
- **Cross-platform scope risk:** Phase 16 of the source PRD ("package manager
  abstraction... same UX" across macOS/Linux/Windows) sounds like a small
  wiring task given the platform layer already exists, but it isn't — it
  requires either rewriting `bootstrap.sh`'s core install step to route
  through registry packages instead of a flat Brewfile (a fundamental
  architecture change to Layer 1), or building and maintaining parallel
  apt/dnf/pacman/winget/choco/scoop package lists equivalent to the current
  Brewfile, including cask-equivalents for GUI apps that may not exist on
  Linux at all (Android Studio, some editors). This is large enough that it
  should be scoped and staffed as its own decision, separate from the
  UX-focused phases below.
- **Resume/checkpoint correctness risk:** persisting and later trusting
  partial-install state is a classic source of subtle bugs (stale
  checkpoints after a Brewfile edit, double-starting services, re-running
  already-successful `restore_*` steps unnecessarily). Needs conservative
  design — checkpoint at coarse step boundaries, not per-package — and
  thorough test coverage before it ships.
- **Regression risk to a mature, tested system:** `cli/src/core/repair.js`
  (2149 lines), `installRunner.js`, and `bootstrap.sh` are all currently
  working and covered by the existing 1,092-test suite. Every phase below
  must run the full suite and keep it green — per the source PRD's own
  requirement — rather than accepting scope creep that risks the parts that
  already work well.

## Recommended Flow

```
git clone → cd DevForgeKit
  ↓
./devforgekit install                 (no flags, interactive TTY)
  ↓
Welcome wizard: Minimal / Recommended / Full / Custom
  ↓ (Custom only)
Category checklist (Languages / Databases / Cloud / Containers / Editors / ...)
  ↓
Preview: N packages, M VS Code extensions, services to start, ~size, ~time
  ↓ confirm
Install runs — progress bar with elapsed/remaining, continues past a single
package failure, collects a failed/skipped list instead of aborting
  ↓
Post-install: global command + Node CLI install state verified, auto-repaired
if broken (extends the existing repair engine, not a new system)
  ↓
Install health score + summary (extends the existing print_health_score /
scoreResults pattern already used by check.sh/doctor.sh)
  ↓
Auto-launch `devforgekit` (TTY only) → existing OnboardingWizard runs, as
already built
```

Non-interactive/CI/`--yes` usage keeps today's exact behavior (full profile,
services start, extensions install) unchanged — the wizard only engages when
nothing was specified and a real TTY is present, matching the precedent
`bin/devforgekit.js` already sets for the dashboard/`--help` fallback.

`devforgekit uninstall` (and its `--all`/`--packages`/`--config`/`--vscode`/
`--services` variants) and `devforgekit repair install` are net-new commands,
not extensions of the recommended flow above — they're the safety net for
when the flow above wasn't followed, or something drifted afterward.

## Scope Note

This audit does not attempt effort estimates or phase sequencing — that
proposal is presented separately for review before any implementation
begins, per the standing instruction to confirm scope on work this size
before starting.

## Status (post-implementation)

Everything under "Recommended Flow" above shipped across two slices:

- **Slice 1**: interactive wizard (Minimal/Recommended/Full/Custom),
  Custom's registry-derived category checklist, install preview, opt-in
  VS Code/Cursor extensions and services, continue-past-failure Homebrew
  installs, a bounded post-install symlink/`cli/node_modules` check.
- **Slice 2**: real per-package download sizes (HEAD requests against
  the bottle/cask URL, since `brew info --json=v2` itself has no `size`
  field), heavy-package annotations and category descriptions, step-
  numbered progress, already-installed detection, `install-state.json` +
  resume support, a Succeeded/Failed breakdown with a `repair install`
  pointer, a real (not inferred) post-install verification that executes
  `devforgekit --version`/`check`/the dashboard fallback, a first-run
  welcome screen, `devforgekit repair install`, and `devforgekit
  uninstall` (with a real incident along the way — see `scripts/
  uninstall.sh`'s own header comment and `dfk_run_destructive`/
  `dfk_remove_file` in `common.sh` for the safe-test-mode fix it drove).

Still genuinely deferred, per the earlier explicit scoping decision:
**true cross-platform `bootstrap.sh`** (apt/dnf/pacman/winget/choco/scoop
parity for the *main* install path — the platform abstraction in
`cli/src/core/platform/` is real, but only wired into registry-driven
per-component installs, not `bootstrap.sh` itself).
