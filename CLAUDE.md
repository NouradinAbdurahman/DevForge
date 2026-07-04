# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A production-grade macOS development environment ("dotfiles") repo. There is no application code — the repo provisions, backs up, updates, and diagnoses a real workstation. `bootstrap.sh` is the single entry point; `scripts/` holds one focused script per concern, all sharing `scripts/common.sh`/`scripts/colors.sh`. Must run correctly on a brand-new Mac before any of its own tooling exists.

## Commands

```bash
./bootstrap.sh                 # full provision: Homebrew, mise, dotfiles, editors, services
./bootstrap.sh --dry-run --yes # validate everything with no side effects (what CI runs)
./scripts/validate.sh          # bash -n + ShellCheck + Brewfile + mise.toml + JSON + Markdown
./scripts/check.sh             # fast PASS/WARNING/FAIL sweep across the whole toolchain
./scripts/doctor.sh            # deep diagnostics: PATH hygiene, symlinks, perms, daemons
./scripts/backup.sh            # capture live config into the repo, commit+push if changed
./scripts/restore.sh           # dotfiles/editors only, no packages/services
./scripts/update.sh            # upgrade every managed toolchain, restart services
./scripts/services.sh <start|stop|restart|status>
./scripts/cleanup.sh           # reclaim disk space across every cache
./scripts/report.sh            # writes reports/system-report.txt
```

No single script installs shellcheck/mise/yq for you when missing — `validate.sh` and others degrade gracefully (log a warning, skip that check) rather than failing when an optional tool isn't present.

## Critical constraint: bash 3.2

Every script must run correctly under the stock macOS `/bin/bash` (3.2.57) — a fresh Mac has nothing newer, and `bootstrap.sh` has to bootstrap Homebrew itself. **Never use bash 4+ features**: no `declare -A` (associative arrays), no `declare -g`, no `mapfile`/`readarray`, no `${var,,}`/`${var^^}`. `scripts/doctor.sh`'s PATH-duplicate check deliberately uses `sort | uniq -d` instead of an associative array for this reason — follow that pattern if you need similar bookkeeping. Validate any new script with `/bin/bash script.sh`, not just whatever `bash` resolves to on PATH (this repo's own `.zshrc` puts Homebrew/GNU coreutils first, which can silently hide bash-3-incompatible code during interactive testing).

Similarly, prefer flags that behave identically under BSD and GNU userland tools, since this machine's PATH may shadow BSD tools with Homebrew's GNU coreutils (`gnu-sed`, `grep`, `findutils`, etc. — see `.zshrc`). Example: disk-space checks use `df -Pk` (POSIX single-line, 1024-byte blocks) rather than BSD-only `df -g`, because `df -g` errors under GNU coreutils' `df`.

## Architecture

- **`scripts/colors.sh`** — ANSI color/symbol constants, disabled automatically when stdout isn't a TTY.
- **`scripts/common.sh`** — the shared library every other script sources. Provides: logging (`log_info`/`log_success`/`log_warn`/`log_error`/`log_section`/`log_step`), timers, OS/arch detection (`os_is_macos`, `os_arch`, `os_brew_prefix` — handles Apple Silicon `/opt/homebrew` vs Intel `/usr/local`), `net_has_internet`, `confirm` (honors `DEV_SETUP_ASSUME_YES=1` and non-interactive shells), the idempotent `fs_safe_copy` (skips identical files, backs up differing ones as `<file>.backup-<timestamp>` before overwriting), `config_file_pairs` (single source of truth for which repo file maps to which `$HOME` path), `restore_zsh`/`restore_git`/`restore_mise`/`restore_editor`/`backup_editor`, the `SERVICE_LIST` array and `service_start_all`/`stop_all`/`restart_all`/`status_all`/`verify_all`, and the fault-tolerant step runner (`run_step`, `run_step_optional`, `record_result`, `print_summary`) that every script uses to report PASS/WARNING/FAIL without one failed step killing the whole run.
- **`bootstrap.sh`** — sources `common.sh` and orchestrates, in order: preflight (macOS/arch/internet/disk checks) → Homebrew (`ensure_homebrew` + `brew bundle`) → runtimes/config (`restore_mise`/`restore_zsh`/`restore_git`/`restore_editor` for both editors) → services (start + verify) → `scripts/report.sh` → colored summary with execution time. Supports `--dry-run` (validates without installing/copying/starting anything — this is what CI runs), `--skip-services`, `-y/--yes`.
- **`scripts/*.sh`** are thin, single-purpose entry points built on the same `common.sh` functions — `install.sh` (Homebrew+Brewfile only), `restore.sh` (config only), `backup.sh` (reverse direction: live config → repo, then commit/push only if `git status --porcelain` is non-empty), `update.sh`, `check.sh`, `doctor.sh`, `services.sh`, `validate.sh`, `cleanup.sh`, `report.sh`. None of them duplicate logic that belongs in `common.sh`.
- **`vscode/`** and **`cursor/`** are parallel, independent directory pairs (`settings.json`, `keybindings.json`, `extensions.txt`) — not symlinked or generated from a shared source. Update both when a change should apply to both editors.
- **`.github/workflows/`** — `shellcheck.yml` and `lint.yml` run on every push (ShellCheck; `bash -n`; JSON via `jq`; Markdown via `markdownlint-cli`, config in `.markdownlint.json`). `bootstrap.yml` runs `./bootstrap.sh --dry-run --yes` on macOS runners. `update.yml` is a weekly `brew outdated` report. `release.yml` fires on `v*.*.*` tags: verifies `VERSION` matches the tag, runs `validate.sh`, extracts the matching `## [x.y.z]` section from `CHANGELOG.md`, and creates the GitHub release.

## Editing conventions specific to this repo

- `Brewfile` entries are grouped by package manager prefix (`brew`, `cask`, `vscode`, `npm`); keep new entries under the matching prefix and preserve the one-line comment above each `brew`/`cask` entry.
- Runtime versions belong in `mise.toml`, not `Brewfile`/`.zshrc`, unless the tool isn't mise-managed.
- `vscode/settings.json` and `cursor/settings.json` contain a live `mssql` connection profile block; treat any credentials-shaped fields there as sensitive even when blank, and never add real secrets to these files (they're copied verbatim to `$HOME` and committed). Real secrets go in a local `.env` (gitignored) following `.env.example`.
- When adding a new script, source `scripts/common.sh` the same way every existing script does (`SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` then `source "$SCRIPT_DIR/common.sh"`), use `run_step`/`run_step_optional`/`record_result` for anything worth reporting, and end with `print_summary; exit $?` so failures propagate a real exit code to CI.
