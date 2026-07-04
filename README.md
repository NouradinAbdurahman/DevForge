# DevForgeKit

A production-grade macOS development workstation lifecycle manager: clone
this repo on any Mac (Apple Silicon or Intel, fresh install or existing
machine) and run one command to provision the entire environment -
Homebrew packages, language runtimes, shell, Git, VS Code, Cursor, and
local services. Beyond first-run provisioning, it backs itself up,
restores itself, updates itself, diagnoses itself, inventories the
machine, backs up macOS UI preferences, ships ready-to-copy project
templates, and manages its own releases.

```bash
git clone https://github.com/NouradinAbdurahman/DevForgeKit.git
cd DevForgeKit
chmod +x bootstrap.sh devforgekit
./devforgekit install
```

`./devforgekit` is a single CLI over everything in this repo (`./devforgekit doctor`,
`./devforgekit backup`, `./devforgekit profile list`, ...) - see [CLI.md](docs/CLI.md).
Want less than everything? `./devforgekit install --profile flutter` (or
`backend`, `minimal`) installs a curated subset instead - see
[Profiles.md](docs/Profiles.md).

Every script here is safe to run more than once: nothing is reinstalled,
recopied, or restarted unless it's actually missing or different.

## Features

- **One CLI, `./devforgekit`** - `install`, `update`, `backup`, `restore`, `check`,
  `doctor`, `validate`, `inventory`, `report`, `services`, `clean`,
  `release`, `preferences`, `profile` - one command to remember instead of
  a dozen script names ([CLI.md](docs/CLI.md)).
- **Install profiles** - `--profile flutter`/`backend`/`minimal` (or the
  default `full`) install a curated Brewfile subset instead of everything;
  `--profile custom` is a blank template ([Profiles.md](docs/Profiles.md)).
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
- **Diagnostics with a health score** - `scripts/check.sh` for a fast
  health check, `scripts/doctor.sh` for deep diagnostics (including a PATH
  manager that detects and, with `--fix`, repairs missing PATH entries for
  installed tools) - both end with a 0-100% health score and a
  Ready/Needs Attention verdict.
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
DevForgeKit/
├── devforgekit                # CLI dispatcher - ./devforgekit <command>
├── bootstrap.sh               # main installer
├── Brewfile                   # Homebrew formulae, casks, VS Code/Cursor extensions, npm globals
├── mise.toml                  # pinned runtime versions (Java, Node, Python)
├── .zshrc / .gitconfig / .gitignore_global
├── .env.example               # template for local secrets (never commit .env)
├── VERSION / CHANGELOG.md / LICENSE
├── vscode/ cursor/             # settings.json, keybindings.json, extensions.txt
├── profiles/
│   ├── minimal/ flutter/ backend/ full/ custom/  # Brewfile subset + README per profile
├── scripts/
│   ├── common.sh / colors.sh   # shared library
│   ├── install.sh               # Homebrew + Brewfile (or profile) only
│   ├── restore.sh                # dotfiles + editors only
│   ├── backup.sh                  # live config -> repo, commit + push
│   ├── update.sh                   # upgrade every managed toolchain
│   ├── check.sh                     # PASS/WARNING/FAIL health check + score
│   ├── doctor.sh                     # deep diagnostics + PATH manager + score
│   ├── services.sh                    # start|stop|restart|status
│   ├── validate.sh                     # shell/JSON/YAML/Brewfile/mise/Markdown validation
│   ├── cleanup.sh                       # reclaim disk space
│   ├── report.sh                         # reports/system-report.txt
│   ├── inventory.sh                       # reports/*.md (9 files)
│   ├── preferences.sh                      # macOS UI preferences backup/restore
│   ├── profile.sh                          # list|show|use install profiles
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
git clone https://github.com/NouradinAbdurahman/DevForgeKit.git
cd DevForgeKit
chmod +x bootstrap.sh
./bootstrap.sh
```

Flags: `-y`/`--yes` (assume yes to every prompt), `--skip-services` (don't
start Postgres/MySQL/Redis), `--dry-run` (validate everything, change
nothing - what CI runs), `--profile <name>`/`--minimal`/`--full` (install
a curated subset instead of everything - see [Profiles](#profiles)).

## CLI

```bash
./devforgekit <command> [args...]
```

A single entry point over everything below - `install`, `update`,
`backup`, `restore`, `check`, `doctor`, `validate`, `inventory`, `report`,
`services`, `clean`, `release`, `preferences`, `profile`. Each command is a
plain `exec` to the matching script (`./devforgekit doctor` == `./scripts/doctor.sh`),
so both forms work identically - use whichever you prefer. Full reference
in [docs/CLI.md](docs/CLI.md).

## Profiles

```bash
./devforgekit install --profile flutter    # or backend, minimal, full (default), custom
./devforgekit profile list                  # see what's available
./devforgekit profile use flutter           # set a persistent default
```

Profiles are Brewfile subsets under `profiles/<name>/` - `flutter` and
`backend` install just what those stacks need, `minimal` is bare-essentials
CLI tooling, `custom` is a blank template, and `full` (default) is
everything in the root `Brewfile`. Dotfiles and editor
settings/extensions are always restored in full regardless of profile.
Details, including how to add your own, in
[docs/Profiles.md](docs/Profiles.md).

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
yq, and SQLite - ending in a 0-100% health score (PASS = full credit,
WARNING = half credit, FAIL = none) and a Ready/Needs Attention verdict.

## Doctor

```bash
./scripts/doctor.sh [--fix]
```

Deep diagnostics - PATH duplicates/dangling entries, a **PATH manager**
that flags installed-but-not-on-PATH tool directories (Android SDK, pnpm,
mise shims, GNU coreutils, ...) and fixes them with `--fix` (appends an
idempotent block to the live `~/.zshrc`), shell integration, broken
symlinks, permissions, Git/SSH/GitHub auth, Docker daemon state,
`brew doctor`/`mise doctor`/`flutter doctor`, service status, outdated
packages - also ending in a health score.

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

**Do I have to use `./devforgekit`, or can I keep calling scripts directly?**
Either works, permanently - `./devforgekit` is a thin dispatcher with no logic of
its own (see [docs/CLI.md](docs/CLI.md)); `./scripts/doctor.sh` and
`./devforgekit doctor` do exactly the same thing.

**What does a profile actually skip?**
Only Homebrew formulae/casks/VS Code bundle entries. Dotfiles and full
editor settings/extensions restore regardless of profile - see
[docs/Profiles.md](docs/Profiles.md) for why.

## Roadmap

Broader platform ambitions that were deliberately scoped out of the
current CLI/profiles/PATH-manager work to keep this pass verifiable rather
than shipping thin, untested scaffolding:

- **Plugin system** - pluggable `install`/`update`/`check`/`backup`/
  `restore`/`validate` hooks per tool (Docker, Postgres, Redis, Supabase,
  Terraform, cloud providers), instead of everything living in
  `Brewfile`/`common.sh`.
- **Multi-editor support** - Zed, Windsurf, Neovim, JetBrains, alongside
  the existing VS Code/Cursor restore.
- **Multi-shell support** - bash and fish, alongside the existing zsh.
- **Secrets managers** - 1Password CLI, Bitwarden CLI, macOS Keychain
  integration for `.env` population.
- **Machine migration** (`dev migrate`) - export/import the full
  environment (apps, fonts, preferences, shell, editors, databases,
  services) between two Macs in one step.
- **HTML report/dashboard** output, alongside the existing Markdown
  reports.
- **GitHub community program** - issue/PR templates, discussion
  templates, stale bot, contributor guide.
- **Config wizard** - an interactive first-run prompt (role, editor,
  languages, cloud providers) that picks/builds a profile automatically.
- Broaden CodeQL coverage as more languages get added to `templates/`.
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
