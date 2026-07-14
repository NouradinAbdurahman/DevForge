# Changelog

All notable changes to this repository are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/).

## [3.0.2] - Unreleased

Documentation and messaging patch. No functional/packaging changes -
the `os: ["darwin", "linux"]` restriction in `package.json` is
correct and stays as-is; it prevents a native Windows npm install that
would not run anyway, since the `devforgekit` dispatcher and
`scripts/npm-postinstall.sh` are both bash scripts requiring a POSIX
shell that stock Windows (cmd.exe/PowerShell) doesn't provide.

### Changed

- **README.md** - every Windows-related claim now consistently states
  that native Windows is unsupported and explains why (bash dispatcher,
  not a packaging bug), with a prominent callout in Installation, a
  corrected FAQ, and updated badges/tables that previously implied
  Windows parity with macOS/Linux.
- **Website** (`devforgekit.dev`) - installation page's Windows journey,
  platform-recommendation cards, FAQ, feature copy, roadmap copy, and
  `lib/seo.ts`'s structured-data `operatingSystem` field brought in line
  with the same Windows-via-WSL messaging.
- Added a **Planned: v3.1 Native Windows Support** roadmap entry -
  replacing the bash entry point and postinstall script, adding a real
  Windows-native provisioning path for `devforgekit install`, then
  removing the `os` restriction once verified on real hardware.

## [3.0.1] - 2026-07-12

First stable public release. Promotes `v3.0.1-rc1` to stable after the
RC cycle's real-world verification (npm and Homebrew distribution, a
clean `rc-validate` run, and dogfooding on a real machine) turned up no
release-blocking issues. No code changes since `v3.0.1-rc1` - see that
section below for the full release-engineering changelog (npm/Homebrew
distribution, shell completions, the release-readiness gate, and the
rest of this cycle's work).

## [3.0.1-rc1] - 2026-07-12

Release engineering for v3.0.1-rc1: distribution channels and release
process, plus the verification work that preceded them. No new product
features.

### Added

- **npm distribution** - `npm install -g devforgekit` is now a real,
  verified install path: a publishable root `package.json`, a
  self-healing `devforgekit` dispatcher (populates `cli/node_modules`
  on first run if npm's postinstall didn't - confirmed live that npm
  11.x's allow-scripts gate can skip it silently), and
  `.github/workflows/npm-package.yml` validating the real packed
  tarball end-to-end on macOS and Ubuntu.
- **Homebrew distribution** - `Formula/devforgekit.rb`, verified with a
  real `brew install`/`brew test`/`brew uninstall` cycle against a
  local test tap. Installs the launcher only; toolchain provisioning
  stays `devforgekit install`'s job. `.github/workflows/homebrew-formula.yml`
  validates it on every change.
- **Shell completions** - `completions/devforgekit.{bash,zsh,fish}`,
  generated from the CLI's real command tree
  (`scripts/generate-completions.mjs`), installed by the Homebrew
  formula and CI-checked for drift.
- **`docs/CommandSafety.md`** - every command classified READ ONLY or
  MUTATING, with the naming rule that drove it: a command without an
  explicit mutating verb must never modify the machine.
- **`docs/CompatibilityReport.md`** - a backward compatibility matrix
  across every public command: exit codes, `--help`, `--json` validity,
  error paths, mutation status, CI safety.
- **`docs/ApiFreeze.md`** - every public command, config field, schema,
  output format, and env var classified Stable/Experimental/Internal.
  Stable surfaces cannot change before v4.
- **`docs/ReleaseReadinessReport.md`** and **`docs/DistributionReadiness.md`**
  - the release-readiness rollup and the per-channel packaging status
    (what's actually Ready vs. Pending vs. Blocked, and why).
- **`RELEASE.md`** - the release checklist, tag process, rollback
  process, publishing order, and verification steps for v3.0.1-rc1 and
  beyond.
- **`devforgekit doctor --release-check`** - a single-command
  release-readiness gate: version consistency across `VERSION`/
  `package.json`/`cli/package.json`/`Formula/devforgekit.rb`, required
  documentation, distribution artifacts, registry health, outstanding
  pending-work markers, experimental/debug flags, git tree cleanliness,
  and the current commit's own CI status. Blocks (non-zero exit) if
  anything fails.
- **`devforgekit rc-validate`** (`scripts/rc-validate.sh`) - the full
  Distribution Verification & RC Validation checklist against real
  artifacts: GitHub Release, npm (a real scratch-prefix global install/
  uninstall cycle), Homebrew (a real `brew install --build-from-source`
  against a local test tap), a fresh-install lifecycle, smoke tests,
  and the full regression suite - writes `docs/RCValidationReport.md`
  with a real PASS/FAIL verdict.
- **Draft-first GitHub Releases** - pushing a version tag now creates a
  **draft** release rather than auto-publishing: real checksums
  (`SHA256SUMS.txt`), a real SBOM (CycloneDX and SPDX, via `npm sbom`
  against `cli/`'s actual dependency tree), and optional GPG signing
  (if a signing key is configured - none is yet) are attached, plus a
  `doctor --release-check` gate that blocks the release outright if the
  commit isn't ready. Publishing is always a separate, deliberate
  `gh release edit <tag> --draft=false`.
- **Homebrew `livecheck`** - `Formula/devforgekit.rb` now tracks GitHub
  releases directly (verified live via `brew livecheck` before adding,
  not guessed).

### Fixed

- **`cli/package.json`'s test script had no per-test timeout** -
  `node --test` defaults to unbounded, so a genuinely hung test worker
  (found live during this pass: a `tui-reduced-motion.test.js` process
  stuck for over two hours with near-zero CPU usage) hangs silently
  forever instead of failing loudly. Added `--test-timeout=600000`
  (an initial `180000` broke real CI - `package.test.js`'s
  `analyzePackages()` test already had its own deliberately-set,
  CI-confirmed 300s internal bound, documented inline from a prior
  session's own live CI failure; the global timeout needs real margin
  above the slowest already-known-legitimate test, not just above
  local timing), with a regression test guarding the script definition
  itself.
- **`docs/DistributionReadiness.md`** - npm and Homebrew were still
  listed as "Pending" long after both shipped (PRs 18-19); updated to
  reflect that packaging is done and only real publishing remains,
  deliberately deferred.
- **`docs/CommandReference.md`** - `doctor`'s real flag set (`--json`,
  `--skip-bash`, `--skip-compatibility`, `--export`, `--release-check`)
  was undocumented (only `--fix` was listed), and the new `rc-validate`
  command was missing entirely.
- **README.md/CONTRIBUTING.md test-count badges** - stale at 1,088;
  the real current count is 1,299.
- **`gh release download` outside a git working tree** - needs an
  explicit `-R owner/repo`; a scratch directory has no git context to
  infer the repository from otherwise.

- **`registry verify` and `workspace benchmark`** - two commands that
  mutated the machine by default despite read-only names. `registry
  verify` now only attempts an install behind an explicit `--install`
  flag; `workspace benchmark` no longer switches live git identity
  unless `--ops` explicitly asks for it. Both fixes shipped with
  canary-file regression tests.
- **`check --json` and the `package`/`repair` command family** - four
  separate instances of the same bug (a full registry scan running
  strictly sequentially instead of using the shared bounded-concurrency
  worker pool) made these commands hang indefinitely instead of
  completing in seconds. Found by actually running the compatibility
  sweep, not by reading the source.
- **`repair history --json` and `benchmark history --json`** - both
  silently broke their own `--json` contract on an empty result,
  printing a human-readable sentence instead of `[]`.
- **CI running the full test suite twice per commit** - `push` and
  `pull_request` both triggering the identical ~7-minute suite for the
  same commit on a feature branch. `push` now runs a fast subset;
  the full suite runs once, on the pull request.
- **Two real, timing-sensitive test bugs** surfaced while investigating
  a CI failure: a polling helper that could resolve in zero event-loop
  ticks (starving Ink's raw-mode listener setup and silently dropping
  the next keypress), and a fixed-delay assertion too short for real
  CI contention. Both replaced with a poll-until-condition pattern that
  always yields at least once.
- **Fish shell completion generation** - incomplete backslash escaping
  in generated descriptions (caught live by CodeQL), fixed and verified
  against a synthetic backslash-and-quote input.
- **`scripts/release.sh rc` could produce a version lower than the
  already-shipped release** - cutting an RC directly from a clean,
  already-tagged version (e.g. running `rc` against `3.0.0` after
  `v3.0.0` had already shipped) appended `-rc1` without bumping the base
  version first, producing `3.0.0-rc1` - semver-*lower* than the real
  release it was supposedly a candidate for. This is exactly what
  happened cutting this cycle's first RC tag; corrected to `3.0.1-rc1`
  and `rc` now refuses outright when the current clean version is
  already tagged on origin, pointing at `patch`/`minor`/`major` instead
  of guessing which bump was intended.
- **`scripts/release.sh create` never synced `package.json`'s or
  `cli/package.json`'s own `"version"` field with `VERSION`** - caught
  for real by `doctor --release-check`'s version-consistency gate
  failing the release workflow on the actual RC tag. `create` now bumps
  all three together; `Formula/devforgekit.rb` is deliberately left
  alone (its `url`/`sha256` can't reference a tag that doesn't have a
  real tarball yet) and `checkVersionConsistency()` now excludes it from
  the comparison for the whole lifetime of a pre-release cycle instead
  of deadlocking every RC.
- **`checkVersionConsistency()`'s `cli/package.json` check ignored its
  own `root` parameter** - read via `cliRoot()` (always this checkout's
  real path) instead of the passed-in root, so a test exercising it
  against a scratch directory was silently checking this repo's actual
  file instead. Found while adding a regression test for the sync fix
  above; now reads `path.join(root, "cli", "package.json")`.
- **`WindowsPlatform.osVersion()` shelled out unconditionally** -
  `cmd /c ver 2>nul` is cmd.exe syntax, but the command runs through
  whatever shell is native to the *current* host; on a POSIX host (every
  CI runner, every dev machine here) `2>nul` is interpreted by `/bin/sh`
  as a literal file redirect, leaving a stray file named `nul` in `cli/`
  after every test run. Caught by `doctor --release-check`'s
  working-tree-clean gate immediately after CI's own test run left the
  file behind. Now returns `null` immediately on any non-Windows host
  without spawning a process at all.

### Security

- **Full security audit** - shell-injection, tar zip-slip,
  unattended-plugin-execution, AES-256-GCM tag-pinning, and TOCTOU
  fixes across the credential backends, archive handling, and plugin
  trust system, each with a regression test. See `SECURITY.md`.
- **`npm audit`**: 0 vulnerabilities. **`gitleaks`**: 0 secrets.

### Performance

- Package/repair size and version lookups (`du -sk`, `which`) gained a
  real timeout instead of running unbounded - a single large real
  directory could previously stall an entire scan.

### Breaking Changes

- None.

## [3.0.0] - 2026-07-07

### Added

- **v3.0.0 First Public GitHub Release** - production-ready first
  public release. No new features.
  - **CODE_OF_CONDUCT.md** - Contributor Covenant v2.0 code of conduct
    added.
  - **Pull request template** - `.github/PULL_REQUEST_TEMPLATE.md`
    with description, type-of-change, related-issues, and checklist
    sections.
  - **Dependabot CLI monitoring** - added `/cli` npm ecosystem entry
    to `.github/dependabot.yml` so the CLI's dependencies are tracked
    alongside the template dependencies.

### Changed

- Version bumped to 3.0.0.

- **README screenshots cleaned up** - removed broken image
  references for screenshots that don't exist yet (ai.png,
  generator.png, workspace.png). Removed `architecture.svg`
  reference from repository structure. Only existing screenshots
  (dashboard, components, graph, repair) are referenced. Replaced
  "Screenshots will be added" placeholder with a note about future
  screenshots.
- **README roadmap** - v3.0.0 moved from Planned to Shipped.

- **v2.2.4 Final Polish & Production Readiness** - comprehensive audit
  and documentation consistency pass across all subsystems. No new
  features.
  - **Cross-platform language audit** - replaced all stale
    "macOS-only"/"macOS development workstation" references with
    cross-platform language across README.md, CLAUDE.md,
    Architecture.md, PlatformArchitecture.md, TUI.md, CLI.md,
    AIAssistant.md, and CLI/TUI source files. Layer 1 bash scripts
    correctly remain macOS-specific by design.
  - **CommandReference.md completeness** - added missing subcommands
    for workspace (metadata, deactivate, rename, clone, search, repair,
    diff, health, git-capture, shell-init, benchmark, snapshot
    restore/compare/delete/export, env, ssh), repair (explain-issues,
    rollback-repair, rollback-list, benchmark), benchmark (quick,
    standard, full, trend, intelligence, report), graph (open, cache),
    snapshot (delete, explain), component (info, validate, repair,
    update), theme (list, use, preview, random, export, import,
    gallery), and ai (import). Removed non-existent `config edit` and
    `config reset`; added `config list`.
  - **README.md commands table** - expanded all command categories to
    reflect the full set of subcommands in the code, matching
    CommandReference.md.
  - **AIAssistant.md** - updated secure storage description from
    "macOS Keychain" to cross-platform "OS secure storage — Keychain
    on macOS, encrypted file on Linux/Windows".
  - **KeyboardShortcuts.md** - corrected navigation shortcuts table to
    match the actual `store.js` PAGES array and updated the built-in
    themes list to match the 20 themes in `themes/builtin.js`.
  - **ArchitectureDiagrams.md** - updated compatibility rule count
    from 34 to 196.
  - **PlatformArchitecture.md** - updated LinuxPlatform and
    WindowsPlatform descriptions from "stub" to "fully implemented
    (v2.2.3)".
  - **TUI.md** - updated Updates page and performance section from
    brew-specific to cross-platform package managers.
  - **CLI.md** - added missing AI commands (setup, status, fix) to
    example usage block.
  - **package-lock.json** - fixed stale version (1.1.0 → 2.2.3).
  - All 1,088 tests pass with no regressions.

### Changed

- Version bumped to 2.2.4.

- **v2.2.3 Cross-Platform Implementation** - real Linux and Windows
  support with 7 package managers, `platformInstall` for per-OS install
  steps, and WSL detection.
  - **Linux platform adapter** - full implementation of `LinuxPlatform`
    with `apt` (Debian/Ubuntu), `dnf` (Fedora/RHEL), and `pacman` (Arch)
    support. Detects the available package manager at runtime via
    `existsSync` on binary paths (apt > dnf > pacman precedence).
    Implements `installCommand()`, `packagePrefix()`, `outdatedPackages()`,
    `upgradeCommand()`, `packageManagerId()`, `packageManagerCacheDir()`,
    and `osVersion()` (from `/etc/os-release`).
  - **Windows platform adapter** - full implementation of
    `WindowsPlatform` with `winget` (Windows Package Manager),
    `choco` (Chocolatey), and `scoop` support. Detects the available
    package manager at runtime (winget > choco > scoop precedence).
    Implements `installCommand()`, `packagePrefix()`,
    `outdatedPackages()`, `upgradeCommand()`, `packageManagerId()`,
    `packageManagerCacheDir()`, `osVersion()`, and `binSearchDirs()`.
  - **WSL detection** - `LinuxPlatform.wsl` getter detects Windows
    Subsystem for Linux via `/proc/version` containing "microsoft".
  - **platformInstall field** - new schema field on both packages and
    variants: `platformInstall: { macos: {...}, linux: {...}, windows: {...} }`.
    The installer picks the entry matching the current platform; falls
    back to the top-level `install` field if no match. Lets a single
    manifest support macOS (brew), Linux (apt), and Windows (winget)
    without separate files.
  - **New install methods** - `apt`, `dnf`, `pacman`, `winget`, `choco`,
    `scoop` added to the package schema's `installStep.method` enum.
  - **New architectures** - `x64` and `arm64` added to the schema's
    `architectures` enum for Linux/Windows support.
  - **222 packages updated** with `platformInstall` entries mapping
    brew names to apt and winget equivalents via a curated mapping
    table. Key packages (docker, node, wget, curl, git, etc.) manually
    curated with correct package manager IDs.
  - **Docker variants expanded** - added `docker-engine` variant for
    Linux (apt: `docker-ce`), `docker-desktop` now has `platformInstall`
    for Windows (winget: `Docker.DockerDesktop`).
  - **Installer updated** - `resolveInstallStep()` now checks
    `variant.platformInstall` and `pkg.platformInstall` before falling
    back to the top-level install field. `uninstall()` also resolves
    the platform-specific step.
  - **7 new platform tests** - apt/dnf/pacman install commands,
    winget/choco/scoop install commands, cross-platform
    PlatformNotSupportedError checks, and `platformInstall` resolution
    tests for macOS/Linux/Windows/fallback. All 1,088 tests pass.

### Changed

- Version bumped to 2.2.3.

- **v2.2.2 Performance & Startup Excellence** - in-memory caching for
  the registry's hottest paths, cutting CLI response times by ~50%.
  - **Registry loading cache** - `loadPackages`, `loadCategories`,
    `loadCollections`, `loadProfiles`, and `loadRecipes` now cache
    their results in a module-level `Map` keyed by directory path.
    Previously, every call to `getPackage()`, `getCollection()`,
    `searchPackages()`, etc. re-read and re-parsed all 261 YAML files
    from disk. Now the first call loads + caches, subsequent calls
    return instantly. `clearRegistryCache()` is exported for
    `registry generate` to invalidate after writing.
  - **Package lookup optimization** - `getPackage()` now uses a cached
    `name → package` `Map` for O(1) lookup instead of linear `find()`
    across 261 packages.
  - **Search index cache** - `searchPackages()` pre-builds a lowercased
    search index (name, tags, aliases, description, category) once,
    avoiding 261 × 5 `toLowerCase()` calls per search.
  - **Quality score cache** - `getRegistryStats()` caches each
    package's `scoreManifest()` result on the package object
    (`_qualityScore`), avoiding 13 × 261 re-evaluations per call.
    The search ranking tiebreaker reuses this cached score.
  - **Measured improvement** - `registry stats` cold-start: 0.40s →
    0.19s (52% faster). `info <name>`: 0.25s → 0.18s (28% faster).
    All 1,081 tests pass with no regressions.

### Changed

- Version bumped to 2.2.2.

- **v2.2.1 Package Ecosystem Excellence** - a comprehensive audit and
  enrichment of all 261 packages in the registry, making every package
  feel curated, verified, and production-ready.
  - **Metadata completeness** - 100% coverage across all 261 packages for
    homepage, repository, license, documentation, stability, lastVerified,
    aliases, architectures, validate, uninstall, and tags (≥2 per package).
    Previously: aliases 30%, architectures 86%, repository 95%.
  - **Version detection** - added `versionCommand` to all 258 packages that
    were missing it (99% → 100%). Each command is tailored to the tool's
    actual `--version` output format.
  - **Update commands** - added `update` field to the 4 packages missing it
    (`c`, `docker`, `swift`, `xcode`).
  - **Compatibility rules** - created 162 new compatibility rule files,
    bringing coverage from 13% (34 rules) to 75% (196 rules). Rules cover
    language runtime ↔ package manager relationships, container/K8s
    ecosystem pairings, database conflicts (mysql ↔ mariadb), editor
    toolchains, DevOps tool chains, security tool pairings, and more.
  - **Package recommendations** - added `recommendedAlternatives` to 185+
    packages, enabling the Compatibility Engine to suggest real alternatives
    (e.g. `podman` for `docker`, `neovim` for `vim`, `pnpm` for `npm`).
  - **Search ranking improvement** - `searchPackages` now uses quality score
    as a tiebreaker when match scores are equal, and distinguishes exact
    alias matches (score 70) from alias substring matches (score 60).
  - **Quality score improvement** - average Manifest Quality Score raised
    from 77% to 88% across the registry.
  - **Registry health** - doctor issues reduced from 312 to 258 (remaining
    are "never install-verified" info items, expected for non-CI packages).

### Changed

- Version bumped to 2.2.1.

- **v2.1.9 Plugin SDK Excellence** - a comprehensive quality pass on the
  Plugin SDK, bringing it to the same standard as the Registry, Project
  Generator, AI Assistant, Environment Graph, Snapshot, Repair,
  Benchmark, and Workspace subsystems.
  - **Schema v2 metadata** - added `repository`, `keywords`, `icon`,
    `compatibility` (platforms/architectures), `permissions`, and
    `capabilities` fields to the plugin manifest schema. All optional,
    fully backward-compatible with v1 manifests.
  - **Plugin Validation** - `devforgekit plugin validate [dir]` runs
    comprehensive structural checks: manifest schema, engine
    compatibility, script existence/executability, README/LICENSE/icon
    presence, platform/architecture compatibility, dependency resolution,
    duplicate command names, semver versioning, tests/ directory. `--json`
    for machine-readable output.
  - **Plugin Quality Score** - `devforgekit plugin quality [name|dir]`
    scores across 9 categories (Documentation, Architecture, Testing,
    Signing, Compatibility, Versioning, Manifest, Permissions, Examples).
    `--json` for machine-readable output.
  - **Plugin Diagnostics** - `devforgekit plugin doctor` scans all
    discovered plugins for invalid manifests, incompatible engines,
    duplicate commands, missing scripts, missing dependencies, unbuilt
    plugins, deprecated schema v1, missing README/LICENSE, and
    platform/architecture incompatibility. `--json` for machine-readable
    output.
  - **8 Plugin Templates** - `devforgekit plugin create <name>
    --template <template>` scaffolds from one of 8 templates:
    `simple-command`, `tui-page`, `generator`, `benchmark`, `repair`,
    `graph-extension`, `ai-provider`, `compatibility-rule`. Each
    template produces a valid, passing plugin with appropriate
    capabilities, permissions, and command scripts.
  - **Enhanced plugin test** - `--json` flag for machine-readable output.
  - **Enhanced plugin package** - improved output with archive size,
    signature status, and engine info. `--json` flag. `packagePlugin()`
    now returns `manifest` and `lock` objects in its result.
  - **TUI Plugins page redesign** - tabbed interface with 4 tabs:
    Installed (browse with capabilities/permissions), Validation
    (per-plugin validation results), Quality (per-plugin quality scores),
    Details (full manifest breakdown).
  - **Plugin SDK documentation** - comprehensive `docs/PluginSdk.md`
    with manifest reference, templates, lifecycle, signing/trust, event
    hooks, TUI integration, command reference, best practices, and
    migration guide.
  - 31 new tests in `test/plugin-excellence.test.js` covering all v2.1.9
    features. All 40 plugin tests + 38 TUI tests passing.
  - Fixed incorrect `import { process } from "node:process"` in
    `pluginValidation.js` (process is a global, not a named export).
  - Made example test script generic (checks `plugin.yml` exists instead
    of running a specific command script) so all 8 templates pass
    `testPlugin` out of the box.

- **v2.2.0 Documentation & Developer Experience** - a comprehensive
  documentation overhaul making the project accessible to new
  contributors.
  - **README.md rewrite** - added table of contents, Plugin SDK section,
    updated roadmap from the obsolete "v2.0 Cloud Platform" to the new
    v2.2 plan (Documentation, Package Ecosystem, Performance,
    Cross-Platform, Final Polish, v3.0.0 Stable), streamlined
    Contributing section.
  - **CONTRIBUTING.md** - new contributing guide with development setup,
    project structure, coding standards (bash 3.2, ESM/JS, YAML),
    testing conventions, validation steps, "how to add things" table,
    documentation guide, and PR process.
  - **docs/ArchitectureDiagrams.md** - ASCII + Mermaid diagrams for
    four-layer architecture, command dispatch flow, TUI render pipeline,
    plugin lifecycle, registry data flow, compatibility engine flow, AI
    assistant sequence, workspace switch sequence, DEV Graph node types,
    OS abstraction layer, and config file hierarchy.
  - **docs/CommandReference.md** - complete command reference table
    covering every `devforgekit` command across all subsystems (core
    lifecycle, diagnostics, profiles, recipes, components, registry,
    project generator, plugin SDK, workspace, compatibility, AI, graph,
    package intelligence, benchmark, repair, snapshot, configuration,
    release, TUI).
  - **docs/KeyboardShortcuts.md** - complete TUI keyboard shortcut
    reference: global keys, navigation, list navigation, search, command
    palette, plugins page tabs, configuration, text input, suspend/
    resume, startup animation, debug, and theme shortcuts.
  - **docs/MigrationGuide.md** - version migration guide covering
    config format changes, plugin schema v1→v2, workspace schema v1→v2,
    registry quality fields, TUI addition, AI assistant, DEV Graph,
    plugin SDK evolution, version compatibility matrix, and the config
    migration framework.
  - **docs/Troubleshooting.md** - expanded from 71 lines to 208 lines
    with new sections: Compatibility, AI Assistant, TUI/Dashboard,
    Plugins, Workspace Manager, Project Generator, Registry, Self-Update,
    and Getting Help cross-references.
  - **README.md premium redesign (v2.2.0.1)** - complete rewrite from 708
    lines to 479 lines as a flagship-quality landing page. Centered hero
    with banner image placeholder, real project statistics (261 packages,
    17 generators, 20 themes, 1,081 tests, etc.), quick navigation table,
    feature cards, Mermaid architecture diagram, screenshot gallery
    placeholders, categorized documentation hub, repository tree, project
    statistics table, capability checklist, concise roadmap, and
    professional footer. Created `assets/github/` directory structure for
    banner and screenshots. No fake badges, no exaggerated claims.
- **v2.0.0 TUI Foundation & Component Library** - a shared UI component
  library (`Badge`, `StatusIndicator`, `Card`, `EmptyState`, `ErrorState`,
  `LoadingState`, `Table`, `ScrollList`, `FilterBar`, `DetailPanel`,
  `PageShell`, `InstallProgress`) and one page-layout system, migrated
  across every dashboard page to replace ad hoc, inconsistent per-page
  implementations. Toast notifications (auto-dismissing) and an in-Ink
  `ModalHost` (confirm/text prompts) replace suspend-to-bare-prompt for
  simple flows.
- **v2.0.1 Navigation & Command Palette** - `:`/`Ctrl+P` opens a fuzzy
  page-jump and global-action palette (`tui/fuzzy.js`, fzf-style scoring).
- **v2.0.2 Search & Filtering** - Components/AI Models/Search pages
  migrated to real fuzzy matching with character-level highlighting.
  Fixed a race where the global `/` search handler could fire alongside a
  page's own local filter on the very first keystroke.
- **v2.0.3 Notifications, Progress & Feedback** - toast de-duplication, a
  shared `InstallProgress` component, and a notification wording/level
  audit across every page.
- **v2.0.4 Onboarding & First-Run Experience** - a 6-step first-run
  wizard (theme, shortcuts, pages, profile, AI setup), shown once via a
  persisted `onboardingSeen` config flag.
- **v2.0.5 Themes, Accessibility & Responsive Layout** - extended the
  WCAG contrast checker to cover selection/search-highlight/table-header
  colors, fixing 4 real contrast failures across 4 built-in themes;
  reduced-motion support (`reducedMotion` config field, static spinners).
- **v2.0.6 Performance & Rendering Optimizations** - fixed `StatusBar`'s
  `React.memo`, which was a silent no-op because it read `useStore()`
  directly instead of taking props (context reads bypass memo entirely).
- **v2.0.7 Cross-Platform Architecture** - a new OS Abstraction Layer
  (`cli/src/core/platform/`, see `docs/PlatformArchitecture.md` section
  24): `getPlatform()` replaces direct `process.platform` checks across
  every shared system (installer, compatibility engine, repair, package
  intel, workspace manager); `MacOSPlatform` centralizes every Homebrew/
  `sw_vers` call this codebase already made; `LinuxPlatform`/
  `WindowsPlatform` exist for real, testable shape but honestly report no
  package manager yet (architecture-only - no Linux/Windows support in
  this release). Fixed a latent bug found during migration: `packageIntel.js`'s
  install-location and outdated-detection checks compared against
  `"brew"`, but the real manifest method value is `"brew-formula"` - the
  check never matched, silently skipping both checks for every
  brew-formula package.
- **v2.0.8 Registry Expansion** - quality over quantity: added a
  `documentation` field to all 251 pre-existing registry packages (0/251
  had one before - the single biggest lever on the Manifest Quality
  Score, raising the registry-wide average from 60% to 70%); expanded
  compatibility rule coverage from 2% (5 packages) to 9% (24 rule files),
  adding real, defensible `conflicts` (MariaDB/MySQL port collision,
  asdf/Volta PATH-shim collision) and `recommends` pairings (kubectl
  ecosystem, git/GitHub CLI, Python/Poetry/uv, Terraform/Vault,
  Prometheus/Grafana, ESLint/Prettier, Neovim/tmux, fzf/ripgrep/zoxide/
  bat); added 10 new, real, well-verified packages (`lazygit`,
  `lazydocker`, `starship`, `atuin`, `just`, `watchexec`, `git-delta`,
  `difftastic`, `dive`, `mkcert`), bringing the registry to 261
  components.
- **v2.0.9 Project Generator Expansion** - added a 17th stack, SvelteKit
  (`devforgekit new sveltekit`), scaffolded via the official `sv create`
  CLI (the successor to the deprecated `create-svelte`/`npm create
  svelte@latest` flow) with TypeScript, ESLint, Prettier, optional
  Tailwind CSS, optional Dockerfile, and CI layered on top - the same
  official-CLI-plus-hand-written-layer pattern every other CLI-scaffolded
  stack (Next.js, Expo, NestJS...) already uses.
- **v2.1.0 UX & Product Consistency Audit** - a polish-only pass (no new
  features) auditing every dashboard page against `components/ui.js`'s
  own conventions for wording, spacing, color, key hints, navigation, and
  destructive-action safety. Found and fixed a real bug (`AIDiagnosticsPage`
  used `"WARN"` instead of the recognized `"WARNING"` status, silently
  rendering warnings in muted gray instead of the warning color) and a
  three-way drift in AI-health severity classification between
  `DashboardPage`, `AIStatusCard`, and `commands/ai.js`'s `ai status`
  (unified into one canonical `aiHealthTone()` export). Replaced
  hand-rolled list navigation on two AI pages with the shared
  `SelectList` (restoring `j`/`k`/`PageUp`/`PageDown`/`g`/`G` support),
  extended `statusColor()` to recognize the app's lowercase toast/log
  severity vocabulary, unified loading/empty/error states across a dozen
  pages onto `LoadingState`/`EmptyState`/`ErrorState`/`InstallProgress`,
  rebuilt `ProfilesPage`/`RecipesPage`'s detail panels on `DetailPanel`,
  added a confirm-before-remove guard to `ComponentsPage` (wiring up
  `actions.confirmAsync`, defined since v2.0.0 but never actually called
  anywhere), and standardized wording (empty-provider messaging, toast
  punctuation, "filter" vs "search" terminology) across the AI pages,
  Commands, and Updates. See `docs/TUI.md`'s new "v2.1.0 UX & Product
  Consistency Audit" section for the full list.
- **v2.1.1 Registry Excellence** - not "add hundreds of packages" but
  making every existing one feel production-quality. Redesigned the
  Manifest Quality Score (`core/quality.js`) from 10 checks (3 of which
  were literally the same `ciVerified` boolean counted three times) to 13
  checks grouped into a real category breakdown (Metadata/Documentation/
  Reliability/Discoverability/Compatibility/Platform Support), so
  `devforgekit info <name>` shows *why* a package scores what it does.
  Added a fourth registry subcommand, `devforgekit registry audit` -
  a static health scorecard (package/verified/deprecated counts, average
  quality, coverage percentages) with data-driven recommendations,
  distinct from the pre-existing `stats`/`verify`/`doctor` - plus a new
  dashboard page (`tui/pages/RegistryPage.js`, shortcut `y`) showing the
  same scorecard. The audit immediately surfaced a real, previously-
  unknown gap: 0% of packages declared the optional `architectures`
  field; backfilled for the 224 packages installed via Homebrew (0% →
  86% coverage). Expanded compatibility rules 24 → 34 files (nginx↔
  certbot, direnv→asdf, k6→grafana, supabase→postgres, firebase↔flutter,
  pnpm/yarn/cypress/playwright→node). Fixed a real search gap
  (`ComponentsPage`'s local filter didn't search `aliases`, only `tags`)
  and added `tags` to all 17 Project Generator stacks so global search's
  "searching 'js' finds Node/Next/React/Express" family matching works.
  Added 10 new, individually-verified packages (`lazygit`, `lazydocker`,
  `starship`, `atuin`, `just`, `watchexec`, `git-delta`, `difftastic`,
  `dive`, `mkcert` - registry now 261 components). Along the way, found
  and fixed a genuine Ink rendering bug affecting any page whose combined
  panel content exceeds the documented per-page height budget - see
  `docs/TUI.md`'s "v2.1.1 Registry Excellence" section.
- **v2.1.2 Project Generator Excellence** - not "add more templates" but
  making every generated project feel production-ready and every stack
  behave consistently. Real validation before generation
  (`validateProjectName`: syntax, Windows-reserved device names like
  `con`/`nul`/`com1`-`9`, existing-directory check) with clear,
  actionable errors instead of a scaffold command failing partway
  through. A universal license system - `--license
  mit|apache-2.0|gpl-3.0|none` (interactive prompt if omitted, defaults
  to MIT), applied once in `core/projectGenerator.js` for every stack
  rather than 5 of 17 generators hardcoding their own MIT text and the
  other 12 writing none at all; added `licenseText()`/`apache2License()`/
  `gpl3License()` to `generators/shared.js`. Stack Intelligence - every
  generator now declares a real, registry-backed `recommends: [...]`
  array (e.g. Flutter → Firebase/Supabase/Android Studio/Dart), shown
  before scaffolding starts and live in the TUI's Project Generator page
  as the cursor moves. A new Generator Quality Score
  (`core/generatorQuality.js`'s `scoreGenerator()`, the Manifest Quality
  Score's sibling) scores each stack's real, pure `generate()` output
  across Documentation/Architecture/Testing/CI/Docker/Editor Support/
  Validation/Examples/Cross Platform - surfaced inline in `devforgekit new
  --list`, in full via `devforgekit new <stack> --quality`, and in the
  TUI's new "Stack Intelligence" panel. A structured "Project Created"
  post-generation summary reads Git/CI/Docker/README status back from the
  real output on disk instead of assuming it. Fixed real, independently-
  found bugs along the way: SvelteKit and Electron generated a `lint`
  script with no ESLint config to run it against; `spring-boot.js`'s
  `generate({options})` silently ignored its own `name` parameter;
  `react.js` declared `requiresTool: "npx"` but only ever shelled out to
  `npm`; Go Fiber/Rust Axum always wrote Docker files and never asked (no
  `promptOptions`, no `--docker` opt-out); Spring Boot generated zero
  README/documentation. See `docs/ProjectGenerator.md`'s "Project
  Generator Excellence" section.
- **v2.1.3 AI Assistant Excellence** - not a pile of new commands, but
  making the existing AI Assistant feel deeply integrated and
  trustworthy. Fixed a real bug found auditing every provider client: no
  `AIProvider` factory ever set a `supportsStreaming` field despite
  `ai benchmark` and the TUI's AI Diagnostics page both reading it - so
  `ai benchmark` always printed "stream: No" and Diagnostics always
  hardcoded a fake "Supported" pass regardless of the real provider; all
  four provider factories now set the real flag, and Diagnostics reads
  it instead of hardcoding. Added `core/ai/health.js`'s `scoreAIHealth()`
  - the Manifest/Generator Quality Score's sibling for the AI Assistant:
  a single percentage plus a transparent Provider/Credential/Model/
  Configuration/Memory/Context/Diagnostics/Streaming checklist, every
  check a real signal already computed elsewhere - surfaced via
  `devforgekit ai health [--live]` and the AI Overview page's "AI
  Status" panel title (folded into the title, not a new row, after
  hitting the same Ink row-budget limit v2.1.1 already documented).
  Broadened the Context Engine (`gatherContext()`) with a real platform/
  architecture summary, the real list of Project Generator stacks, and
  recent AI memory events in every gather, plus registry-wide stats
  under `full: true`. Added `core/ai/compare.js` and
  `devforgekit ai compare <a> <b>` - compares two real registry
  components or Project Generator stacks grounded only in their actual
  data, never invented facts. `ai history` gained `--clear`/`--export`
  for parity with `ai stats --clear`. Fixed a real, reported TUI bug: the
  AI Assistant chat page's input line was a detached row below both
  panels with no visual link to the conversation above it - moved inside
  the Chat panel itself with a `❯` prompt marker. See
  `docs/AIAssistant.md`'s "AI Assistant Excellence" section.
- **v2.1.3.1 AI Chat Rendering & Response Experience** - a direct
  follow-up: the Chat page's answers were reasonable, but the TUI was
  printing raw LLM output almost verbatim - `## headers`, `**bold**`,
  `<br>` tags, and `| A | B |` Markdown tables all showed up as literal
  characters instead of terminal formatting. Added a real rendering
  pipeline between the model and the screen: `tui/lib/markdown.js` (a
  pure, dependency-free parser - headings, paragraphs, bullet/numbered
  lists, fenced code blocks, tables, dividers, plus bold/italic/
  inline-code/link spans) and `tui/components/markdown.js`'s
  `MarkdownText` (renders those blocks as real Ink elements - bordered
  headings, rounded code blocks, the existing shared `Table` component
  for markdown tables, consistent bullets); `AIPage.js` now routes every
  assistant message through it instead of ever printing a raw model
  string. Added a TUI-specific system prompt addendum
  (`prompts/library.js`'s `TUI_SYSTEM_ADDENDUM`, opted into via
  `buildPrompt(kind, context, input, { surface: "tui" })`) asking the
  model for concise, terminal-shaped output with no Markdown tables, no
  HTML, and no repeating facts already visible on screen - the plain CLI
  `ai chat` REPL is unaffected. 31 new tests
  (`markdown-parser.test.js`/`markdown-render.test.js`/prompt-library and
  chat-session additions) assert the exact failure this fixes: no raw
  `##`/`**`/`<br>`/table-pipe syntax ever reaches the rendered output.
- **v2.1.3.2** - fixed a real reported bug: the AI Assistant chat page's
  `1 Doctor · 2 Generate · 3 Planner · 4 Explain · 5 Review · 6 Optimize
  · 7 Fix` quick-action hints only rendered in the empty-state welcome
  message, so they visually disappeared after the first message even
  though the `1`-`7` shortcuts kept working. Moved the list into the
  always-visible Context panel. Doing so reproduced the same Ink
  row-budget corruption v2.1.1/v2.1.3 already documented (KeyValue rows
  vanishing, action lines bleeding into each other); bisected by actually
  rendering at candidate terminal heights and found the real threshold -
  `hooks/useTerminalSize.js`'s `ai` page entry is now `{ rows: 34 }` (up
  from 24, verified corrupt at 30 and clean from 32).
- **v2.1.4 Environment Graph Excellence** - started with a full audit of
  `core/devGraph.js` and found a genuinely severe bug: a node-ID mismatch
  between how a node's own type is resolved (category-aware) and how an
  edge target's type is resolved (name-only, no category access) meant
  any package typed via `category` rather than a hardcoded name list
  (`dart`, `git`, `vscode`, ...) got a different node id as an edge
  source vs. an edge target - ~22% of all edges on the real registry were
  silently dangling, and `graph impact dart` returned nothing despite
  Flutter genuinely depending on it. Fixed, and verified via a new,
  deliberately real (non-mocked) integration test file,
  `devGraph-build.test.js` - the previous 60 tests all used a synthetic
  fixture and never called `buildGraph()` itself, exactly where the bug
  lived. Also found and fixed real duplicated logic (orphan/conflict
  detection implemented twice, DOT/Mermaid formatting reimplemented
  inline in `commands/graph.js` instead of calling `exportGraph()`), a
  hardcoded stub (`graph_reverseEmpty()`, admitted as much in its own
  comment), and five dead `applyGraphFilter` branches that filtered on
  properties `buildGraph()` never set (always silently empty) - removed
  rather than kept. Added real compatibility-rule nodes (34, one per
  `registry/compatibility/*.yaml`) and generator-stack nodes (17, wired
  to their real `recommends` arrays) with new `REQUIRES`/`RECOMMENDS`
  edge types sourced from real schema fields; repair-history nodes (
  previously always 100%-orphaned by construction) now get real
  `REPAIRS` edges to the tools they actually touched. Once these edges
  exist, `analyzeImpact()`'s existing algorithm - unchanged - started
  surfacing affected generator stacks and compatibility rules for free.
  Added a real 30-minute on-disk build cache (`buildGraphCached()`,
  ~15-20s cold → ~1ms cached, the same pattern `packageIntel.js` already
  uses) and batched the installed-package probe. Added SVG export (a
  real, hand-rolled, dependency-free generator) and documented PNG as
  deliberately not supported. Added a first-ever TUI page for the graph
  (`G`), and along the way found and fixed a real test-isolation issue
  (an unmount guard needed `useRef`, not a plain object, to correctly
  guard a later reload from a stale closure). See
  `docs/EnvironmentGraph.md`.

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
