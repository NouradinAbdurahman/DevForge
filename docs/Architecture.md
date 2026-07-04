# Architecture

## What this repo is

`DevForge` provisions, backs up, restores, updates, validates, and
releases a complete macOS development workstation. It's not an
application - there's no build step or runtime; every "feature" is a
standalone, idempotent shell script sharing one library.

## Layering

```text
colors.sh   ->  ANSI colors + status symbols (no dependencies)
common.sh   ->  logging, timers, OS/arch detection, safe file copy,
                config/preference domain maps, service control,
                the fault-tolerant step runner (sources colors.sh)
scripts/*.sh -> one script per concern, each sources common.sh and
                composes its functions
bootstrap.sh -> the only script that orchestrates *other* scripts
                (calls scripts/report.sh at the end)
```

Nothing below `common.sh` knows about anything above it. `bootstrap.sh` and
every `scripts/*.sh` file are peers - `bootstrap.sh` is just the one that
runs the others in sequence for a full provision.

## The step runner pattern

Every script follows the same shape:

```bash
source "$SCRIPT_DIR/common.sh"

run_step "description" some_function arg1 arg2       # required - FAIL on error
run_step_optional "description" some_function         # nice-to-have - WARNING on error

if print_summary; then
    exit 0
else
    exit 1
fi
```

`run_step`/`run_step_optional` run their command under a local `set +e`, so
one failing step never kills the rest of the script - it's recorded in
`STEP_RESULTS` and the script keeps going. `print_summary` renders the
final PASS/WARNING/FAIL tally and returns non-zero only if something
actually FAILed (not on WARNINGs).

**Never call `print_summary` as a bare statement** (`print_summary;
STATUS=$?`) - its own exit status reflects whether there were failures, so
under `set -e` a real failure would abort the script *at that line*,
before `STATUS` is even assigned. Always wrap it: `if print_summary; then
... else ... fi`. This bit the CI once already (see git history around the
"stop set -e from swallowing the final summary" fix) - the pattern is now
consistent across every script.

## bash 3.2 compatibility

Every script must run under the stock macOS `/bin/bash` (3.2.57), because
`bootstrap.sh` has to work on a brand-new Mac before anything newer exists.
No `declare -A`, no `declare -g`, no `mapfile`/`readarray`, no
`${var,,}`/`${var^^}`. See `scripts/doctor.sh`'s PATH-duplicate check
(`sort | uniq -d` instead of an associative array) for the pattern to
follow.

Also avoid GNU-only flags: this repo's own `.zshrc` puts Homebrew's GNU
coreutils ahead of the BSD tools on `PATH`, so a flag that only exists on
one implementation (e.g. BSD `df -g`) can silently behave differently
depending on which machine/shell state runs the script. Prefer POSIX-common
flags (`df -Pk`, not `df -g`).

## `set -e` / `pipefail` hazards

Every script runs under `set -Eeuo pipefail`. Two failure modes to watch
for when adding code:

1. A bare pipeline where a middle/early stage can return non-zero (e.g.
   `find` on a missing directory, `grep` finding no matches) will abort the
   script under `pipefail`, even if the final stage in the pipe succeeds.
   Guard with `|| true` when "found nothing" is a valid, expected outcome.
2. A bare function/command call whose own exit code matters (like
   `print_summary`) must never be a plain statement - wrap it in
   `if`/`&&`/`||` so the exemptions in bash's errexit rules apply.

## Config/preference source-of-truth pattern

Rather than each script hardcoding `$HOME` paths or `defaults` domains,
`common.sh` exposes two generator functions that print `key|value` pairs:

- `config_file_pairs()` - repo path <-> `$HOME` path, used by both
  `backup.sh` and `restore.sh` (and `bootstrap.sh`) so there's exactly one
  place that knows, say, where VS Code's `settings.json` lives on disk.
- `preference_domain_pairs()` - `defaults` domain <-> backup filename,
  used by `scripts/preferences.sh`.

Add a new mirrored file/domain in exactly one of those functions, and every
script that iterates it picks it up automatically.

## The `./dev` CLI

`./dev` (repo root, no extension) is a pure dispatcher - it parses
`$1` as a command, shifts, and `exec`s the matching `bootstrap.sh` or
`scripts/*.sh` with the remaining args. It contains no logic of its own
beyond the dispatch table; see [CLI.md](CLI.md). Because it has no `.sh`
extension, it's checked explicitly (not via a `*.sh` glob) in
`scripts/validate.sh` and `.github/workflows/shellcheck.yml`/`lint.yml`.

## Profiles and the PATH manager

Two other pieces built on the same shared-function pattern:

- **Profiles** (`profiles/<name>/Brewfile` + `README.md`) are Brewfile
  subsets. `profile_brewfile_path()`/`resolve_profile()` in `common.sh` are
  the single source of truth `bootstrap.sh`, `scripts/install.sh`, and
  `scripts/profile.sh` all call - see [Profiles.md](Profiles.md).
- **PATH manager** (`path_manager_known_dirs`/`_check`/`_fix` in
  `common.sh`) is the inverse of `doctor.sh`'s existing PATH-hygiene check:
  instead of flagging stale/duplicate entries already on `$PATH`, it flags
  installed-but-not-on-PATH tool directories (Android SDK, pnpm, mise
  shims, GNU coreutils, etc.) and can fix them by appending an idempotent,
  clearly marked block to the live `~/.zshrc` (`scripts/doctor.sh --fix`).

## CodeQL's language matrix

`.github/workflows/codeql.yml` explicitly lists `["actions",
"javascript-typescript", "python"]` rather than letting GitHub
auto-detect languages. This repo previously ran both GitHub's auto-managed
"Default setup" and this custom ("Advanced") workflow at once, which
GitHub does not support running side by side - Default Setup's language
auto-detection also produced a transient false-positive "Ruby" scan job
(there is no Ruby anywhere in this repo). Default Setup is now disabled;
this workflow's explicit matrix is the only CodeQL configuration, matches
the languages that actually exist here (GitHub Actions YAML, JS/TS in
`templates/`, Python in `templates/python`/`templates/fastapi`), and needs
`actions: read` permission for SARIF upload (see the `permissions:` block
in the workflow file).
