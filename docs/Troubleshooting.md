# Troubleshooting

## Bootstrap

- **A step failed during `bootstrap.sh`** - re-run `./bootstrap.sh`; it's
  idempotent, so already-completed steps are skipped and only the failed
  step (and anything after it) needs to succeed. Check the
  PASS/WARNING/FAIL summary at the end for exactly which step failed.
- **Want to test changes without touching your machine** - use
  `./bootstrap.sh --dry-run --yes`. It validates the Brewfile, confirms
  config files are present, and skips every install/copy/service-start
  step. This is exactly what `bootstrap.yml` runs in CI.
- **A config file didn't get overwritten as expected** - `fs_safe_copy` (in
  `scripts/common.sh`) skips copying when content is already identical,
  and otherwise backs up the existing file to `<file>.backup-<timestamp>`
  before overwriting. Look for a `.backup-*` file next to the one you
  expected to change; `./scripts/cleanup.sh` prunes backups older than 30
  days.

## Diagnostics

- **Something looks wrong beyond a simple failure** - run
  `./scripts/doctor.sh` for deep diagnostics (PATH duplicates/dangling
  entries, broken symlinks, permissions, Git/SSH/GitHub auth, Docker
  daemon state, `brew doctor`/`mise doctor`/`flutter doctor`, outdated
  packages), or `./scripts/check.sh` for a faster pass/fail sweep across
  the whole toolchain.
- **Services won't start** - `./scripts/services.sh status` shows what
  Homebrew thinks is running; `./scripts/doctor.sh` (or
  `service_verify_all` under the hood) verifies they actually accept
  connections, not just that launchd reports them as started.

## Preferences

- **`preferences.sh backup` keeps asking to overwrite** - that means the
  live setting actually differs from your last backup (e.g. you changed
  your Dock recently). Confirm to refresh the backup, or answer no to
  leave the old one in place.
- **`preferences.sh restore` didn't visibly change anything** - some
  settings (Appearance, Stage Manager) need a logout/restart to fully
  apply, even after the `killall Dock/Finder/SystemUIServer/cfprefsd` step.

## Releases

- **`scripts/release.sh` aborted at preflight** - it's designed to abort
  (not warn) if the working tree is dirty, `validate.sh` fails,
  `bootstrap.sh --dry-run` fails, or the current commit has a failed
  GitHub Actions run. Fix the underlying issue first; don't bypass this by
  hand-editing `VERSION`/`CHANGELOG.md` and tagging directly unless you've
  independently verified the same things.
- **Tag pushed but no GitHub Release appeared** - check the `Release`
  workflow run in the Actions tab; the most common cause is the `VERSION`
  file not matching the tag (`release.yml`'s first step hard-fails on
  mismatch).

## Validating changes to this repo itself

Run `./scripts/validate.sh` (shell syntax, ShellCheck, Brewfile,
mise.toml, JSON, YAML, Markdown) before committing. If ShellCheck isn't
installed locally, `brew install shellcheck` first - `validate.sh` skips
that check (with a warning) rather than failing when it's missing, but CI
always has it.

## Common `set -e` gotcha if you're extending a script

If you add a bare pipeline or bare function call whose exit status can be
non-zero in a normal (non-error) case, `set -e`/`pipefail` will silently
abort the script at that line - see
[Architecture.md](Architecture.md#set--e--pipefail-hazards) for the two
concrete failure modes this repo has already hit and fixed.
