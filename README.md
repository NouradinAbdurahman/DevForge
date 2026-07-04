# dev-setup

A production-grade macOS development workstation lifecycle manager: clone
this repo on any Mac (Apple Silicon or Intel, fresh install or existing
machine) and run one command to provision the entire environment -
Homebrew packages, language runtimes, shell, Git, VS Code, Cursor, and
local services. Beyond first-run provisioning, it backs itself up,
restores itself, updates itself, diagnoses itself, inventories the
machine, backs up macOS UI preferences, ships ready-to-copy project
templates, and manages its own releases.

```bash
git clone https://github.com/NouradinAbdurahman/dev-setup.git
cd dev-setup
chmod +x bootstrap.sh
./bootstrap.sh
```

Every script here is safe to run more than once: nothing is reinstalled,
recopied, or restarted unless it's actually missing or different.

## Features

- **One-command bootstrap** with macOS/CPU-architecture/internet/disk
  preflight checks, fault-tolerant steps (one failure doesn't kill the
  run), and a `--dry-run` mode that validates everything with zero side
  effects.
- **Idempotent by design** - config files are only copied when their
  content differs from what's on disk; anything that would be overwritten
  is backed up first.
- **Two-way config sync** - `scripts/backup.sh` captures your live
  configuration back into the repo and pushes it; `scripts/restore.sh` (or
  `bootstrap.sh`) puts it back on any machine.
- **Diagnostics** - `scripts/check.sh` for a fast health check,
  `scripts/doctor.sh` for deep diagnostics.
- **Machine inventory** - `scripts/inventory.sh` writes 9 Markdown reports
  (hardware, software, fonts, extensions, services, databases, network...).
- **macOS preferences backup** - `scripts/preferences.sh` backs up/restores
  Dock, Finder, Trackpad, Keyboard, Mouse, Terminal, Dark Mode, Mission
  Control, Hot Corners, and more.
- **14 ready-to-copy project templates** (Flutter, Next.js, React, React
  Native, Node.js, Express, NestJS, Python, FastAPI, Docker, Docker
  Compose, Terraform, Supabase, Firebase) under `templates/`.
- **Self-managed releases** - `scripts/release.sh` bumps the version,
  drafts a changelog, tags, and pushes; a GitHub Actions workflow takes it
  from there.
- **CI-checked** - ShellCheck, shell syntax, Brewfile/mise.toml/JSON/YAML/
  Markdown validation, a bootstrap dry-run, CodeQL, dependency review, and
  OSSF Scorecard all run automatically (see
  [docs/GitHubActions.md](docs/GitHubActions.md)).
- **Dependency automation** via Dependabot and Renovate.

## Requirements

- macOS (Apple Silicon or Intel)
- Xcode Command Line Tools (`xcode-select --install`, if not already present)
- An internet connection for the initial Homebrew/package install

## Architecture

`colors.sh` (ANSI colors) underlies `common.sh` (logging, timers, OS/arch
detection, idempotent file copy, config/preference source-of-truth maps,
service control, and a fault-tolerant step runner), which every script in
`scripts/` sources. `bootstrap.sh` is the only script that orchestrates
other scripts; every other script is a standalone, single-purpose entry
point built on the same shared functions. Full write-up, including the
`bash 3.2` compatibility constraint and the `set -e`/`pipefail` gotchas
this repo has already hit and fixed, in
[docs/Architecture.md](docs/Architecture.md).

## Folder structure

```text
dev-setup/
├── bootstrap.sh              # main installer
├── Brewfile                  # Homebrew formulae, casks, VS Code/Cursor extensions, npm globals
├── mise.toml                 # pinned runtime versions (Java, Node, Python)
├── .zshrc / .gitconfig / .gitignore_global
├── .env.example              # template for local secrets (never commit .env)
├── VERSION / CHANGELOG.md / LICENSE
├── vscode/ cursor/            # settings.json, keybindings.json, extensions.txt
├── scripts/
│   ├── common.sh / colors.sh   # shared library
│   ├── install.sh               # Homebrew + Brewfile only
│   ├── restore.sh                # dotfiles + editors only
│   ├── backup.sh                  # live config -> repo, commit + push
│   ├── update.sh                   # upgrade every managed toolchain
│   ├── check.sh                     # PASS/WARNING/FAIL health check
│   ├── doctor.sh                     # deep diagnostics
│   ├── services.sh                    # start|stop|restart|status
│   ├── validate.sh                     # shell/JSON/YAML/Brewfile/mise/Markdown validation
│   ├── cleanup.sh                       # reclaim disk space
│   ├── report.sh                         # reports/system-report.txt
│   ├── inventory.sh                       # reports/*.md (9 files)
│   ├── preferences.sh                      # macOS UI preferences backup/restore
│   └── release.sh                          # version bump, changelog, tag, push
├── reports/                   # generated reports (gitignored)
├── preferences/                # generated preference backups (gitignored)
├── templates/                   # 14 starter project templates
├── docs/                         # deep-dive documentation (see below)
└── .github/
    ├── dependabot.yml
    └── workflows/                 # bootstrap, shellcheck, lint, update, release,
                                    # codeql, dependency-review, scorecard
```

## Installation

```bash
git clone https://github.com/NouradinAbdurahman/dev-setup.git
cd dev-setup
chmod +x bootstrap.sh
./bootstrap.sh
```

Flags: `-y`/`--yes` (assume yes to every prompt), `--skip-services` (don't
start Postgres/MySQL/Redis), `--dry-run` (validate everything, change
nothing - what CI runs).

## Bootstrap

Runs, in order: preflight (macOS/arch/internet/disk) -> Homebrew ->
runtimes/config (mise, `.zshrc`, Git, VS Code, Cursor) -> services -> a
generated report -> a colored PASS/WARNING/FAIL summary with execution
time. Details in [docs/Scripts.md](docs/Scripts.md).

## Restore

```bash
./scripts/restore.sh
```

Re-syncs dotfiles and editor configuration from the repo without touching
Homebrew packages or services.

## Backup

```bash
./scripts/backup.sh
```

Captures your live `.zshrc`/`.gitconfig`/`.gitignore_global`/`mise.toml`
and VS Code/Cursor settings, keybindings, and extension lists, then
commits and pushes **only if something changed** - never an empty commit.

## Update

```bash
./scripts/update.sh
```

Upgrades Homebrew, mise runtimes, Flutter/Dart, pnpm, Git LFS, and
CocoaPods, then restarts and re-verifies services.

## Health check

```bash
./scripts/check.sh
```

A fast PASS/WARNING/FAIL sweep across Git, GitHub, SSH, Docker, Flutter,
Dart, Android SDK, Java, Node, npm, pnpm, Python, mise, Homebrew,
PostgreSQL, MySQL, Redis, Supabase, Firebase, AWS, Terraform, kubectl,
Helm, VS Code, Cursor, Android Studio, Xcode, CocoaPods, Git LFS, fzf, jq,
yq, and SQLite.

## Doctor

```bash
./scripts/doctor.sh
```

Deep diagnostics - PATH duplicates/dangling entries, shell integration,
broken symlinks, permissions, Git/SSH/GitHub auth, Docker daemon state,
`brew doctor`/`mise doctor`/`flutter doctor`, service status, outdated
packages.

## Services

```bash
./scripts/services.sh start|stop|restart|status
```

## Inventory

```bash
./scripts/inventory.sh
```

Writes `reports/system.md`, `hardware.md`, `software.md`, `brew.md`,
`fonts.md`, `extensions.md`, `services.md`, `databases.md`, and
`network.md`. Serial numbers are masked to the last 4 characters. Details
in [docs/Inventory.md](docs/Inventory.md).

## Preferences

```bash
./scripts/preferences.sh backup|restore|status
```

Backs up/restores Dock, Finder, Trackpad, Keyboard, Mouse, Screenshots,
Terminal, Appearance/Dark Mode, Mission Control, Stage Manager, Menu Bar,
Control Center, Hot Corners, and (optionally) Safari, stored under
`preferences/` (gitignored by default). Full domain mapping and design
notes in [docs/Preferences.md](docs/Preferences.md).

## Templates

14 starter scaffolds under `templates/` - Flutter, Next.js, React, React
Native, Node.js, Express, NestJS, Python, FastAPI, Docker, Docker Compose,
Terraform, Supabase, Firebase. Each ships a README, `.gitignore`,
`.editorconfig`, MIT `LICENSE`, and a genuinely working minimal example.
Copy one out to start a new project:

```bash
cp -r templates/nextjs ~/Developer/my-new-app
```

Full list and what each example does in
[docs/Templates.md](docs/Templates.md).

## Release process

```bash
./scripts/release.sh patch|minor|major
```

Validates the repo (clean tree, `validate.sh`, `bootstrap.sh --dry-run`,
CI status), bumps `VERSION`, drafts a `CHANGELOG.md` entry from recent
commits, commits, tags, and pushes. Pushing the tag triggers
`.github/workflows/release.yml`, which builds and publishes the actual
GitHub Release with `Brewfile`/`README.md`/`CHANGELOG.md`/`VERSION`/a
health report attached. Full flow in
[docs/ReleaseProcess.md](docs/ReleaseProcess.md).

## GitHub Actions

`bootstrap.yml` (dry-run on every push), `shellcheck.yml`, `lint.yml`,
`update.yml` (weekly outdated-package report), `release.yml` (tag-triggered),
`codeql.yml`, `dependency-review.yml` (every PR), `scorecard.yml` (OSSF
Scorecard). Dependabot and Renovate both watch dependencies. Full
breakdown in [docs/GitHubActions.md](docs/GitHubActions.md).

## Troubleshooting

Short version: re-run `./bootstrap.sh` (idempotent), use `--dry-run` to
test without side effects, run `./scripts/doctor.sh` for deep diagnostics,
check for `<file>.backup-<timestamp>` if a config didn't update as
expected. Full guide, including release and preferences troubleshooting,
in [docs/Troubleshooting.md](docs/Troubleshooting.md).

## FAQ

**Does this work on Intel Macs?**
Yes - `os_arch`/`os_brew_prefix` in `scripts/common.sh` detect Apple
Silicon (`/opt/homebrew`) vs Intel (`/usr/local`) and adjust accordingly.

**Will running `bootstrap.sh` again overwrite my changes to `.zshrc` etc.?**
No, not silently. `fs_safe_copy` only copies when content actually
differs, and backs up the existing file as `<file>.backup-<timestamp>`
first.

**Why are Dependabot *and* Renovate both configured?**
For flexibility - pick one to avoid duplicate PRs for the same dependency
bump. See [docs/GitHubActions.md](docs/GitHubActions.md).

**Where do generated reports/preference backups go, and are they committed?**
`reports/` and `preferences/` - both gitignored by default, since they can
contain machine-identifying details. See [docs/Security.md](docs/Security.md).

**Can I use the project templates without the rest of this repo?**
Yes - `templates/` is fully independent; `cp -r` one out and it's a
self-contained starter project.

## Roadmap

- Broaden CodeQL coverage as more languages get added to `templates/`.
- Consider a `scripts/migrate.sh` for repo-layout version migrations if
  `bootstrap.sh`'s CLI ever needs a breaking change.
- Revisit whether Dependabot or Renovate should be the sole default once
  real-world PR volume from both is observed.

## Contributing

This is a personal workstation-provisioning repo, but issues and PRs are
welcome. Before submitting a change:

```bash
./scripts/validate.sh          # shell syntax, ShellCheck, Brewfile, mise.toml, JSON, YAML, Markdown
./bootstrap.sh --dry-run --yes # exercises the real preflight/detection logic, no side effects
```

Follow the existing script conventions (see
[docs/Architecture.md](docs/Architecture.md) and
[docs/Customization.md](docs/Customization.md)) - especially the bash 3.2
compatibility constraint and the `set -e`/`pipefail` safety patterns.

## Versioning

[Semantic Versioning](https://semver.org/). Current version in
[VERSION](VERSION); history in [CHANGELOG.md](CHANGELOG.md); release
mechanics in [docs/ReleaseProcess.md](docs/ReleaseProcess.md).

## License

[MIT](LICENSE)
