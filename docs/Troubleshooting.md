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
- **`bootstrap.sh` fails on a fresh Mac** - ensure Xcode Command Line
  Tools are installed (`xcode-select --install`). The preflight check
  should catch this, but if it was skipped, install them manually and
  re-run.

## Diagnostics

- **Something looks wrong beyond a simple failure** - run
  `./devforgekit doctor` for deep diagnostics (PATH duplicates/dangling
  entries, broken symlinks, permissions, Git/SSH/GitHub auth, Docker
  daemon state, `brew doctor`/`mise doctor`/`flutter doctor`, outdated
  packages), or `./devforgekit check` for a faster pass/fail sweep across
  the whole toolchain.
- **Services won't start** - `./devforgekit services status` shows what
  Homebrew thinks is running; `./devforgekit doctor` (or
  `service_verify_all` under the hood) verifies they actually accept
  connections, not just that launchd reports them as started.
- **A tool is installed but not found on PATH** - run
  `./devforgekit doctor --fix`. The PATH manager detects
  installed-but-not-on-PATH tool directories (Android SDK, pnpm, mise
  shims, GNU coreutils, ...) and appends them to `~/.zshrc` inside an
  idempotent marker block.

## Compatibility

- **`compatibility scan` shows Critical** - run
  `./devforgekit compatibility explain <name>` for a per-component
  requirement breakdown, then `./devforgekit compatibility repair`
  to generate and execute a repair plan. The repair plan installs
  missing requirements automatically, but never removes a conflicting
  package without confirmation.
- **Flutter doctor shows errors after install** - run
  `./devforgekit compatibility check flutter`. The Compatibility Engine
  validates version-range requirements (Flutter needs Dart >=3.8) and
  cross-package conflicts that `flutter doctor` itself doesn't check.

## AI Assistant

- **"No AI provider configured"** - set an API key environment variable
  (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc.) and
  run `devforgekit config set aiProvider <provider>`. See
  [AIAssistant.md](AIAssistant.md) for provider setup.
- **AI command returns an error** - run `devforgekit ai health` for a
  transparent per-check breakdown (Provider/Credential/Model/
  Configuration/Memory/Context/Diagnostics/Streaming).
- **AI response is slow** - run `devforgekit ai benchmark` to measure
  provider latency. Consider using a local provider (Ollama, LM Studio)
  for lower latency.
- **Chat output shows raw Markdown** - this was fixed in v2.1.3.1. Run
  `devforgekit self-update` to get the latest version.

## TUI / Dashboard

- **Dashboard doesn't open** - the TUI requires a TTY. Non-TTY
  environments (piped output, CI, `TERM=dumb`) fall back to classic
  `--help`. Set `DEVFORGEKIT_NO_TUI=1` to skip the TUI explicitly.
- **Dashboard looks broken / garbled** - ensure your terminal is at
  least 80x24. The TUI is responsive down to 80x24 but may not render
  correctly below that. Try `TERM=xterm-256color` if colors look wrong.
- **Keystrokes are lost or delayed** - this was a real bug (keypresses
  coalescing under load) fixed by batching install-state probes. Run
  `devforgekit self-update` to get the fix. Debug with
  `DEVFORGEKIT_TUI_DEBUG=1`.
- **Startup animation is too slow** - set
  `devforgekit config set startupAnimationSpeed fast` for reduced
  motion, or `devforgekit config set startupAnimation false` to disable
  entirely.

## Plugins

- **Plugin install fails with checksum mismatch** - the archive was
  corrupted or tampered with. Re-download or re-package. Checksum
  verification is mandatory and cannot be skipped.
- **Plugin install warns about untrusted signature** - the plugin was
  signed by a key you haven't trusted. Run
  `devforgekit plugin trust <pubkey>` to trust it, or install with
  `-y/--yes` to accept the warning.
- **Plugin doesn't appear in `plugin list`** - run
  `devforgekit plugin doctor` to diagnose. Common causes: invalid
  manifest, incompatible engine version, or missing dependencies.
- **`plugin validate` shows FAIL** - run
  `devforgekit plugin validate <dir>` for a detailed check list. Common
  issues: missing command scripts, missing README, duplicate command
  names, invalid semver version.

## Workspace Manager

- **`workspace switch` fails** - run `devforgekit workspace verify` to
  check which subsystem failed. Each subsystem (git, ssh, env, docker,
  kubernetes, cloud, shell) is independent - one failing doesn't roll
  back the others.
- **Secrets not decrypting after import** - secrets are encrypted with
  a machine-local key (`~/.config/devforgekit/workspace-secret.key`).
  Imported workspaces list required secrets in `missing-secrets.md` -
  you need to set them up on the new machine.
- **`workspace rollback` doesn't restore everything** - rollback
  restores the workspace definition and subsystem state, but cannot
  undo external changes (e.g., Docker contexts that were deleted
  between the snapshot and the rollback).

## Project Generator

- **`devforgekit new <stack>` fails** - ensure the stack's CLI is
  installed (`flutter`, `create-next-app`, `django-admin`, etc.). Run
  `devforgekit new --list` to see requirements per stack. The generator
  checks `requiresTool` before scaffolding and gives an actionable
  error if the CLI is missing.
- **Generated project is missing files** - run
  `devforgekit new <stack> --quality` to see the Generator Quality
  Score. Some stacks have lower scores in certain categories (e.g.,
  Docker, CI) - this is tracked transparently.

## Registry

- **`registry generate` fails** - a YAML manifest is invalid. Run
  `devforgekit registry verify` to find which file fails AJV
  validation. The error message includes the schema path that failed.
- **`component install` fails** - run `devforgekit info <name>` for
  detailed diagnostics: status, responsibility (User/Vendor/Registry),
  platform support, suggested fix, and alternatives.
- **`registry audit` shows low coverage** - the audit surfaces real
  gaps (missing `architectures`, `documentation`, `ciVerified`). These
  are optional fields - the registry works without them, but filling
  them in improves the Manifest Quality Score.

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

## Self-Update

- **`self-update` fails and rolls back** - check the output for which
  step failed. The rollback restores the previous state. Common causes:
  network issues during `git pull`, `npm install` failures, or config
  migration errors. Fix the underlying issue and re-run.
- **`self-update --dry-run` shows changes I don't expect** - the dry-run
  previews git changes, npm installs, config migrations, and plugin
  updates. Review the output before running the real update.

## Validating changes to this repo itself

Run `./scripts/validate.sh` (shell syntax, ShellCheck, Brewfile,
mise.toml, JSON, YAML, Markdown) before committing. If ShellCheck isn't
installed locally, `brew install shellcheck` first - `validate.sh` skips
that check (with a warning) rather than failing when it's missing, but CI
always has it.

For the Node CLI:

```bash
cd cli && npm run lint    # eslint
cd cli && npm test        # 700+ unit tests
```

## Common `set -e` gotcha if you're extending a script

If you add a bare pipeline or bare function call whose exit status can be
non-zero in a normal (non-error) case, `set -e`/`pipefail` will silently
abort the script at that line - see
[Architecture.md](Architecture.md#set--e--pipefail-hazards) for the two
concrete failure modes this repo has already hit and fixed.

## Getting help

- **Full command reference**: [CommandReference.md](CommandReference.md)
- **TUI keyboard shortcuts**: [KeyboardShortcuts.md](KeyboardShortcuts.md)
- **Architecture diagrams**: [ArchitectureDiagrams.md](ArchitectureDiagrams.md)
- **Migration guide**: [MigrationGuide.md](MigrationGuide.md)
- **Contributing guide**: [CONTRIBUTING.md](../CONTRIBUTING.md)
- **AI coding guide**: [CLAUDE.md](../CLAUDE.md)
