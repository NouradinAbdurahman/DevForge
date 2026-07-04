# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A production-grade macOS development workstation lifecycle manager ("dotfiles" repo and then some). There is no application code — the repo provisions, backs up, updates, diagnoses, inventories, and releases a real workstation, and ships copyable project templates. `bootstrap.sh` is the single entry point; `scripts/` holds one focused script per concern, all sharing `scripts/common.sh`/`scripts/colors.sh`. Must run correctly on a brand-new Mac before any of its own tooling exists. Deep-dive docs live in `docs/` (Architecture, Scripts, GitHubActions, Security, ReleaseProcess, Preferences, Inventory, Templates, Troubleshooting, Customization); the README links to all of them.

## Commands

Every command below also works as `./devforgekit <name>` (`./devforgekit doctor` ==
`./scripts/doctor.sh`) - `devforgekit` (repo root, no extension) is a pure
dispatcher, see the Architecture section.

```bash
./bootstrap.sh                 # full provision: Homebrew, mise, dotfiles, editors, services
./bootstrap.sh --dry-run --yes # validate everything with no side effects (what CI runs)
./bootstrap.sh --profile flutter  # or --minimal/--full/--profile <name> - install a Brewfile subset
./scripts/validate.sh          # bash -n + ShellCheck + Brewfile (+ profiles) + mise.toml + JSON + YAML + Markdown
./scripts/check.sh             # fast PASS/WARNING/FAIL sweep + health score
./scripts/doctor.sh [--fix]    # deep diagnostics + PATH manager + health score; --fix repairs missing PATH entries
./scripts/backup.sh            # capture live config into the repo, commit+push if changed
./scripts/restore.sh           # dotfiles/editors only, no packages/services
./scripts/update.sh            # upgrade every managed toolchain, restart services
./scripts/services.sh <start|stop|restart|status>
./scripts/cleanup.sh           # reclaim disk space across every cache
./scripts/report.sh            # writes reports/system-report.txt
./scripts/inventory.sh         # writes reports/{system,hardware,software,brew,fonts,extensions,services,databases,network}.md
./scripts/preferences.sh <backup|restore|status>  # macOS UI preferences (Dock, Finder, etc.)
./scripts/profile.sh <list|show|use> [name]       # manage install profiles (profiles/<name>/Brewfile)
./scripts/release.sh <patch|minor|major>          # bump VERSION, draft CHANGELOG, commit, tag, push
```

No single script installs shellcheck/mise/yq for you when missing — `validate.sh` and others degrade gracefully (log a warning, skip that check) rather than failing when an optional tool isn't present.

## Critical constraint: bash 3.2

Every script must run correctly under the stock macOS `/bin/bash` (3.2.57) — a fresh Mac has nothing newer, and `bootstrap.sh` has to bootstrap Homebrew itself. **Never use bash 4+ features**: no `declare -A` (associative arrays), no `declare -g`, no `mapfile`/`readarray`, no `${var,,}`/`${var^^}`. `scripts/doctor.sh`'s PATH-duplicate check deliberately uses `sort | uniq -d` instead of an associative array for this reason — follow that pattern if you need similar bookkeeping. Validate any new script with `/bin/bash script.sh`, not just whatever `bash` resolves to on PATH (this repo's own `.zshrc` puts Homebrew/GNU coreutils first, which can silently hide bash-3-incompatible code during interactive testing).

Similarly, prefer flags that behave identically under BSD and GNU userland tools, since this machine's PATH may shadow BSD tools with Homebrew's GNU coreutils (`gnu-sed`, `grep`, `findutils`, etc. — see `.zshrc`). Example: disk-space checks use `df -Pk` (POSIX single-line, 1024-byte blocks) rather than BSD-only `df -g`, because `df -g` errors under GNU coreutils' `df`.

## Critical constraint: `set -e` / `pipefail` hazards

Every script runs under `set -Eeuo pipefail`. Two failure modes have already bitten this repo in CI — watch for both when adding code:

1. **Never call `print_summary` as a bare statement.** Its last command returns non-zero whenever any step actually `FAIL`ed, so `print_summary; STATUS=$?` under `set -e` aborts the script *at that line*, before `STATUS` is even assigned — skipping everything after it (timing output, in `bootstrap.sh`'s case the whole final tool checklist). Always wrap it: `if print_summary; then STATUS=0; else STATUS=1; fi` (or `if print_summary; then exit 0; else exit 1; fi` if nothing else follows). Same logic applies to any other function whose own exit status is meaningful (see `bootstrap.sh`'s `_check_tool`, which had the identical bug with a bare `command_exists "$2"`).
2. **A bare pipeline where an early/middle stage can return non-zero** (e.g. `find` on a missing directory, `grep` finding no matches) aborts the script under `pipefail`, even though the last stage in the pipe succeeds — `pipefail` takes the rightmost *non-zero* exit code, not just the last command's. Guard with `|| true` when "found nothing" is a valid outcome (see `scripts/inventory.sh`'s `find`/`grep` calls).

Prefer an `EXIT` trap over an `ERR` trap for "something went wrong" banners: with `errtrace` (`-E`) enabled, an `ERR` trap still fires inside `run_step`/`run_step_optional` even though they run their command under a local `set +e` — trap-on-ERR firing is gated by *command position* (if/while/&&/||), not by whether errexit is currently on. `bootstrap.sh` uses an `EXIT` trap instead, which only fires once, when the script is truly terminating.

## Architecture

- **`scripts/colors.sh`** — ANSI color/symbol constants, disabled automatically when stdout isn't a TTY.
- **`scripts/common.sh`** — the shared library every other script sources. Provides: logging (`log_info`/`log_success`/`log_warn`/`log_error`/`log_section`/`log_step`), timers, OS/arch detection (`os_is_macos`, `os_arch`, `os_brew_prefix` — handles Apple Silicon `/opt/homebrew` vs Intel `/usr/local`), `net_has_internet`, `confirm` (honors `DEV_SETUP_ASSUME_YES=1` and non-interactive shells), `version_of` (first line of `<bin> --version`-style output, or "not installed"), the idempotent `fs_safe_copy` (skips identical files, backs up differing ones as `<file>.backup-<timestamp>` before overwriting), `config_file_pairs`/`preference_domain_pairs` (single source of truth for which repo file maps to which `$HOME` path, and which `defaults` domain maps to which preference backup file), `restore_zsh`/`restore_git`/`restore_mise`/`restore_editor`/`backup_editor`, the `SERVICE_LIST` array and `service_start_all`/`stop_all`/`restart_all`/`status_all`/`verify_all`, and the fault-tolerant step runner (`run_step`, `run_step_optional`, `record_result`, `print_summary`) that every script uses to report PASS/WARNING/FAIL without one failed step killing the whole run.
- **`bootstrap.sh`** — sources `common.sh` and orchestrates, in order: preflight (macOS/arch/internet/disk checks) → Homebrew (`ensure_homebrew` + `brew bundle`) → runtimes/config (`restore_mise`/`restore_zsh`/`restore_git`/`restore_editor` for both editors) → services (start + verify) → `scripts/report.sh` → colored summary with execution time. Supports `--dry-run` (validates without installing/copying/starting anything — this is what CI runs), `--skip-services`, `-y/--yes`.
- **`scripts/*.sh`** are thin, single-purpose entry points built on the same `common.sh` functions — `install.sh` (Homebrew+Brewfile only), `restore.sh` (config only), `backup.sh` (reverse direction: live config → repo, then commit/push only if `git status --porcelain` is non-empty), `update.sh`, `check.sh`, `doctor.sh`, `services.sh`, `validate.sh`, `cleanup.sh`, `report.sh` (writes `reports/system-report.txt`), `inventory.sh` (writes 9 Markdown files under `reports/`: system/hardware/software/brew/fonts/extensions/services/databases/network), `preferences.sh` (`backup|restore|status` for macOS `defaults` domains, stored under `preferences/`), `release.sh` (semver bump + CHANGELOG draft + commit + tag + push — deliberately does *not* call `gh release create` itself since `release.yml` already does that when the tag lands). None of them duplicate logic that belongs in `common.sh`.
- **`devforgekit`** (repo root, no extension) — pure CLI dispatcher: parses `$1` as a command, shifts, `exec`s the matching `bootstrap.sh`/`scripts/*.sh` with the rest of the args. Contains no logic beyond the dispatch table. Because it has no `.sh` extension, it's checked explicitly (not via `*.sh` globs) in `scripts/validate.sh` and `shellcheck.yml`/`lint.yml` — remember to add new scripts there too if they're ever extensionless.
- **`profiles/<name>/`** — Brewfile subsets (`minimal`, `flutter`, `backend`, `custom`; `full` has no file of its own, always resolves to the root `Brewfile`). `profile_brewfile_path()`/`resolve_profile()` in `common.sh` are the single source of truth; `bootstrap.sh --profile <name>`/`--minimal`/`--full`, `scripts/install.sh`, and `scripts/profile.sh` all call them. `.devprofile` (gitignored) stores the persistent default set via `./devforgekit profile use <name>`. Profiles only affect Brewfile-installed packages — dotfiles/editor extensions always restore in full.
- **PATH manager** (`path_manager_known_dirs`/`_check`/`_fix` in `common.sh`, wired into `scripts/doctor.sh`) — the inverse of doctor.sh's existing PATH-hygiene check: flags installed-but-not-on-PATH tool directories (Android SDK, pnpm, mise shims, GNU coreutils) instead of stale/duplicate entries already on PATH. `doctor.sh --fix` appends missing entries to the live `~/.zshrc` inside an idempotent `# >>> DevForgeKit path-manager >>>` marker block (removed and regenerated each time, never accumulates).
- **`print_health_score`** (`common.sh`) — call after `print_summary` in `check.sh`/`doctor.sh`: reads the same `STEP_RESULTS` array, computes a 0-100 score (PASS=full credit, WARNING=half, FAIL=none), prints a Ready/Needs Attention verdict.
- **`vscode/`** and **`cursor/`** are parallel, independent directory pairs (`settings.json`, `keybindings.json`, `extensions.txt`) — not symlinked or generated from a shared source. Update both when a change should apply to both editors.
- **`templates/`** — 14 independent, copyable starter projects (Flutter, Next.js, React, React Native, Node.js, Express, NestJS, Python, FastAPI, Docker, Docker Compose, Terraform, Supabase, Firebase). Not referenced by `bootstrap.sh` or any script; each is self-contained (`README.md`, `.gitignore`, `.editorconfig`, MIT `LICENSE`, a working minimal example). See `docs/Templates.md`.
- **`reports/`** and **`preferences/`** hold generated output (`*.txt`/`*.md` reports, `*.plist` preference backups) — gitignored by default since they can contain machine-identifying data; only `.gitkeep` is tracked.
- **`.github/workflows/`** — `shellcheck.yml` and `lint.yml` run on every push (ShellCheck; `bash -n`; JSON via `jq`; Markdown via `markdownlint-cli`, config in `.markdownlint.json`). `bootstrap.yml` runs `./bootstrap.sh --dry-run --yes` on macOS runners. `update.yml` is a weekly `brew outdated` report. `release.yml` fires on `v*.*.*` tags: verifies `VERSION` matches the tag, runs `validate.sh`, extracts the matching `## [x.y.z]` section from `CHANGELOG.md`, generates a health report, and creates the GitHub release with `Brewfile`/`README.md`/`CHANGELOG.md`/`VERSION`/health report attached. `codeql.yml` (JS/TS analysis of `templates/`), `dependency-review.yml` (every PR), `scorecard.yml` (OSSF Scorecard, weekly) round out security scanning. `.github/dependabot.yml` and `renovate.json` both watch dependencies (GitHub Actions, npm/pnpm per JS template, Docker, Terraform) — running both will duplicate PRs for the same bump, so pick one in practice.

## Editing conventions specific to this repo

- `Brewfile` entries are grouped by package manager prefix (`brew`, `cask`, `vscode`, `npm`); keep new entries under the matching prefix and preserve the one-line comment above each `brew`/`cask` entry.
- Runtime versions belong in `mise.toml`, not `Brewfile`/`.zshrc`, unless the tool isn't mise-managed.
- `vscode/settings.json` and `cursor/settings.json` contain a live `mssql` connection profile block; treat any credentials-shaped fields there as sensitive even when blank, and never add real secrets to these files (they're copied verbatim to `$HOME` and committed). Real secrets go in a local `.env` (gitignored) following `.env.example`.
- When adding a new script, source `scripts/common.sh` the same way every existing script does (`SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` then `source "$SCRIPT_DIR/common.sh"`), use `run_step`/`run_step_optional`/`record_result` for anything worth reporting, and end with `if print_summary; then exit 0; else exit 1; fi` (never a bare `print_summary; exit $?` — see the `set -e`/`pipefail` section above).
- Adding a new mirrored config file or `defaults` domain: add one line to `config_file_pairs()` or `preference_domain_pairs()` in `common.sh` — every script that iterates it (`backup.sh`/`restore.sh`, or `preferences.sh`) picks it up automatically. Don't hardcode the path/domain a second time in the calling script.
- Adding a new project template: create `templates/<name>/` with `README.md`, `.gitignore`, `.editorconfig`, `LICENSE` (copy verbatim from an existing template), and an example that actually runs — not a placeholder. If it has a `package.json`/`Dockerfile`/`.tf` file, add a matching entry to `.github/dependabot.yml`.
- Adding a new install profile: create `profiles/<name>/Brewfile` + `README.md` (first line becomes the one-line description in `./devforgekit profile list`) — no code changes needed, `profile_brewfile_path()` picks up any name with a matching file.
- Adding a directory the PATH manager should know about: one `label|directory` line in `path_manager_known_dirs()` (`common.sh`) — `doctor.sh`/`doctor.sh --fix` pick it up automatically.
- Adding a new `./devforgekit` command: one `case` arm in the `devforgekit` file that `exec`s the relevant script — never put actual logic in `devforgekit` itself.
