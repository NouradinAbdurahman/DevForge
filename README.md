# dev-setup

A production-grade macOS development environment: clone this repo on any Mac
(Apple Silicon or Intel, fresh install or existing machine) and run one
command to provision the entire workstation - Homebrew packages, language
runtimes, shell, Git, VS Code, Cursor, and local services.

```bash
git clone https://github.com/NouradinAbdurahman/dev-setup.git
cd dev-setup
chmod +x bootstrap.sh
./bootstrap.sh
```

Every script here is safe to run more than once: nothing is reinstalled,
recopied, or restarted unless it's actually missing or different.

## Features

- **One-command bootstrap** - detects macOS version, CPU architecture,
  internet connectivity, and free disk space, then installs Homebrew, every
  package in the `Brewfile`, mise-managed runtimes, Zsh/Git config, VS Code
  and Cursor settings/keybindings/extensions, and starts local services.
- **Idempotent by design** - config files are only copied when their content
  differs from what's on disk; anything that would be overwritten is backed
  up first as `<file>.backup-<timestamp>`.
- **Fault-tolerant** - a single failed step (a package that won't install, a
  service that won't start) is logged and the run continues; you get a full
  PASS/WARNING/FAIL summary at the end instead of a script that dies halfway.
- **Two-way sync** - `scripts/backup.sh` captures your live configuration
  back into the repo and commits/pushes it; `scripts/restore.sh` (or
  `bootstrap.sh`) puts it back on any machine.
- **Diagnostics** - `scripts/check.sh` for a fast health check across the
  whole toolchain, `scripts/doctor.sh` for deep diagnostics (PATH hygiene,
  broken symlinks, permissions, Docker daemon state, toolchain doctors).
- **CI-checked** - every script is validated with `bash -n` and ShellCheck,
  the `Brewfile` is checked with `brew bundle check`, and `bootstrap.sh
  --dry-run` is exercised on every push (see [.github/workflows](.github/workflows)).

## Requirements

- macOS (Apple Silicon or Intel)
- Xcode Command Line Tools (`xcode-select --install`, if not already present)
- An internet connection for the initial Homebrew/package install

## Installation

```bash
git clone https://github.com/NouradinAbdurahman/dev-setup.git
cd dev-setup
chmod +x bootstrap.sh
./bootstrap.sh
```

Flags:

| Flag | Effect |
| --- | --- |
| `-y`, `--yes` | Assume "yes" to every confirmation prompt (non-interactive) |
| `--skip-services` | Don't start PostgreSQL/MySQL/Redis |
| `--dry-run` | Validate everything without installing, copying, or starting anything (used by CI) |

## Folder structure

```text
dev-setup/
├── bootstrap.sh          # main installer - see below
├── Brewfile              # Homebrew formulae, casks, VS Code/Cursor extensions, npm globals
├── mise.toml             # pinned runtime versions (Java, Node, Python)
├── .zshrc                # shell config restored to ~/.zshrc
├── .gitconfig            # git config restored to ~/.gitconfig
├── .gitignore_global     # global gitignore restored to ~/.gitignore_global
├── .env.example          # template for local secrets (never commit .env)
├── vscode/               # settings.json, keybindings.json, extensions.txt
├── cursor/               # settings.json, keybindings.json, extensions.txt
├── scripts/
│   ├── common.sh      # shared logging/timer/OS-detection/copy/service functions
│   ├── colors.sh      # ANSI colors and status symbols
│   ├── install.sh     # Homebrew + Brewfile only
│   ├── restore.sh     # dotfiles + editors only (no packages, no services)
│   ├── backup.sh      # capture live config back into the repo, commit + push
│   ├── update.sh      # upgrade every managed toolchain
│   ├── check.sh       # PASS/WARNING/FAIL health check
│   ├── doctor.sh      # deep diagnostics
│   ├── services.sh    # start|stop|restart|status for Postgres/MySQL/Redis
│   ├── validate.sh    # shell/JSON/Brewfile/mise static validation
│   ├── cleanup.sh     # reclaim disk space across every cache
│   └── report.sh      # generate reports/system-report.txt
├── reports/               # generated system reports (gitignored)
├── docs/                  # additional documentation
└── .github/workflows/     # CI: bootstrap dry-run, ShellCheck, lint, update check, release
```

## Bootstrap

`bootstrap.sh` runs, in order:

1. **Preflight** - confirms macOS, detects Apple Silicon vs Intel, checks
   internet connectivity and free disk space.
2. **Homebrew** - installs Homebrew if missing, then `brew bundle` against
   `Brewfile`.
3. **Runtimes and configuration** - `mise install`, then restores `.zshrc`,
   `.gitconfig`/`.gitignore_global`, and VS Code/Cursor settings,
   keybindings, and extensions.
4. **Services** - starts PostgreSQL, MySQL, and Redis via `brew services`,
   then verifies each actually accepts connections (`pg_isready`,
   `mysqladmin ping`, `redis-cli ping`).
5. **Report** - writes `reports/system-report.txt`.
6. **Summary** - a colored PASS/WARNING/FAIL tally, a checklist of key
   tools, and total execution time.

## Backup

Capture your live configuration back into the repo and push it:

```bash
./scripts/backup.sh
```

This refreshes `.zshrc`, `.gitconfig`, `.gitignore_global`, `mise.toml`, and
the VS Code/Cursor settings, keybindings, and extension lists from what's
actually on your machine, then commits and pushes **only if something
changed** - it never creates empty commits.

## Restore

Re-sync dotfiles and editor configuration from the repo without touching
Homebrew packages or services:

```bash
./scripts/restore.sh
```

## Update

Upgrade every managed toolchain (Homebrew, mise runtimes, Flutter/Dart,
pnpm, Git LFS, CocoaPods) and restart services:

```bash
./scripts/update.sh
```

## Doctor

Deep diagnostics - PATH duplicates/dangling entries, shell integration,
broken symlinks, permissions, Git/SSH/GitHub auth, Docker daemon state,
`brew doctor`/`mise doctor`/`flutter doctor`, service status, and outdated
packages:

```bash
./scripts/doctor.sh
```

## Health check

A fast PASS/WARNING/FAIL sweep across the whole toolchain (Git, GitHub,
SSH, Docker, Flutter, Dart, Android SDK, Java, Node, npm, pnpm, Python,
mise, Homebrew, PostgreSQL, MySQL, Redis, Supabase, Firebase, AWS,
Terraform, kubectl, Helm, VS Code, Cursor, Android Studio, Xcode,
CocoaPods, Git LFS, fzf, jq, yq, SQLite):

```bash
./scripts/check.sh
```

## Services

```bash
./scripts/services.sh start
./scripts/services.sh stop
./scripts/services.sh restart
./scripts/services.sh status
```

## Customization

- **Packages**: add or remove entries in `Brewfile` (grouped by `brew`,
  `cask`, `vscode`, and `npm` prefixes; each `brew`/`cask` line keeps a
  one-line comment explaining what it's for).
- **Runtime versions**: edit `mise.toml`.
- **Shell**: edit `.zshrc` - it's restored verbatim to `~/.zshrc`.
- **Editors**: `vscode/` and `cursor/` are parallel, independent directories
  (`settings.json`, `keybindings.json`, `extensions.txt`); update both when a
  change should apply to both editors.
- **Secrets**: copy `.env.example` to `.env` and fill in real values - `.env`
  is gitignored and never restored/backed up by any script.

## Troubleshooting

- **A step failed during bootstrap** - re-run `./bootstrap.sh`; it's
  idempotent, so already-completed steps are skipped and only the failed
  step (and anything after it) needs to succeed. Check the PASS/WARNING/FAIL
  summary at the end for exactly which step failed.
- **Something looks wrong beyond a simple failure** - run `./scripts/doctor.sh`
  for deep diagnostics, or `./scripts/check.sh` for a quick pass/fail sweep.
- **A config file didn't get overwritten as expected** - `fs_safe_copy` (in
  `scripts/common.sh`) skips copying when content is already identical, and
  otherwise backs up the existing file to `<file>.backup-<timestamp>` before
  overwriting. Look for a `.backup-*` file next to the one you expected to
  change; run `./scripts/cleanup.sh` periodically to prune backups older
  than 30 days.
- **Services won't start** - `./scripts/services.sh status` shows what
  Homebrew thinks is running; `./scripts/doctor.sh` verifies they actually
  accept connections, not just that launchd reports them as started.
- **Validating changes to this repo itself** - run `./scripts/validate.sh`
  (shell syntax, ShellCheck, Brewfile, mise.toml, JSON, Markdown) before
  committing.

## Versioning

This repository follows [Semantic Versioning](https://semver.org/). See
[VERSION](VERSION) for the current version and [CHANGELOG.md](CHANGELOG.md)
for release history.

## License

[MIT](LICENSE)
