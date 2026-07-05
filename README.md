# DevForgeKit

A production-grade macOS development workstation lifecycle manager: clone
this repo on any Mac (Apple Silicon or Intel, fresh install or existing
machine) and run one command to provision the entire environment -
Homebrew packages, language runtimes, shell, Git, VS Code, Cursor, and
local services. Beyond first-run provisioning, it backs itself up,
restores itself, updates itself, diagnoses itself, inventories the
machine, backs up macOS UI preferences, ships ready-to-copy project
templates, generates complete projects for 16 stacks on demand, manages
its own releases, and provides a full-screen interactive terminal
dashboard, AI-powered development assistant, environment snapshot &
restore, benchmark engine, intelligent repair engine, package
intelligence & analytics, and a development environment graph.

**Website**: [devforgekit.dev](https://devforgekit.dev)

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
- **An interactive terminal dashboard** - run `devforgekit` with no
  arguments and the whole platform opens as a full-screen, keyboard-driven
  TUI (k9s/lazygit style): browse and install components with live
  output, run recipes with step previews, drive the project generator as
  a wizard, run diagnostics, check updates, edit configuration, search
  everything with `/` - 20 professional color themes with custom theme
  support, graceful fallback to classic `--help` on non-TTY terminals,
  and every classic command untouched
  ([TUI.md](docs/TUI.md)).
- **A Workspace Manager** - `devforgekit workspace switch <name>` moves
  git identity, SSH host identities, environment variables + encrypted
  secrets, Docker/Kubernetes/cloud-CLI context, and shell aliases/
  functions/PATH together in one command, with health verification,
  point-in-time snapshots + rollback, and portable export/import bundles
  ([WorkspaceManager.md](docs/WorkspaceManager.md)).
- **A Compatibility Engine** - `devforgekit compatibility scan/explain/
  repair/graph` validates whether installed tools actually work together
  (Flutter + Xcode, Node + your package manager, Docker Desktop vs.
  Colima), with a 5-tier score (Healthy/Warning/Critical/Unsupported),
  wired into Doctor, Recipes, Profiles, the Project Generator, and the
  Workspace Manager ([CompatibilityEngine.md](docs/CompatibilityEngine.md)).
- **An AI Development Assistant** - `devforgekit ai doctor/explain/review/
  generate/analyze/summarize/optimize/repair/planner` reasons over what
  DevForgeKit already knows about this machine (installed tools,
  compatibility, workspace, git status) through a unified provider
  abstraction over OpenAI/Anthropic/Gemini/Groq/OpenRouter/Ollama/LM
  Studio - real REST clients, never a mocked response. With no provider
  configured (the default), every command degrades to a clear, actionable
  message instead of faking one. `ai generate`/`ai planner` map onto real
  Project Generator stacks and real registry collections/recipes/
  components - never invented ones - and `ai repair` never removes a
  conflicting package without confirmation
  ([AIAssistant.md](docs/AIAssistant.md)).
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
- **A Project Generator for 16 stacks** - `devforgekit new <stack>
  [name]` (Flutter, Next.js, Express, React, React Native, Expo, NestJS,
  FastAPI, Django, Laravel, Spring Boot, ASP.NET, Go Fiber, Rust Axum,
  Tauri, Electron) generates a complete, ready-to-code project: tests,
  linting, Docker, CI, and README included, scaffolded on top of each
  stack's own official CLI where one exists
  ([ProjectGenerator.md](docs/ProjectGenerator.md)).
- **A 250-component registry** across 35 categories
  (`devforgekit component install`, `devforgekit search <term>`,
  `devforgekit collection install backend`) - languages, package
  managers, databases, containers, Kubernetes, cloud CLIs, DevOps,
  editors, fonts, terminals, browsers, AI tools, security tools,
  utilities, networking, monitoring, media, embedded, CI/CD, build
  systems, testing, package signing, code quality, documentation, API
  development, web, desktop, Apple development, Android, and reverse
  engineering, with automatic dependency resolution, an interactive
  category-grouped picker, a **Package Quality System** (license,
  homepage, stability, CPU architecture support, last-verified date, and
  live-measured install size/time - never a stored guess), and a
  per-component **Manifest Quality Score** out of 100
  (`devforgekit info <name>`, ten checks - schema validity, homepage/
  repository present or, with `--live`, actually verified reachable over
  the network, license, install/verify/uninstall tested, rollback
  available, health check, documentation)
  ([PlatformArchitecture.md](docs/PlatformArchitecture.md)).
- **50 environment profiles** (`devforgekit profile install
  fullstack/ai/cybersecurity/startup/...`) composing collections + extra
  components + suggested config defaults - plus `profile create`
  (interactive wizard), `profile export`/`import` (snapshot and reproduce
  a machine's actual installed state), `devforgekit stats`, `devforgekit
  registry stats` (duplicate-alias/orphaned-manifest detection, metadata
  completeness), and `devforgekit info <name>` (rich, human-readable
  component info with a live-computed install size).
- **8 built-in recipes** (`devforgekit recipe install
  ai-engineer/flutter-developer/devops-engineer/cybersecurity-lab/...`) -
  one-command environment workflows that go beyond a profile: the same
  collections/components resolution, plus `configure` steps
  (git/VS Code/Cursor/shell/mise dotfile restoration) and a `verify` pass
  (health-checks every installed component) - so "install + configure +
  verify" happens in a single command instead of a manual checklist.
  Also `recipe create` (interactive wizard), `recipe import <file>`, and
  `recipe search` ([docs/Recipes.md](docs/Recipes.md)).
- **A Self-Update System** - `devforgekit self-update` (alias: `upgrade`)
  updates the entire platform in one command: git pull (repo + registry +
  bundled plugins/recipes/profiles), npm install for CLI dependencies,
  config migration with a versioned migration framework, user plugin
  updates, and a changelog summary. Full rollback on any step failure.
  `--dry-run` previews without making changes.
- **An Environment Snapshot & Restore system** - `devforgekit snapshot
  create/restore/list/inspect/verify/diff/export` captures the entire
  development environment into a portable `.dfk` archive and restores it
  on another machine. Secrets are never exported; `missing-secrets.md`
  lists all required keys for the target machine.
- **A Benchmark Engine** - `devforgekit benchmark` (aliases: `bench`,
  `perf`) measures development environment performance using real
  developer workloads (CPU, memory, disk, git, Node.js, Docker, Flutter,
  Python, databases, package managers, project generation). Three
  profiles: quick (~10-20s), standard (~30-60s), full (~2-5min).
  Includes `compare`, `history`, `export`, and AI-powered `explain`.
- **An Intelligent Repair Engine** - `devforgekit repair` (aliases: `fix`,
  `heal`) is a multi-stage diagnostic and repair platform: Scan →
  Analyze → Plan → Repair → Verify. 12 scanners across all subsystems,
  dependency-aware repair ordering, safe execution with automatic
  rollback, and post-repair verification.
- **A Package Intelligence & Analytics Engine** - `devforgekit package`
  (aliases: `packages`, `pkg`) analyzes every installed development tool:
  `analyze`, `info`, `tree`, `graph`, `orphan`, `duplicates`, `unused`,
  `outdated`, `recommend` (AI-powered), `impact`, `search`, `compare`,
  `history`, `export`. Answers: What is installed? Why? Who depends on
  it? Can it be removed safely? Is it outdated? Duplicated?
- **A Development Environment Graph** - `devforgekit graph` (aliases:
  `env`, `deps`) builds a complete visual model of the developer's
  environment as an interactive dependency graph. 21 node types, 16 edge
  types, connecting every DevForgeKit subsystem. Includes `search`,
  `explain` (AI-powered), `export` (JSON/Markdown/HTML/DOT/Mermaid/
  PlantUML), `verify`, `stats`, `path`, `impact`, `conflicts`, `orphan`,
  `focus`, and `history` with graph comparison.
- **Enhanced Package Installation Status** - 17 detailed install
  statuses with responsibility classification (User/Vendor/DevForgeKit
  Registry), platform and architecture support metadata, suggested
  alternatives, and rich diagnostics in both the TUI and CLI.
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

On top of that bash core sits a Node.js Core CLI (`cli/`), a package
registry (`registry/`), and a plugin system (`plugins/`) - the platform
architecture that every future release builds on without breaking this
one. See [docs/PlatformArchitecture.md](docs/PlatformArchitecture.md) for
the complete four-layer design (Bootstrap → Core CLI → Plugins →
Components) and the full multi-release roadmap.

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
├── cli/                           # Node.js Core CLI (Layer 2 - see docs/PlatformArchitecture.md)
│   ├── bin/devforgekit.js
│   └── src/{core,lib,commands}/*.js
├── registry/                       # component registry (Layer 4) - 250 components/35 categories
│   ├── schema/ categories/ packages/ collections/ profiles/ recipes/
│   └── registry.json                  # generated - see `devforgekit registry generate`
├── plugins/                          # plugin manifests (Layer 3)
│   └── hello-world/                   # example plugin
├── docs/                                # deep-dive documentation (see below)
└── .github/
    ├── dependabot.yml
    └── workflows/                 # bootstrap, shellcheck, lint, cli, registry-smoke,
                                    # update, release, codeql, dependency-review, scorecard
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
`services`, `clean`, `release`, `preferences`, `profile`, plus the newer
`recipe`, `config`, `component`, `plugin`, `new`, and `workspace`
commands. `install`/`bootstrap` always
run `bootstrap.sh` directly; every other command is delegated to the
Node.js Core CLI under `cli/` once bootstrap has set it up, falling back
to a plain `exec` of the matching `scripts/*.sh` otherwise (`./devforgekit
doctor` == `./scripts/doctor.sh` either way) - see
[docs/PlatformArchitecture.md](docs/PlatformArchitecture.md). Full
reference in [docs/CLI.md](docs/CLI.md).

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

(Not to be confused with **environment profiles** -
`devforgekit profile install <name>` - or **recipes**, below; see
[docs/PlatformArchitecture.md](docs/PlatformArchitecture.md) section 5
for how the three relate.)

## Recipes

```bash
./devforgekit recipe list                    # 8 built-in recipes
./devforgekit recipe install ai-engineer     # install + configure + verify, one command
./devforgekit recipe create                   # interactive wizard
```

A recipe is a lighter-weight, opinionated sibling of an environment
profile: same `collections`/`components` resolution and installer, plus
`configure` steps (git/VS Code/Cursor/shell/mise dotfile restoration) and
a `verify` pass (health-checks every installed component) - so one
command replaces "install X, install Y, configure Z, verify everything."
Details, including the full built-in recipe table and how to add your
own, in [docs/Recipes.md](docs/Recipes.md).

## Project Generator

```bash
./devforgekit new --list                              # every supported stack
./devforgekit new nextjs my-app                        # TypeScript + Tailwind + shadcn/ui + Docker + CI
./devforgekit new flutter my-app --state riverpod --backend supabase
./devforgekit new express my-api --auth --prisma --swagger --docker
```

Unlike copying a static folder from `templates/`, `devforgekit new`
generates a project per stack - scaffolding with the stack's own official
CLI when one exists (`flutter create`, `create-next-app`, `django-admin`,
`dotnet new`, the Spring Initializr API, ...) and layering hand-written
files on top (auth, ORM, state management, Docker, CI, linting, tests,
README). 16 stacks are supported today. Full stack-by-stack reference in
[docs/ProjectGenerator.md](docs/ProjectGenerator.md).

## Workspace Manager

```bash
./devforgekit workspace create acme-backend --from-current --switch
./devforgekit workspace switch acme-backend
./devforgekit workspace verify
./devforgekit workspace snapshot create acme-backend -m "before upgrading node"
./devforgekit workspace rollback acme-backend <snapshotId>
./devforgekit workspace export acme-backend ./backups
```

Makes an isolated per-project environment a single switchable unit: git
identity, SSH host identities, environment variables + AES-256-GCM
encrypted secrets, Docker/Kubernetes/cloud-CLI context, and shell
aliases/functions/PATH all move together with one `workspace switch`.
Includes health verification, point-in-time snapshots with rollback (an
automatic safety snapshot first, live re-apply if the target is active),
and portable `.tar.gz` export/import (secrets never included; auto-repairs
dangling registry references on import). Also on the dashboard (`w`).
Full reference in [docs/WorkspaceManager.md](docs/WorkspaceManager.md).

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

DevForgeKit's long-term goal is to be something you *install*, the way
people say "I installed Homebrew" - a platform that gets more extensible
with each release, not just larger. The full cross-phase design lives in
[docs/PlatformArchitecture.md](docs/PlatformArchitecture.md); this is the
release-by-release summary.

- **v1.1 - Platform Core (shipped)** - the Node.js Core CLI (`cli/`), the
  command-parsing/plugin/config/diagnostics framework, the component
  registry format (`registry/`) with real manifests for the tools this
  repo already installs, and a working example plugin
  (`plugins/hello-world`). Everything below builds on this without
  requiring a breaking change to it.
- **v1.1.1 - Registry Expansion (shipped)** - the registry grew from 10 to
  **115 components across 18 categories** (languages, package managers,
  databases, containers, Kubernetes, cloud, DevOps, editors, fonts,
  browsers, AI, utilities, security, game development, design), plus **17
  curated collections** (`devforgekit collection install backend`),
  `devforgekit search`, automatic dependency-graph resolution
  (`flutter` -> `dart`/`java`/`android-studio`, resolved and installed in
  order), richer per-component metadata (homepage, license, tags,
  aliases, update commands), and a Registry Builder
  (`devforgekit registry generate`) that rebuilds `registry.json` and
  `docs/Registry.md` from the YAML sources - the artifact a future hosted
  registry would serve. Reaching the longer-term 300-500 goal is
  incremental from here: one YAML file per addition, no code changes.
- **v1.1.2 - Profiles & Configuration (shipped)** - **50 environment
  profiles** (`devforgekit profile install fullstack/ai/cybersecurity/
  startup/...`), each composing one or more collections plus extra
  components plus suggested config `settings`; `profile create`
  (interactive editor/browser/terminal/cloud/AI/languages/databases/
  containers/fonts wizard), `profile export`/`import` (snapshot and
  reproduce a machine's real installed state), `profile search`; a real
  configuration system at `~/.config/devforgekit/config.yaml`
  (editor/shell/package manager/fonts/browser/AI provider/default
  profile/update schedule/telemetry/mirrors/registry URL);
  `devforgekit stats` (installed components, disk, outdated packages,
  health score); `devforgekit registry stats` (dependency-graph summary,
  duplicate-alias and orphaned-manifest detection, metadata
  completeness); `devforgekit info <name>` (rich info with a
  live-computed install size); and search `--category`/`--tag` filters.
  10 new components (6 security-auditing tools, a design tool, an
  Angular CLI, 2 terminal emulators) and a new `terminals` category were
  added to make the security/design/frontend profiles real - 125
  components/19 categories total. The Plugin/Profile Marketplace
  Architecture (install/remove/update/publish/verify/signatures) is now
  designed in `docs/PlatformArchitecture.md`, still unbuilt.
- **v1.1.3 - Component Ecosystem + Package Quality System (shipped)** -
  the registry doubled again, **125 -> 250 components across 35
  categories** (16 new: networking, monitoring, media, embedded, CI/CD,
  build systems, testing, package signing, code quality, documentation,
  API development, web, desktop, Apple development, Android, reverse
  engineering), covering every bucket from the product brief's list
  (languages through Android). Every component now carries a **Package
  Quality System**: `documentation`, `architectures` (Intel/Apple
  Silicon/Linux), `stability` (stable/beta/deprecated), `lastVerified`
  date, and `ciVerified` (true only for the handful of packages actually
  smoke-tested live in CI). Install size and install *time* stay
  live-computed, never fabricated - `installPlan` now measures and
  reports real elapsed time per install ("docker installed in 8.2s"). A
  per-component **Manifest Quality Score** (`devforgekit info <name>`)
  gives contributors an objective 10-check/100-point standard - schema
  validity, homepage/repository present (or, with `--live`, actually
  verified reachable), license, install/verify/uninstall tested, rollback
  available, health check, documentation - and `devforgekit registry
  stats`' `qualityScore` is now the registry-wide average of that same
  score, alongside `ciVerifiedCount`. Reaching the
  longer-term 500-800 goal is incremental from here, same as always: one
  YAML file per addition, no code changes. (Per the roadmap message's own
  priority, this milestone shipped *before* the Plugin SDK/recipes/AI
  items further down this list - those remain unbuilt roadmap, not
  regressions; see the note at the end of this section.)
- **v1.2.0 - Plugin SDK (shipped)** - the full local plugin lifecycle:
  `devforgekit plugin create/test/build/package/publish/install`
  (scaffolds a `plugin.yml`/`commands/`/`hooks/`/`tests/` structure,
  regenerates its own `README.md`, and packages a signed, checksummed
  `.tar.gz` anyone can install without a PR to this repo), install
  lifecycle events (`install.beforeInstall`/`afterInstall`, so a plugin
  can react to any component install), declared plugin **dependencies**,
  and real **Ed25519 signing** (Node's built-in `crypto`) with an honest
  local trust model - your own key auto-trusted, anyone else's via
  `plugin trust <their.pub>`. What's *not* built yet: a hosted
  marketplace - `plugin install` takes a path or URL you already have,
  there is no `plugin search` against a remote index. See
  `docs/PlatformArchitecture.md` section 4.
- **v1.2.1 - Recipe Engine (shipped)** - reusable, one-command
  environment workflows: `devforgekit recipe list/show/install/create/
  import/search/publish`, 8 built-in recipes (`ai-engineer`,
  `flutter-developer`, `backend-developer`, `devops-engineer`,
  `cybersecurity-lab`, `game-developer`, `ml-engineer`,
  `embedded-engineer`) under `registry/recipes/`, validated against a new
  `recipe.schema.json`. A recipe is a lighter-weight sibling of a
  profile - it resolves the exact same `collections`/`components` through
  the same dependency-resolving installer, then layers two things a
  profile doesn't have: **`configure`** steps (`git`/`vscode`/`cursor`/
  `shell`/`mise` - cross-cutting dotfile/environment restoration, calling
  the same Layer 1 functions `scripts/restore.sh` already uses) and a
  **`verify`** pass (runs every installed component's health check and
  reports PASS/FAIL) - so `recipe install ai-engineer` really is
  "install Python/Node/Docker/Ollama, configure git/VS Code/shell, verify
  everything" in one command. See `docs/Recipes.md`.
- **v1.2.2 - Project Generator (shipped)** - `devforgekit new <stack>
  [name]` generates a complete, production-ready project - not a copy of
  a static folder, but real files assembled per stack, optionally on top
  of the stack's own official scaffolding CLI (`flutter create`,
  `create-next-app`, `django-admin`, `dotnet new`, the Spring Initializr
  API, ...) when one exists. **16 stacks**: Flutter (Clean Architecture,
  Riverpod/Bloc, Supabase/Firebase), Next.js (TypeScript, Tailwind,
  shadcn/ui, Husky), Express (JWT auth, Prisma + PostgreSQL, Swagger),
  React, React Native, Expo, NestJS, FastAPI, Django, Laravel, Spring
  Boot, ASP.NET, Go Fiber, Rust Axum, Tauri, and Electron - every one
  ships tests, linting, a Dockerfile where it makes sense, a GitHub
  Actions CI workflow, and a README, with `git init` run automatically.
  See [docs/ProjectGenerator.md](docs/ProjectGenerator.md).
- **v1.2.3 - Interactive Terminal Dashboard (shipped)** - `devforgekit`
  with no arguments opens the whole platform as a full-screen,
  keyboard-driven TUI (Ink/React, `cli/src/tui/`): 13 pages (overview
  with health/updates/disk at a glance, components with live-streamed
  installs, profiles, recipes with step previews, the project generator
  as a wizard, plugins, doctor, updates, inventory, configuration
  editing, session logs, help, about), global `/` search across every
  registry entity, 20 professional color themes (Nord, Dracula, Tokyo
  Night, Catppuccin Mocha, Gruvbox, Solarized, GitHub Dark/Light, and
  more) with custom theme loading from `~/.config/devforgekit/themes/`,
  suspend/resume handoff for terminal-owning scripts, and graceful fallback to classic
  `--help` on non-TTY terminals - all as a pure frontend over the same
  `core/` services, with every classic command untouched. See
  [docs/TUI.md](docs/TUI.md).
- **v1.2.4 - Workspace Manager (shipped)** - `devforgekit workspace`
  makes an isolated per-project environment a single switchable unit:
  git identity, SSH host identities (`~/.ssh/config` Host blocks),
  environment variables + AES-256-GCM-encrypted secrets, Docker/
  Kubernetes/cloud-CLI (AWS/GCP/Azure/Firebase/Supabase/Cloudflare/
  Vercel/Netlify) context, and shell aliases/functions/PATH move
  together with one `workspace switch <name>`. Health verification
  reusing the same PASS/WARNING/FAIL scoring `check.sh`/`doctor`
  standardize on, point-in-time snapshots with diff/compare and rollback
  (automatic safety snapshot first, live re-apply if the target is
  active), portable `.tar.gz` export/import (secrets and snapshot
  history excluded by design, auto-repairs dangling registry references
  on import), optional references into the existing profile/collection/
  recipe/component/plugin registry, and a 14th dashboard page. See
  [docs/WorkspaceManager.md](docs/WorkspaceManager.md).
- **v1.2.5 - Compatibility Engine (shipped)** - `devforgekit compatibility
  scan/check/explain/repair/graph/update/export` validates whether
  installed tools actually work together, not just whether each is
  individually installed: version-range requirements (Flutter needs Dart
  ≥3.8), cross-package conflicts, and even conflicts between two install
  *variants* of the same package (Docker Desktop vs. Colima, detected
  against real machine state since the registry only tracks one variant
  choice per package). Rules live in versioned, schema-validated
  `registry/compatibility/*.yaml` files (mirroring `registry/packages/`),
  cross-checked for integrity the same way the rest of the registry is;
  plugins can contribute their own rules via an optional `rules` field.
  Every scan produces a 5-tier score (Healthy/Warning/Critical/
  Unsupported - Critical/Unsupported always win the verdict regardless of
  the numeric score) built on the same PASS/WARNING/FAIL formula
  `check.sh`/`doctor`/`workspace verify` already share. Wired into Doctor,
  Recipes, Profiles (pre-install checks + a displayed score), the Project
  Generator (opt-in per stack), the Workspace Manager (`workspace
  compatibility scan/repair/history`, its first real workspace-schema
  migration, v1→v2), and a 15th dashboard page. A repair plan installs
  missing requirements and runs recommended upgrades automatically, but
  never removes a conflicting package without confirmation. AI-assisted
  recommendations are a reserved, documented interface only - see
  [docs/CompatibilityEngine.md](docs/CompatibilityEngine.md).
- **v1.3.0 - AI Development Assistant (shipped)** - `devforgekit ai` is the
  intelligence layer over everything above: a unified `AIProvider`
  interface (`chat`/`stream`/`embeddings`/`listModels`/`checkHealth`)
  backing real REST clients for OpenAI, Anthropic, Gemini, Groq,
  OpenRouter, Ollama, and LM Studio (four of the seven share one real
  implementation - the OpenAI-compatible `/chat/completions` wire format
  - the other three each have a genuinely different shape, including two
  distinct SSE dialects and one NDJSON streaming format). A Context Engine
  aggregates what DevForgeKit already knows (installed components,
  compatibility score, active workspace, git status, config) with zero
  new data collection; a 10-domain Prompt Library layers in real,
  ecosystem-specific guidance; a capped local Memory log records
  structured events (never chat transcripts, per design). `ai doctor`
  turns a raw scan into a plain-language summary/reason/fix/estimated-
  time/risk explanation; `ai generate` maps a natural-language description
  onto one of the Project Generator's real 16 stacks and scaffolds through
  the exact same `runProjectGenerator` `devforgekit new` uses; `ai
  planner` maps a goal onto real registry collections/recipes/components,
  dropping (never acting on) any name a model invents; `ai repair` narrates
  a compatibility repair plan and then executes it through the same
  confirmation-gated `executeRepairPlan` `compatibility repair` already
  uses. With no provider configured (the default), every command degrades
  to a clear, actionable message rather than crashing or fabricating a
  response - verified by dedicated tests for that path on every command,
  and by fake-`fetch`-injected unit tests for every provider client (no
  real API keys exist in this environment to test cloud providers live
  against). A 16th dashboard page (`e`) offers request/response chat. See
  `docs/AIAssistant.md`, `docs/ProviderAPI.md`, `docs/ContextEngine.md`,
  `docs/MemorySystem.md`, and `docs/PromptLibrary.md`.
- **v1.3.1 - Self-Update System (shipped)** - `devforgekit self-update`
  (alias: `upgrade`) updates the entire platform in one command: git pull,
  npm install, config migration, plugin updates, and changelog summary.
  Full rollback on failure. `--dry-run` supported.
- **v1.3.2 - Environment Snapshot & Restore (shipped)** - `devforgekit
  snapshot create/restore/list/inspect/verify/diff/export` captures the
  entire development environment into a portable `.dfk` archive and
  restores it on another machine. Secrets never exported.
- **v1.3.3 - Benchmark Engine (shipped)** - `devforgekit benchmark`
  measures development environment performance using real developer
  workloads. Three profiles (quick/standard/full), 12 categories, scoring,
  comparison, history, and AI-powered explain.
- **v1.3.4 - Intelligent Repair Engine (shipped)** - `devforgekit repair`
  is a multi-stage diagnostic and repair platform: Scan → Analyze → Plan
  → Repair → Verify. 12 scanners, dependency-aware repair ordering,
  automatic rollback, post-repair verification.
- **v1.3.5 - Package Intelligence & Analytics (shipped)** - `devforgekit
  package` analyzes every installed development tool: `analyze`, `info`,
  `tree`, `graph`, `orphan`, `duplicates`, `unused`, `outdated`,
  `recommend`, `impact`, `search`, `compare`, `history`, `export`.
- **v1.3.6 - Development Environment Graph (shipped)** - `devforgekit
  graph` builds a complete visual model of the developer's environment as
  an interactive dependency graph. 21 node types, 16 edge types, `search`,
  `explain`, `export`, `verify`, `stats`, `path`, `impact`, `conflicts`,
  `orphan`, `focus`, `history` with graph comparison.
- **v1.3.7 - Enhanced Package Installation Status (shipped)** - 17
  detailed install statuses with responsibility classification
  (User/Vendor/DevForgeKit Registry), platform and architecture support
  metadata, suggested alternatives, rich diagnostics in TUI and CLI,
  enhanced registry doctor with quality score.
- **v2.0 - Cloud Platform** - accounts, cloud sync (remote profiles/
  backups, team configuration, encrypted secrets), a plugin/registry CDN,
  cross-platform bootstrap (Ubuntu, Debian, Fedora, Arch, Windows/WSL,
  Windows/Linux support broadly), a web dashboard and public API, a GUI
  dashboard that is purely a client of the CLI's `--json` output (no
  duplicated logic), and team/enterprise management. The DEV Graph
  becomes the shared data model for cloud sync.
- **v2.x - Community** - a docs/marketplace site at devforgekit.dev,
  an Extension SDK (`create-devforgekit-plugin`), community-contributed
  profiles/templates, and the GitHub community program (issue/PR/
  discussion templates, contributor guide).

**Three roadmap items are already shipped, not missing** - worth noting
so they aren't re-proposed later: a dependency resolver exists today
(`resolveInstallOrder`/`installPlan`, v1.1.1 - `flutter` already resolves
`dart`/`java`/`android-studio` automatically); an interactive installer
with arrow-key/checkbox selection exists today (`component install`'s
category-grouped picker, v1.1.1); and a configuration wizard asking
editor/terminal/shell/git/AI provider/fonts/browser exists today
(`devforgekit profile create`, v1.1.2) - it asks exactly that question
set already.

**On the much larger v1.2.0-v2.0 roadmap message** (Recipe Engine,
Template Marketplace, Interactive TUI, Configuration Manager, Workspace
Manager, AI Assistant, Project Generator, Self Update, Benchmarking,
Analytics, then v2.0's full cloud platform): that message's own closing
recommendation was to build v1.2.0 (Plugin SDK) next, which shipped in a
prior round; a later message then prioritized the **Recipe Engine
(v1.2.1)** as the next highest-priority item, which a following round
built in full (see v1.2.1 above); the **Project Generator (v1.2.2)**
above is that same list's "Project Generator" item, also now shipped in
full rather than left as the v1.3 stub originally proposed; the
**Interactive Terminal Dashboard (v1.2.3)** above is that same list's
"Interactive TUI" item, also now shipped in full; and the **Workspace
Manager (v1.2.4)** above is that same list's "Workspace Manager" item,
also now shipped in full. Everything else on that list stays unbuilt
roadmap - most of v2.0 specifically needs real infrastructure (hosted
accounts, a marketplace backend, a separate GUI codebase, actual
Windows/Linux test environments) that a single local session can't stand
up honestly, so it's documented intent, not a claim of working code.

**A later roadmap message** named the **Compatibility Engine (v1.2.5)**
above as the next foundation after the Workspace Manager - shipped in
full in that round - and proposed **v1.3.0 - AI Doctor & Intelligent
Repair** as the phase after it. **The AI Development Assistant (v1.3.0)**
above is that same phase, shipped under a broader name than that
message's own "AI Doctor" framing once it became clear the same context
engine/provider abstraction naturally covered explain/review/generate/
analyze/summarize/optimize/repair/planner too, not just doctor - `ai
doctor` itself is still exactly that message's "AI Doctor" worked example.
A still-later message, written after the Compatibility Engine shipped,
proposed the phases after *it* as **v1.3.1 - Marketplace**, **v1.3.2 -
Discover Hub**, **v1.3.3 - Benchmark Suite**, **v1.3.4 - Telemetry &
Analytics**, **v1.4 - Enterprise**, and **v2.0 - Cloud Platform** - the
same "marketplace / benchmarking / telemetry / enterprise / cloud"
territory the **v1.2.6+ Ecosystem**/**v1.3 Developer Toolbox**/**v1.4
Telemetry Dashboard**/**v2.0 Cloud Platform** phases below already
describe under different version labels from an even earlier message -
all describe the same unbuilt work, not multiple roadmaps to reconcile in
code.

Smaller items folded into the phases above rather than tracked
separately: multi-editor **installation** (Zed, Windsurf, Neovim,
JetBrains Toolbox - already installable today via `devforgekit component
install`; full settings/keybindings *restore* support alongside the
existing VS Code/Cursor sync is still v1.3), multi-shell support (bash,
fish - v1.3), secrets managers (1Password CLI, Bitwarden CLI, Keychain -
v2.0's encrypted secrets), machine migration (`dev migrate` - v2.0's
cloud sync), an HTML report/dashboard (v2.0's GUI). The interactive
"config wizard" idea shipped in two steps: v1.1.1's category-grouped
`component install` picker, then v1.1.2's full `devforgekit profile
create` wizard (editor/browser/terminal/cloud/AI/languages/databases/
containers/fonts) - both now real.

Ongoing, not tied to a specific phase: broadening CodeQL coverage as more
languages get added to `templates/`/`cli/`, and revisiting whether
Dependabot or Renovate should be the sole default once real-world PR
volume from both is observed.

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
