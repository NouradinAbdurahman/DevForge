# Architecture

## What this repo is

`dev-setup` provisions, backs up, restores, updates, validates, and
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
