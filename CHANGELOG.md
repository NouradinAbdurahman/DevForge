# Changelog

All notable changes to this repository are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.3.7] - 2025-07-06

### Added

- **Enhanced Package Installation Status** - a complete redesign of the
  package installation status system, replacing generic "install failed"
  messages with a rich, actionable status model.
  - **17 detailed install statuses** (up from 9): `verified`, `installed`,
    `update-available`, `manual-installation`, `authentication-required`,
    `license-required`, `missing-dependency`, `network-error`, `timeout`,
    `missing-package-manager`, `unsupported-platform`,
    `unsupported-architecture`, `deprecated`, `broken-registry-metadata`,
    `broken-download`, `removed-by-vendor`, `untested` - each with an icon,
    human-readable label, description, and responsibility classification.
    Legacy status aliases preserved for backward compatibility.
  - **Responsibility classification** (`RESPONSIBILITY` enum): `User`,
    `Vendor`, `DevForgeKit Registry`, `None` - every diagnosis now answers
    "Whose fault is this?" so users know whether to fix it themselves, wait
    for a vendor, or report a registry issue.
  - **`STATUS_META`** - a complete metadata table mapping every status to
    icon, label, description, responsibility, `canDevForgeKitFix`, and
    `canUserFix` flags.
  - **Platform detection** - `detectPlatform()` (async) and
    `detectPlatformSync()` detect current OS, CPU architecture, and Node
    platform. `checkPlatformSupport()` and `checkArchitectureSupport()`
    validate a package's declared platform/architecture support against the
    current machine, returning `{ supported, reason, currentPlatform }`.
  - **Enhanced `diagnoseFailure`** - every diagnosis now returns
    `responsibility`, `canDevForgeKitFix`, and `canUserFix` alongside the
    existing `reason`, `message`, `suggestedFix`, and `category`.
  - **`getPackageDiagnostics()`** - a full diagnostics object for a package:
    status (with icon/label/description), responsibility, platform support,
    architecture support, "Why can't this be installed?" section
    (reason, canDevForgeKitFix, canUserFix, suggestedFix, alternatives,
    documentation), verification history, and last-verified date.
  - **`formatInstallFailure()`** - rich multi-line CLI output replacing
    generic "Install failed." with structured report: package, status,
    reason, responsibility, canDevForgeKitFix/canUserFix, suggested fix,
    alternatives, documentation, platform/architecture issues, exit code.
  - **Enhanced `registryDoctor`** - new checks: missing platform metadata,
    missing architecture metadata, missing documentation URL, missing
    category, deprecated without replacement, broken dependencies
    (references unknown packages). New `qualityScore` in summary
    (percentage of packages without errors).
  - **Enhanced `buildVerificationSummary`** - tracks all 17 statuses
    individually plus `reliability` score (verified + installed +
    update-available as fraction of total).
  - **TUI ComponentsPage** - colored status badges using `STATUS_META`,
    responsibility display (User/Vendor/DevForgeKit with color coding),
    platform support panel (✓/✗ with supported platforms), architecture
    support panel, "Why can't this be installed?" section with
    canDevForgeKitFix/canUserFix, and alternatives display.
  - **CLI `info` command** - full diagnostics output: status with icon,
    responsibility, platform support, architecture support, why section,
    verification history, registry health.
  - **CLI `registry verify`** - updated output with all 17 status counts
    and overall reliability percentage.
  - **CLI `registry doctor`** - updated output with quality score.
  - **`installRunner`** - rich failure output using
    `formatInstallFailure()` instead of generic "failed" message.
  - New tests: 21 new tests covering responsibility, STATUS_META coverage,
    platform detection, platform/architecture support, mapFailureToStatus,
    getPackageDiagnostics, formatInstallFailure, registryDoctor quality
    score, missing platform metadata, deprecated without replacement,
    broken dependencies. Total: 724 tests (up from 622).
  - Fixed eslint errors: added `performance` and `global` to eslint
    globals, fixed regex-spaces lint error in snapshot test.

## [1.3.6] - 2025-07-05

### Added

- **Development Environment Graph (DEV Graph)** (`devforgekit graph`,
  aliases: `env`, `deps`) - a complete visual model of the developer's
  environment as an interactive dependency graph. Unlike traditional
  package trees, the DEV Graph connects every DevForgeKit subsystem into
  one unified graph. It becomes the single source of truth for environment
  relationships and the shared data model for future cloud sync, team
  analytics, and multi-machine management.
  - `graph open` (default) - builds and displays the environment graph
  - `graph search [query]` - searches nodes by name, type, description,
    tag, or category. Supports filters: installed, broken, unused,
    duplicate, large, recent, critical, outdated, workspace, recipe,
    plugin, profile
  - `graph explain <name>` - AI-powered explanation of a node: why
    installed, what depends on it, removal impact, known conflicts
  - `graph export [format]` - JSON, Markdown, HTML, GraphViz DOT, Mermaid,
    ASCII tree, PlantUML
  - `graph verify` - verifies graph integrity: missing nodes, cycles,
    conflicts, orphans
  - `graph stats` - total nodes, edges, average/max depth, nodes by type,
    edges by type, most depended-upon, orphans, conflicts, cycles
  - `graph path <from> <to>` - finds shortest path between two nodes
  - `graph impact <name>` - shows everything affected by removing a node,
    categorized by type (packages, workspaces, recipes, profiles, plugins)
  - `graph conflicts` - shows all conflict edges with messages
  - `graph orphan` - shows nodes with no connections
  - `graph focus <name>` - extracts a subgraph around a single node
  - `graph history` - lists past graph snapshots, with --compare for
    graph evolution tracking (nodes added/removed, edges changed)
  - **Node types** (21): package, framework, runtime, language, SDK, CLI,
    plugin, recipe, profile, workspace, collection, database, service,
    package-manager, theme, configuration, benchmark, snapshot, repair,
    compatibility-rule, AI provider
  - **Edge types** (16): installed-by, depends-on, required-by, uses,
    provides, conflicts-with, updates, repairs, benchmarks, configured-by,
    created-by, belongs-to, exports, imports, compatible-with,
    incompatible-with
  - **Graph builder**: collects nodes from registry packages, profiles,
    recipes, collections, workspaces, plugins, configuration, themes,
    compatibility conflicts, snapshots, benchmarks, and repair history.
    Builds adjacency maps, calculates depth, detects cycles.
  - **Impact analysis**: BFS reverse traversal to find all nodes affected
    by removing a target node, categorized by type
  - **Path analysis**: BFS shortest path between any two nodes
  - **Graph comparison**: diffs two graph snapshots showing added/removed
    nodes and edge changes
  - **Verification**: checks for missing edge targets, cycles, conflicts,
    orphans
  - **History**: graph snapshots saved to `~/.devforgekit/dev-graph/`
  - Reuses: registry (loadPackages, loadProfiles, loadRecipes,
    loadCollections), compatibility/graph.js (buildDependencyGraph,
    detectCycles, detectDuplicateTools), compatibility/engine.js
    (scanCompatibility), installer.js (validate), shell.js,
    workspace/store.js (listWorkspaces), plugins.js (discoverPlugins),
    health.js (scoreResults), config.js (loadConfig), tui/theme.js
    (listThemes), ai/providers + ai/prompts/library.js. No duplicated logic.
  - New modules: `cli/src/core/devGraph.js` (engine),
    `cli/src/commands/graph.js` (command). 60 new tests in
    `cli/test/devGraph.test.js`.

## [1.3.5] - 2025-07-05

### Added

- **Package Intelligence & Analytics Engine** (`devforgekit package`,
  aliases: `packages`, `pkg`) - a complete intelligence layer that analyzes
  every installed development tool, library, runtime, service, package
  manager, CLI, plugin, and framework on the user's machine. Not just a
  package list - a full analytics platform answering: What is installed?
  Why? Who depends on it? How much space? When was it last used? Can it be
  removed safely? Is it outdated? Duplicated?
  - `package analyze` - scans all registry packages, builds complete
    metadata profiles (version, size, dependencies, reverse deps, workspace
    usage, recipe usage, profile usage, collection usage, plugin usage,
    compatibility score, health status, last used, times executed, license,
    homepage, repository, maintainer, tags, stability). Caches results for
    incremental analysis.
  - `package info <name>` - shows complete profile for a single package
  - `package tree [name]` - renders a dependency tree (uses registry's
    buildDependencyGraph)
  - `package graph [name]` - shows dependency graph with depth, reverse
    deps, cycles, and missing deps. Supports text, DOT, and Mermaid formats
  - `package orphan` - detects packages with no reverse deps, no workspace/
    recipe/profile/collection/plugin usage. Never removes automatically.
  - `package duplicates` - detects duplicate runtimes (multiple Node,
    Python, Java, Docker, package managers) and registry-level duplicate
    tool claims
  - `package unused` - alias for orphan with usage-focused display
  - `package outdated` - detects packages with newer versions available
    (via brew outdated, mise outdated)
  - `package recommend` - AI-powered recommendations for unused packages,
    duplicates, alternatives, and missing tools. Uses measured data only.
  - `package impact <name>` - shows disk usage, dependency count, reverse
    dependency count, workspace/recipe/profile usage, compatibility score,
    health status, and estimated removal impact with safety assessment
  - `package search [query]` - searches by name, tag, description, category,
    workspace, recipe, or profile. Supports filters: installed, outdated,
    unused, duplicated, broken, large, small, most-used, least-used
  - `package compare <old> <new>` - compares two analysis files showing
    added, removed, updated, and unchanged packages
  - `package history` - lists past analysis records from
    `~/.devforgekit/package-intel/`
  - `package export [format]` - exports to JSON, Markdown, HTML, CSV,
    GraphViz DOT, and Mermaid
  - **Dependency graph**: forward/reverse dependencies, circular dependency
    detection, dependency depth calculation. Reuses compatibility/graph.js.
  - **Duplicate detection**: runtime duplicates (JS runtimes, Python
    installations, Java, container runtimes, version managers, package
    managers) + registry-level duplicate tool claims
  - **Orphan detection**: packages with no reverse deps, no workspace/recipe/
    profile/collection/plugin usage, no recent execution
  - **Caching**: results cached in `~/.devforgekit/package-intel/cache.json`,
    incremental rescan only for changed packages
  - Reuses: registry (loadPackages, loadProfiles, loadRecipes,
    loadCollections), compatibility/graph.js (buildDependencyGraph,
    detectCycles, detectDuplicateTools), compatibility/engine.js
    (scanCompatibility), installer.js (validate), shell.js, workspace/store.js
    (listWorkspaces), plugins.js (discoverPlugins), health.js (scoreResults),
    ai/providers + ai/prompts/library.js. No duplicated logic.
  - New modules: `cli/src/core/packageIntel.js` (engine),
    `cli/src/commands/package.js` (command). 44 new tests in
    `cli/test/package.test.js`.

## [1.3.4] - 2025-07-05

### Added

- **Intelligent Repair Engine** (`devforgekit repair`, aliases: `fix`, `heal`) -
  a multi-stage diagnostic and repair platform: Scan → Analyze → Plan →
  Repair → Verify. Not just another doctor command - a comprehensive repair
  system that detects problems across every DevForgeKit subsystem, generates
  an ordered repair plan with dependency awareness, safely executes repairs
  with user confirmation and automatic rollback, and verifies results.
  - `repair run` (default) - full pipeline: scan, plan, create rollback
    snapshot, execute repairs, verify, optional benchmark comparison
  - `repair scan` - runs 12 scanners across all subsystems: compatibility
    engine, PATH issues, broken symlinks, Docker daemon, disk space, Git
    configuration, workspace validation, plugin validation, configuration
    validation, Homebrew health, SSH keys, orphaned caches
  - `repair plan` - generates an ordered repair plan with dependency-aware
    topological sort, estimated time, and restart detection
  - `repair explain` - AI-powered root cause analysis (requires AI provider)
  - `repair verify` - post-repair verification: compatibility scan, health
    score, workspace validation, plugin validation, config validation,
    optional benchmark
  - `repair rollback <snapshotId>` - restores pre-repair state via Snapshot
    Engine
  - `repair history` - lists all past repair records from
    `~/.devforgekit/repairs/`
  - `repair export <id>` - exports to JSON, Markdown, HTML, or CSV
  - `repair delete <id>` - removes a repair record
  - `repair clean` - deletes all repair history
  - **Issue classification**: each issue has ID, severity (FATAL/CRITICAL/
    WARNING/INFO), category, subsystem, confidence, description, impact,
    recommended fix, estimated repair time, requires restart, rollback
    available
  - **Dependency solver**: repairs are topologically sorted by dependencies
    (e.g. PATH → Node → pnpm → Project Generator)
  - **Safe repair**: every repair requires user confirmation. Automatic
    rollback snapshot created before repairs via Snapshot Engine.
  - **Benchmark integration**: optional before/after benchmark comparison
  - **Compatibility integration**: post-repair compatibility scan; if
    regression detected, rollback is available
  - **Live progress**: `onProgress` callback for real-time status
  - Reuses: compatibility engine + repair, installer, shell, registry,
    snapshot engine, benchmark engine, health scoring, AI providers,
    config, workspace store, plugins, prompts. No duplicated logic.
  - New modules: `cli/src/core/repair.js` (engine),
    `cli/src/commands/repair.js` (command). 28 new tests in
    `cli/test/repair.test.js`.

## [1.3.3] - 2025-07-05

### Added

- **Benchmark Engine** (`devforgekit benchmark`, aliases: `bench`, `perf`) -
  measures development environment performance using real developer
  workloads, not synthetic CPU benchmarks. Answers "Is my dev environment
  healthy, balanced, and performing as expected?"
  - Three profiles:
    - `benchmark quick` (~10-20s) - CPU, memory, disk, git, node, shell
    - `benchmark standard` (~30-60s) - quick + docker, flutter, python,
      databases, package managers
    - `benchmark full` (~2-5min) - everything including project generation
  - 12 benchmark categories with real workload measurements:
    - **CPU**: compression, decompression, JSON parsing, object creation
    - **Memory**: allocation, large arrays, GC
    - **Disk**: sequential read/write, random access, small files
    - **Git**: init, add, commit, status, branch, diff
    - **Node.js**: startup, module load
    - **Terminal**: shell startup, prompt
    - **Docker**: daemon, container start, image inspect
    - **Flutter**: doctor, pub get
    - **Python**: startup, venv, pip install
    - **Databases**: PostgreSQL, MySQL, Redis ping
    - **Package Managers**: brew, npm, pnpm, bun
    - **Project Generation**: Express, FastAPI, Next.js, Flutter
  - Scoring: 0-100 per category, overall average. Grades A+/A/B/C/D/F.
  - `benchmark compare [old] [new]` - compares two results showing
    improvements, regressions, and percentage changes. Defaults to latest
    two.
  - `benchmark history` - lists all past results from
    `~/.devforgekit/benchmarks/`
  - `benchmark export <id>` - exports to JSON, Markdown, HTML, or CSV
  - `benchmark delete <id>` - removes a result
  - `benchmark explain [id]` - AI-powered analysis of slow categories,
    bottlenecks, and recommendations (requires AI provider)
  - **Safety**: all benchmarks run in isolated temp directories, cleaned up
    automatically. User projects are never touched.
  - **Live progress**: `onProgress` callback for real-time status updates.
  - **Compatibility integration**: known compatibility issues are included
    in benchmark results.
  - Reuses: shell.js, compatibility engine, registry, installer, AI
    providers, project generator, health scoring. No duplicated logic.
  - New modules: `cli/src/core/benchmark.js` (engine),
    `cli/src/commands/benchmark.js` (command). 28 new tests in
    `cli/test/benchmark.test.js`.

## [1.3.2] - 2025-07-05

### Added

- **Environment Snapshot & Restore** (`devforgekit snapshot`) - a complete
  environment portability system that captures the user's entire development
  environment into a portable `.dfk` archive and restores it on another
  machine. Not a backup utility - an environment reproduction system.
  - `snapshot create` - captures machine info, installed packages, profiles,
    recipes, plugins, workspaces, themes, configuration, inventory reports,
    and health/compatibility scores into a tar.gz archive with SHA256
    checksums. Supports `--compression fast|normal|max`, `--output <dir>`,
    `--skip-inventory`.
  - `snapshot restore <archive>` - restores config, workspaces, profiles,
    recipes, themes, and installs packages. Runs compatibility scan and
    post-restore validation. Backs up current config before overwriting.
    Supports `--skip-packages`, `--skip-workspaces`, `--skip-config`,
    `--skip-compatibility`, `--force`.
  - `snapshot list` - lists all snapshots in `~/.devforgekit/snapshots/`
    with ID, machine, creation date, and size.
  - `snapshot inspect <archive>` - displays detailed metadata including
    machine info, components, workspaces, themes, health/compatibility
    scores, and missing secrets.
  - `snapshot verify <archive>` - validates archive integrity, checksums,
    schema version, platform compatibility, and required directories.
  - `snapshot diff <old> <new>` - compares two snapshots showing
    added/removed packages, profiles, recipes, plugins, workspaces, config
    changes, and health/compatibility score deltas.
  - `snapshot export <id> <destDir>` - copies a snapshot to another
    directory.
  - `snapshot delete <id>` - removes a snapshot.
  - `snapshot explain <archive>` - AI-powered explanation of snapshot
    contents, potential issues, and migration advice (requires AI provider).
  - **Secrets are never exported** - `missing-secrets.md` lists all secret
    key references (API keys, workspace secrets) for the user to provide
    on the target machine.
  - Reuses every existing DevForgeKit subsystem: registry, workspace
    manager (bundle export/import), config, plugins, themes, compatibility
    engine, installer, health scoring, AI providers. No duplicated logic.
  - New modules: `cli/src/core/snapshot.js` (engine),
    `cli/src/commands/snapshot.js` (command). 28 new tests in
    `cli/test/snapshot.test.js`.

## [1.3.1] - 2025-07-05

### Added

- **Self-Update System** (`devforgekit self-update`) - one command
  updates the entire DevForgeKit platform: git pull (repo + registry +
  bundled plugins/recipes/profiles), npm install for CLI dependencies,
  config migration with a versioned migration framework, user plugin
  updates (git pull any git-based plugins under ~/.devforgekit/plugins),
  and a changelog summary showing what changed between versions.
  Automatic config backup before any changes, with full rollback (git
  reset + config restore) on any step failure. `--dry-run` previews the
  update without making changes; `--skip-plugins` and `--skip-npm`
  skip individual steps. Alias: `devforgekit upgrade`. New module:
  `cli/src/core/self-update.js` (engine), `cli/src/commands/self-update.js`
  (command). 13 new tests in `cli/test/self-update.test.js`.

### Changed

- **Version alignment** - VERSION file and cli/package.json both now
  read 1.3.1, resolving the pre-existing version drift.

## [1.3.0] - 2025-06-20

### Added

- **Real device info on the Dashboard page** - a new "Device" panel
  shows the actual OS name/version/build, hardware model, chip, and
  installed memory; the "Machine" panel gains real whole-device
  storage (used/total/percent, from the root volume - distinct from
  the existing per-`$HOME` free-space check) and a live macOS software
  update check. Every value is a real, live probe against this
  machine - `sw_vers`, `system_profiler SPHardwareDataType`, `sysctl
  -n hw.memsize`, `df -Pk /`, `uptime`, and `softwareupdate -l` (the
  same commands/fields `scripts/inventory.sh`'s system.md report
  already uses) - never a hardcoded or guessed value; anything that
  can't be determined honestly shows "checking..." or a real error
  ("not checked (timed out)") instead of a fabricated verdict. The
  software update check runs separately from the other (fast,
  offline) device probes since it contacts Apple's servers and can
  take up to ~20s - it has its own timeout that actually kills the
  underlying process rather than merely giving up on it, so a slow
  check can never block the rest of the Dashboard from loading or
  leave an orphaned process running. New `commands/stats.js`
  exports: `osInfo`, `hardwareInfo`, `memoryGb`, `diskUsage`,
  `uptimeString`, `softwareUpdateStatus`.

### Changed

- **Nav sidebar shortcut badges** - each page in the left menu now
  shows its keyboard shortcut as a bracketed badge up front (`[1]
  Dashboard`, `[w] Workspaces`, `[c] Components`, ...) in its own
  accent color, instead of a bare trailing character that was easy to
  miss. `navWidth()`'s mid-size tier grew from 26 to 28 columns so the
  longest label ("Project Generator") still fits in full alongside the
  new badge.
- **Recipes page list redesign** - each recipe now renders as a
  two-line card (icon + bold name, then the description indented
  underneath) instead of cramming both onto one line, which wrapped
  unpredictably against the detail panel's width and read as a jumble.
  The detail panel's title also carries the recipe's icon now
  (`Recipe: 🤖 ai-engineer`). Profiles page gets the same two-line
  card treatment (bold name + indented description, no icon).
- **Colored key hints across every page** - every page's own
  bottom-of-panel "what can I press here" line (Components, Config,
  Doctor, Generator, Inventory, Logs, Profiles, Recipes, Search,
  Updates, Workspaces, Plugins, Compatibility) now uses the same
  treatment the status bar's global hints do: a bold accent key plus a
  muted description, separated by a dim ` · `, instead of one flat
  muted-color sentence. Extracted into one shared component,
  `components/ui.js`'s `KeyHints({ hints, theme })`, so every page's
  hints stay visually consistent and `StatusBar.js` now reuses it
  instead of keeping its own copy of the same rendering logic.

### Fixed

- **Status bar key hints** - the bottom status bar's global-key hint
  row now shows `Esc back`, which had no visible hint anywhere on
  screen before (only documented on the Help page); every hint reads
  as a bold accent key plus a muted description, separated by a dim
  ` · ` instead of raw double-spaces, so the row scans as distinct
  chunks instead of one dense run-on line. Fixing this surfaced a real
  Ink rendering bug: building a colored, multi-segment line as a
  `<Box>` of sibling `<Text>` children causes Ink to give each child
  its own flex-shrink share of the available width, truncating
  mid-word ("Tab focus" → "Ta focu") the instant the row doesn't fit -
  instead of wrapping at word boundaries the way a single `<Text>`
  does. Fixed by nesting `<Text>` inside `<Text>` (which Ink treats as
  one reflowable run) everywhere this pattern appeared:
  `components/StatusBar.js` (the hint row and the page/theme text),
  `components/DashboardHeader.js`'s `StatsLine`, `components/ui.js`'s
  `KeyValue` (used by nearly every page's detail panels), and the
  Global search page's and Logs page's per-row rendering.

### Changed (Dashboard polish)

- **Persistent dashboard header (v1.4.1)** - the DevForgeKit ASCII
  logo is no longer a startup splash that disappears; the same logo/
  wordmark/tagline the boot animation draws becomes a permanent banner
  at the top of every dashboard page
  (`cli/src/tui/components/DashboardHeader.js`), in the style of
  btop/fastfetch. The logo is a fixed, hand-supplied 8-row ASCII art
  block spelling out the complete wordmark rather than a 3-letter
  abbreviation, and is left-aligned at a fixed column
  (`LOGO_LEFT_MARGIN`) rather than centered - it starts at the exact
  same position in the startup animation and the persistent header, so
  there's no jump at handoff. The logo always renders in `theme.accent`
  in both places too, fixing a color mismatch where the header
  briefly used a different token than the animation. Always
  top-aligned, never vertically centered, never moves during resize.
  A new "Version x.y.z • N Components • N Profiles • N Recipes" line
  (built from real registry stats) renders as distinct colored
  segments - muted labels, bold accent numbers, dim separators -
  instead of one flat muted string. Responsive: collapses from the
  full banner down to a compact logo-only form, then to a text-only
  wordmark+tagline on smaller terminals - deliberately tuned so this
  never happens until well past every page's own minimum size, so no
  existing layout gets squeezed (`layout/responsive.js`'s
  `headerMode`/`headerHeight`). The startup animation's final step no
  longer clears the screen before handing off, and its tagline now
  matches the persistent header's exactly (`SESSION_TAGLINE`, picked
  once per process). Replaces the old always-visible info-strip
  `Header` component; its health-score/workspace/profile/registry-
  count fields remain visible on the Dashboard page's own panels
  (`Workspace` was added there to close the one real gap). See
  `docs/TUI.md`'s "Persistent dashboard header" section.

- **Default dark theme redesign (v1.4.0)** - the dashboard's default
  `dark` theme now carries a real, high-contrast, GitHub Dark-inspired
  hex palette (`cli/src/tui/themes/builtin.js`) instead of its original
  named-ANSI/`undefined` placeholders, bringing it in line with every
  other built-in theme. Fixes the one real accessibility bug in the old
  palette: selected rows used to pair a cyan background with black
  text; every selected element now renders white text on a solid blue
  background, verified at >= 4.5:1 (WCAG AA) via the existing
  `checkContrast()`/`contrastRatio()` utilities, along with every other
  text/background pair the theme defines. `Panel` and the nav sidebar
  now switch to the theme's `borderActive` color the instant they hold
  keyboard focus (13 dashboard pages updated to report their focused
  panel); `ProgressBar` renders its filled/remaining segments in two
  actually-different colors instead of one color at two glyph weights;
  the Global search page highlights the matched substring of a result
  in `searchHighlight` (never on a selected/blue row, to avoid a
  color-on-color contrast violation); focused text inputs show an
  accent-colored cursor. Adds one new optional token, `panelTitle`
  (falls back to `accent` if a theme doesn't define one), so `dark`'s
  panel titles can read as bright cyan, distinct from its blue
  accent/border-focus color. Note: theme tokens for panel/header/
  sidebar *backgrounds* remain defined but unpainted - Ink's `<Box>`
  has no `backgroundColor` support (only `<Text>` does), a real
  upstream limitation, not an oversight. See `docs/TUI.md`.

### Added (Prior releases)

- **Animated startup sequence (v1.2.6)** - launching the dashboard
  (`devforgekit` with no arguments, or `dashboard`/`ui`) now plays a
  sub-second boot animation before the first frame: a hand-built
  "DFK" monogram draws itself, the wordmark and a rotating tagline
  fade in, then a real boot checklist (`Loading registry`, `Loading
  plugins`, `Loading profiles`, `Loading recipes`, `Loading
  compatibility engine`, `Initializing workspace manager`, `Preparing
  dashboard`) checks off each line the instant its actual
  initialization call resolves - never a fake timer, and instantly
  checked if the work already finished. It never appears for suspend/
  resume or for any classic command. New `cli/src/tui/startup/`
  module (`startupAnimation.js`/`asciiLogo.js`/`particleRenderer.js`/
  `loadingRenderer.js`/`transition.js`) is isolated from `App.js` -
  the dashboard knows nothing about it and vice versa. Configurable via
  `startupAnimation`/`startupAnimationSpeed` (`normal`/`fast`/`off`) in
  `~/.config/devforgekit/config.yaml` (editable live from the
  Configuration page) and `DEVFORGEKIT_NO_ANIMATION=1`; automatically
  skipped alongside the dashboard itself for non-TTY/CI/`TERM=dumb`.
  See `docs/TUI.md`.
- **AI Development Assistant (v1.3.0)** - `devforgekit ai` is the
  intelligence layer over every existing subsystem: a unified
  `AIProvider` interface (`chat`/`stream`/`embeddings`/`listModels`/
  `checkHealth`, `cli/src/core/ai/providers/`) backing real REST clients
  for OpenAI, Anthropic, Gemini, Groq, OpenRouter, Ollama, and LM Studio
  (four share one OpenAI-compatible implementation; Anthropic/Gemini/
  Ollama each have a genuinely different wire format and streaming
  dialect - two SSE variants and one NDJSON). A Context Engine
  (`core/ai/context/gather.js`) aggregates installed components,
  compatibility score, active workspace, git status, and config with zero
  new data collection; a 10-domain Prompt Library
  (`core/ai/prompts/library.js`) layers in real ecosystem-specific
  guidance; a capped local Memory log (`core/ai/memory/history.js`)
  records structured events, never chat transcripts. `ai doctor` turns a
  raw scan into a plain-language summary/reason/fix/estimated-time/risk
  explanation; `ai generate` maps a description onto one of the Project
  Generator's real 16 stacks and scaffolds through the same
  `runProjectGenerator` `devforgekit new` uses; `ai planner` maps a goal
  onto real registry collections/recipes/components, dropping any name a
  model invents rather than acting on it; `ai repair` narrates a
  compatibility repair plan and executes it through the same
  confirmation-gated `executeRepairPlan` `compatibility repair` already
  uses - never removing a conflicting package without confirmation. With
  no provider configured (the default `aiProvider: "none"`), every
  command degrades to a clear, actionable message instead of crashing or
  faking a response. A 16th dashboard page (`e`, "AI Assistant") offers
  request/response chat. `core/config.js` gains `aiModel`/`aiEndpoint`;
  API keys resolve from a provider's env var, then the active workspace's
  `ai.apiKeyRef` secret (a field `workspace.schema.json` already had),
  then none. See `docs/AIAssistant.md`, `docs/ProviderAPI.md`,
  `docs/ContextEngine.md`, `docs/MemorySystem.md`, and
  `docs/PromptLibrary.md`.
- **Compatibility Engine (v1.2.5)** - `devforgekit compatibility scan/
  check/explain/repair/graph/update/export` validates whether installed
  tools actually work together (version requirements, cross-package
  conflicts, and conflicts between two install variants of the same
  package, e.g. Docker Desktop vs. Colima) rather than just whether each
  is individually installed. Rules live in versioned, schema-validated
  `registry/compatibility/*.yaml` files (`registry/schema/
  compatibility.schema.json`), integrity-checked against the registry the
  same way packages/collections/profiles/recipes already are; plugins can
  contribute rules via an optional `rules` field
  (`cli/src/schemas/plugin.schema.json`). Version matching (exact/
  minimum/maximum/range/wildcard/pre-release) is built on `semver`;
  installed-version detection is honest (an optional `versionCommand`
  package field, falling back to parsing `validate`'s output, or
  "unknown" - never guessed). Every scan produces a 5-tier score (Healthy/
  Warning/Critical/Unsupported, extending `core/health.js`'s PASS/
  WARNING/FAIL formula - Critical/Unsupported always win the verdict
  regardless of the numeric score) plus a dependency graph (missing/
  circular/duplicate-tool detection) and a repair engine that installs
  missing requirements and runs recommended upgrades automatically but
  never removes a conflicting package without confirmation. Wired into
  Doctor (`--skip-compatibility`), Recipe/Profile install (pre-install
  check + displayed score), the Project Generator (opt-in per stack via
  `compatibilityCheck`, wired for flutter/react-native/expo), the
  Workspace Manager (`workspace compatibility scan/repair/history`, the
  first real entry in its schema migration table, v1→v2), the dashboard
  (a 15th page, shortcut `m`), and `registry stats`'
  `compatibilityCoverage`. AI-assisted recommendations
  (`core/compatibility/ai.js`) are a reserved, documented interface only -
  calling it throws, pointing at the planned v1.3.0 AI Doctor release. See
  `docs/CompatibilityEngine.md`, `docs/RuleSchema.md`,
  `docs/CompatibilityRules.md`, and `docs/RepairGuide.md`.
- **Workspace Manager (v1.2.4)** - `devforgekit workspace` makes an
  isolated per-project development environment a single switchable
  unit: git identity, SSH host identities (`~/.ssh/config` Host blocks),
  environment variables + AES-256-GCM-encrypted secrets, Docker/
  Kubernetes/cloud-CLI (AWS/GCP/Azure/Firebase/Supabase/Cloudflare/
  Vercel/Netlify) context, and shell aliases/functions/PATH all move
  together with one `devforgekit workspace switch <name>`. Includes
  health verification (`workspace verify`, reusing `core/health.js`'s
  PASS/WARNING/FAIL scoring), point-in-time snapshots with diff/compare
  and rollback (automatic safety snapshot first, live re-apply if the
  target is the active workspace), portable `.tar.gz` export/import
  (secrets and snapshot history excluded by design; auto-repairs
  dangling registry references on import), and optional references into
  the existing profile/collection/recipe/component/plugin registry
  (resolved through the same `core/registry.js` functions `profile
  install`/`recipe install` use). 30 subcommands under `cli/src/commands/
  workspace.js`, a new `~/.config/devforgekit/workspaces/<name>/
  workspace.json` document (`schemaVersion: 1`,
  `cli/src/schemas/workspace.schema.json`, with a real migration
  skeleton for future schema versions), and a 14th dashboard page
  (`w`) covering the high-frequency actions. `devforgekit new` now
  records generated projects into the active workspace's
  `projectHistory`. See `docs/WorkspaceManager.md` and
  `docs/PlatformArchitecture.md` section 21.
- **Interactive Terminal Dashboard (v1.2.3)** - run `devforgekit` with
  no arguments (or `devforgekit dashboard` / `ui`) and the platform
  opens as a full-screen, keyboard-driven TUI in the k9s/lazygit
  family: 13 pages (overview, components, profiles, recipes, project
  generator wizard, plugins, doctor, updates, inventory, configuration,
  session logs, help, about), global `/` search across every registry
  entity, four color themes persisted through the existing config
  system (`tuiTheme`), live-streamed install output, and suspend/resume
  handoff to terminal-owning scripts (doctor.sh, update.sh,
  inventory.sh, scaffolding CLIs, plugin commands). Built with Ink
  (React for terminals, no JSX - the CLI stays build-step-free) under
  `cli/src/tui/`, as a pure frontend: every action calls the exact same
  `core/` services the classic commands use, which all remain
  unchanged. Non-TTY/`TERM=dumb`/`DEVFORGEKIT_NO_TUI=1` environments
  fall back to classic `--help`. `core/shell.js`, `core/installer.js`,
  and `core/recipes.js` gained an optional `onOutput` streaming mode
  (additive - no existing caller changed). See `docs/TUI.md`.
- **Project Generator (v1.2.2)** - `devforgekit new <stack> [name]`
  generates a complete, production-ready project for one of 16 stacks
  (Flutter, Next.js, Express, React, React Native, Expo, NestJS,
  FastAPI, Django, Laravel, Spring Boot, ASP.NET, Go Fiber, Rust Axum,
  Tauri, Electron) - not a copy of a static `templates/` folder, but real
  files assembled per stack, scaffolded through the stack's own official
  CLI where one exists (`flutter create`, `create-next-app`,
  `django-admin`, `composer create-project laravel/laravel`, `dotnet new
  webapi`, `create-tauri-app`, or the Spring Initializr API for Spring
  Boot) and layered with hand-written files (auth, ORM, state
  management, Docker, CI, linting, tests, README) on top. Every stack
  under `cli/src/generators/*.js` implements the same shared contract
  driven by `cli/src/core/projectGenerator.js`'s `runProjectGenerator`.
  See `docs/ProjectGenerator.md` and `docs/PlatformArchitecture.md`
  section 8.
- **Recipe Engine (v1.2.1)** - reusable, one-command environment workflows.
  `registry/schema/recipe.schema.json` + `registry/recipes/*.yaml` (8
  built-in recipes: `ai-engineer`, `flutter-developer`,
  `backend-developer`, `devops-engineer`, `cybersecurity-lab`,
  `game-developer`, `ml-engineer`, `embedded-engineer`), `cli/src/core/
  recipes.js` (configure/verify runtime), and `devforgekit recipe
  list/show/install/create/import/search/publish`. A recipe composes the
  same `collections`/`components` a profile does, then layers `configure`
  steps (`git`/`vscode`/`cursor`/`shell`/`mise` dotfile restoration,
  calling straight into `scripts/restore.sh`'s existing functions) and a
  `verify` pass (health-checks every installed component) on top, so one
  command replaces "install X, install Y, configure Z, verify
  everything." `core/registry.js`'s `checkIntegrity`/`loadRegistry`/
  `getRegistryStats` treat recipes as a first-class bundle kind alongside
  collections/profiles. See `docs/Recipes.md` and
  `docs/PlatformArchitecture.md` section 5.

## [1.0.0] - 2026-07-04

### Added

- `scripts/common.sh` and `scripts/colors.sh` shared libraries: logging, timers,
  OS/arch detection, safe idempotent file copying, and a fault-tolerant step runner.
- `scripts/backup.sh` - captures live Zsh/Git/mise/VS Code/Cursor configuration
  back into the repo and commits/pushes only when something changed.
- `scripts/restore.sh` - restores dotfiles and editor configuration without
  touching Homebrew packages or services.
- `scripts/update.sh` - upgrades Homebrew, mise, Flutter, pnpm, Git LFS, and
  CocoaPods, then restarts and re-verifies services.
- `scripts/check.sh` - PASS/WARNING/FAIL health check across the full toolchain.
- `scripts/doctor.sh` - deep diagnostics: PATH hygiene, broken symlinks,
  permissions, Git/SSH/GitHub auth, Docker daemon state, toolchain doctors.
- `scripts/services.sh` - start/stop/restart/status for PostgreSQL, MySQL, Redis.
- `scripts/validate.sh` - shell syntax, ShellCheck, Brewfile, mise.toml, JSON,
  and Markdown validation.
- `scripts/cleanup.sh` - reclaims disk space across Homebrew, Flutter, npm/pnpm,
  mise, and Docker caches.
- `scripts/report.sh` - generates `reports/system-report.txt` with OS, hardware,
  tool versions, service state, and Git/Flutter/Docker status.
- `scripts/install.sh` - standalone Homebrew + Brewfile installer.
- GitHub Actions: `bootstrap.yml`, `shellcheck.yml`, `lint.yml`, `update.yml`,
  `release.yml`.
- `.env.example`, `LICENSE` (MIT), `VERSION`, this `CHANGELOG.md`.

### Changed

- `bootstrap.sh` rewritten to detect macOS version, CPU architecture (Apple
  Silicon vs Intel), internet connectivity, and disk space before installing
  anything; every step is now individually fault-tolerant instead of aborting
  the whole run on the first failure, and it prints a colored summary with
  total execution time.
- Dotfile/editor restoration is now idempotent: files are only copied when
  their content actually differs from what's already on disk, and any existing
  file that would be overwritten is backed up first (`*.backup-<timestamp>`).

## [0.1.0] - 2026-07-04

### Added

- Initial development environment: `bootstrap.sh`, `Brewfile`, `mise.toml`,
  `.zshrc`, `.gitconfig`, `.gitignore_global`, VS Code and Cursor settings.
