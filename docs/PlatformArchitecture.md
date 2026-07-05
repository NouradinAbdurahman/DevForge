# Platform Architecture (v1.1 - v2.x)

This document defines the complete, cross-phase architecture for
DevForgeKit's evolution from a bash provisioning toolkit into a long-lived
CLI platform. Sections for Phase 1 describe what is **built and shipped**.
Sections for Phases 2-5 describe **design intent only** - they are not
implemented yet, but the Phase 1 formats, schemas, and boundaries below
were chosen specifically so that building them later never requires a
breaking change to anything Phase 1 ships.

The roadmap this document supports:

| Version | Codename            | Status                    |
|---------|---------------------|----------------------------|
| v1.1    | Platform Core        | **Shipped** (CLI framework, registry/plugin format, 10 example components) |
| v1.1.1  | Registry Expansion   | **Shipped** (115 components/18 categories, collections, search, dependency graph, rich metadata, Registry Builder - this document's updates) |
| v1.1.2  | Profiles & Configuration | **Shipped** (125 components/19 categories, 50 environment profiles, profile create/export/import/search, `~/.config/devforgekit/config.yaml`, `stats`, `registry stats`, rich `info`, search filters - this document's updates) |
| v1.1.3  | Component Ecosystem + Package Quality | **Shipped** (250 components/35 categories, live-measured install time, `documentation`/`architectures`/`stability`/`lastVerified`/`ciVerified` quality fields, per-component Manifest Quality Score with opt-in live reachability checks, `registry stats`' `qualityScore`/`ciVerifiedCount` - this document's updates) |
| v1.2.0  | Plugin SDK            | **Shipped** (plugin create/test/build/package/publish/install lifecycle, install lifecycle events, plugin dependencies, real Ed25519 signing + trust model, generated plugin README - this document's section 4 updates. Hosted marketplace/remote index/`plugin search` remain design-only) |
| v1.2.1  | Recipe Engine         | **Shipped** (`registry/recipes/` + `recipe.schema.json`, 8 built-in recipes, `recipe list/show/install/create/import/search/publish`, `configure`/`verify` steps on top of the profile-shared installer - this document's section 5 updates. Pulled forward from v1.3's Developer Toolbox below since it was the single highest-priority unbuilt item) |
| v1.2.2  | Project Generator     | **Shipped** (`devforgekit new <stack> [name]`, 16 stacks, optional official-CLI scaffolding + hand-written file layering via a shared generator contract, `git init` - this document's section 8 updates. Pulled forward from v1.3's Developer Toolbox below since it was the next highest-priority unbuilt item) |
| v1.2.3  | Interactive Terminal Dashboard | **Shipped** (full-screen Ink TUI, 13 pages, global search, four themes, suspend/resume for terminal-owning work - this document's section 20 updates) |
| v1.2.4  | Workspace Manager     | **Shipped** (isolated per-project environments - git/SSH/env/docker/kubernetes/cloud identity and shell state switched with one command, health verification, point-in-time snapshots + rollback, portable export/import bundles, a 14th dashboard page - this document's section 21 updates. Pulled forward from the general roadmap note below since it was the next highest-priority unbuilt item) |
| v1.2.5+ | Ecosystem             | Design only (remote/hosted registry + marketplace, registry-driven profiles fetched over the network, 500-800+ components) |
| v1.3    | Developer Toolbox     | Design only (dependency resolver v2/auto-conflict-handling, AI-assisted doctor, self-update - recipes shipped early as v1.2.1, project generators shipped early as v1.2.2, above) |
| v2.0    | Cloud Platform        | Design only (sync, cross-platform, GUI) |
| v2.x    | Community             | Design only (docs site, marketplace, SDK) |

---

## 1. Layering

```text
Layer 1  Bootstrap        bash 3.2, zero prerequisites (bootstrap.sh, scripts/*.sh, common.sh)
Layer 2  Core CLI         Node.js, installed by Layer 1 via mise (cli/)
Layer 3  Plugins          manifest + optional hook script, any runtime (plugins/*)
Layer 4  Components       declarative package manifests, installed by Layer 2 (registry/*)
```

**The rule that must never be broken:** Layer 1 never requires Layer 2 to
exist or run. A brand-new Mac has no Node, no npm, and no `cli/`
dependencies installed - `./bootstrap.sh` provisions Homebrew, mise, and
every dotfile/service using nothing but the stock `/bin/bash`. Layer 2 is
installed *by* Layer 1 (via the `node = "lts"` pin already in
`mise.toml`) and only ever adds capability on top; it never replaces or
re-implements Layer 1's OS-mutating logic. Every Layer 2 command that
corresponds to an existing bash script (`update`, `backup`, `restore`,
`services`, `clean`, `release`, `preferences`, `inventory`, `report`,
`validate`) wraps that script via a spawn bridge (`cli/src/core/shell.js`)
rather than reimplementing it - this is deliberate: those scripts are
already battle-tested (see `CLAUDE.md`'s bash-3.2 and `set -e`/pipefail
sections) and rewriting them would only add regression risk for no
benefit. Layer 2 native code is reserved for genuinely new capability that
doesn't exist in bash at all: plugins, the component/package registry, and
layered configuration.

Layers 3 and 4 are both *manifest-driven extension points* owned by Layer
2: plugins add new commands, components describe installable software.
Neither requires touching Layer 2's own source to extend - that's the
"more extensible, not just larger" property every later phase depends on.

## 2. CLI command structure

The root `devforgekit` file (unchanged in spirit - still the single
dispatcher symlinked onto `PATH` by `install_global_command` in
`common.sh`) now has two dispatch paths:

- `install`/`bootstrap` always `exec bootstrap.sh` directly - never
  through Node, since Node itself may not exist yet.
- Every other command: if `node` is on `PATH` **and** `cli/node_modules`
  exists, `exec node cli/bin/devforgekit.js "$cmd" "$@"`. Otherwise, fall
  back to the original case-arm dispatch table (unchanged), so the CLI
  works identically before Node/`cli/` deps have ever been installed.

Once delegated to Node, `cli/src/index.js` builds one `commander` `Program`
and registers one module per command from `cli/src/commands/`. Adding a
new top-level command means adding one file there and one
`registerXCommand(program)` call in `index.js` - it mirrors the existing
"`devforgekit` is a pure dispatcher, one case arm per command" convention,
just one layer up.

Command aliases (`bootstrap` -> `install`, `prefs`/`preferences` ->
`preferences`, `cleanup`/`clean` -> `clean`) are declared with
commander's `.alias()`/`.aliases()` on the command definition, not as
separate case arms - one place to keep them in sync with `--help`.

## 3. Package registry format

```text
registry/
├── schema/
│   ├── package.schema.json      # JSON Schema (draft 2020-12), validated with ajv
│   ├── category.schema.json
│   ├── collection.schema.json
│   └── profile.schema.json
├── categories/    # 35: languages, package-managers, databases, containers,
│                  # cloud, kubernetes, devops, editors, fonts, terminals,
│                  # browsers, ai, utilities, security, game-development,
│                  # design, frontend, backend, mobile, networking,
│                  # monitoring, media, embedded, ci-cd, build-systems,
│                  # testing, package-signing, code-quality, documentation,
│                  # api-development, web, desktop, apple-development,
│                  # android, reverse-engineering
├── packages/      # 250 component manifests (see below)
├── collections/   # 17 curated bundles (see below)
├── profiles/      # 50 environment profiles - compose collections + components + settings
└── registry.json  # generated - do not hand-edit, see "Registry Builder"
```

Every `packages/*.yaml` file is one component manifest:

```yaml
schemaVersion: 1
name: docker
description: Container runtime and CLI for building/running containers
category: containers
platforms: [macos]
variants:
  - id: docker-desktop
    label: Docker Desktop
    install: { method: brew-cask, id: docker }
  - id: colima
    label: Colima (lightweight, open-source)
    install: { method: brew-formula, id: colima }
dependencies: []
validate: docker info
repair: brew reinstall --cask docker
update: brew upgrade --cask docker
uninstall: { method: brew-cask, id: docker }
post_install:
  - "open -a Docker"
homepage: "https://www.docker.com"
repository: "https://github.com/docker/cli"
license: Apache-2.0
maintainer: DevForgeKit Registry
tags: [containers, devops, virtualization]
aliases: [docker-desktop]
```

Required fields: `schemaVersion`, `name`, `description`, `category` (must
match a `categories/*.yaml` id), `platforms`, and either `install` or
`variants` (the "Docker Desktop vs Colima" chooser - each variant carries
its own `install`). `install.method` is one of `brew-formula`,
`brew-cask`, `npm`, `pip`, `cargo`, `mise`, or `shell` (a free-form
command); an optional `tap` field taps a Homebrew tap first (e.g.
`hashicorp/tap` - this repo's own `Brewfile` already uses one) before a
`brew-formula`/`brew-cask` step.

Optional fields, all additive under `schemaVersion: 1` (only a breaking
change would bump it - see section 14): `dependencies`/`conflicts`
(arrays of other package names - dependencies are resolved automatically,
conflicts are recorded but not yet enforced at install time), `repair`/
`update` (shell commands, distinct from `validate`), `post_install`
(array of shell commands), metadata purely for humans/search:
`homepage`, `repository`, `license`, `maintainer`, `tags`, `aliases`
(alternate search terms, e.g. `postgres` -> `psql`/`pg`), and the v1.1.3
**Package Quality System** fields: `documentation` (a docs URL distinct
from `homepage`/`repository`), `architectures` (CPU architecture -
`intel`/`apple-silicon`/`linux` - distinct from the OS-level `platforms`),
`stability` (`stable`/`beta`/`deprecated`), `lastVerified` (`YYYY-MM-DD`,
the date a human/process last confirmed the manifest's commands are
accurate), and `ciVerified` (true only for the handful of packages
`registry-smoke.yml` actually installs/validates/uninstalls live - see
section 16). **"Install size" and "install time" are deliberately not
stored fields** - a hand-authored number would drift out of date
immediately (size) or is meaningless as a single number (time varies by
network/cache/hardware) and can't be verified from this repo. Both are
computed **live** instead: `devforgekit info <name>` runs `du -sh` on the
actual Homebrew Cellar/Caskroom path for size (v1.1.2); `core/
installer.js`'s `installPlan()` measures real wall-clock elapsed time per
step and `lib/installRunner.js` reports it (v1.1.3) - "docker installed
in 8.2s" is an observation, not a guess.

Phase 1 shipped the format, loader, and 10 example manifests. v1.1.1 grew
that to 115 across 18 categories; v1.1.2 added 10 more (125/19); **v1.1.3
added 125 more across 16 new categories** - languages (C/Haskell/OCaml/
Perl/R/Julia/Clojure/Nim), package managers (Poetry/uv/Volta/asdf/Maven/
Gradle/Miniconda), databases (CockroachDB/DuckDB/Qdrant/Chroma/ArangoDB/
MinIO - vector/graph/object-storage covered via `tags`, not new
categories, consistent with how every category is a broad bucket), and
whole new categories for networking, monitoring, media, embedded, CI/CD,
build systems, testing, package signing, code quality, documentation,
API development, web, desktop, Apple development, Android, and reverse
engineering - **250 manifests across 35 categories** today. Reaching the
longer-term 500-800 goal is **incremental, future batches**: one new
`packages/*.yaml` file, zero code changes, per addition - every session
so far has intentionally stopped short of padding the count with
invented tools just to hit a bigger number, and this one is no
different.

### Collections

`registry/collections/*.yaml` are named bundles of component names:

```yaml
schemaVersion: 1
name: backend
description: A typical backend service stack
components: [node, postgres, redis, docker, git, vscode]
```

`devforgekit collection install <name>` resolves every member's
dependencies (below) and installs the whole set in one pass. 17
collections ship today (Backend, Frontend, Flutter, React, Next.js,
Python AI, Machine Learning, Data Science, Game Development, DevOps,
Cloud, Cybersecurity, UI/UX, Mobile, Full Stack, Student, Minimal) -
adding another is one YAML file, same as a package.

### Search

`core/registry.js`'s `searchPackages(query)` ranks matches: exact name >
name substring > alias > tag > category > description substring,
case-insensitive. `devforgekit search <query>` is the command surface;
`registry.json`'s `searchIndex` (below) is the same data pre-flattened
for anything that wants to search without loading every YAML file.

### Dependency resolution

`core/installer.js`'s `resolveInstallOrder(names)` is a DFS-based
topological sort over each package's `dependencies`: requesting `flutter`
resolves to `[dart, java, android-studio, flutter]` (`dart` and `java`
first, since `flutter` and `android-studio` both depend on `java`, and
each name appears exactly once even when multiple requested components
share a dependency). A cycle throws a clear `DevForgeError` instead of
recursing forever. `installPlan()` runs the resolved plan in order,
skipping any step whose `validate` command already passes ("already
satisfied"). Both `component install` and `collection install` share
this - see `cli/src/lib/installRunner.js` for the UI layer (prints the
resolution order, drives a progress bar, reports PASS/skip/FAIL per
step).

### Registry Builder

`devforgekit registry generate` is the one command that touches the
generated artifacts: it loads and cross-validates every category,
package, collection, and profile (this doubles as a build-time integrity
check - see `checkIntegrity()`/`loadRegistry()` in `core/registry.js`,
which catches a package referencing an unknown category/dependency/
conflict, a collection referencing an unknown component, or a profile
referencing an unknown collection/component, listing every problem at
once), then rewrites `registry/registry.json` (a compiled index: sorted
categories/packages/collections/profiles plus the flat `searchIndex`)
and `docs/Registry.md` (an auto-generated, clearly-marked "do not
hand-edit" catalog). Output is deterministic (stable sort keys) so
regenerating twice produces byte-identical files - CI (`cli.yml`) runs
`registry generate` and fails the build if the committed files drifted
from a fresh run, the same "generated file must match source" pattern
many codegen pipelines use. `registry.json` is also the artifact a
**future** hosted/remote registry (section 4's marketplace, still
design-only) would eventually serve - generating it locally today costs
nothing and proves the pipeline end-to-end before any network layer
exists.

### Manifest Quality Score

`core/quality.js`'s `scoreManifest(pkg)` is the objective, per-component
standard contributors are held to as the registry scales past 250
entries - ten equally-weighted checks, each worth 10 points:

```text
Quality Score: 60/100

✓ Schema valid          (always true here - loadPackages() already
                          rejected anything that fails ajv validation
                          before a pkg object exists to score)
✓ Homepage present       (or "reachable" - see below)
✓ Repository present     (or "reachable" - see below)
✓ License detected       (pkg.license set)
✗ Install tested         )
✗ Verify tested          ) all three key off `ciVerified` - the only
✗ Uninstall tested       ) real evidence available (registry-smoke.yml's
                            live install -> validate -> uninstall ->
                            re-validate sequence)
✓ Rollback available     (pkg.uninstall defined)
✓ Health check exists    (pkg.validate defined)
✗ Documentation exists   (pkg.documentation set)
```

Split deliberately into two tiers: the eight checks above are
**structural** - synchronous, zero network calls, safe to run across the
whole registry in tests/CI (`registry stats`' `qualityScore` is the
average of these). The **Homepage**/**Repository** checks are the only
ones needing a live HTTP request; `checkLiveReachability()` does a real
`fetch` (HEAD, falling back to GET) with a timeout, but only runs when a
caller explicitly opts in (`devforgekit info <name> --live`) - never
automatically, for the same reason `registry-smoke.yml` stays a narrow,
deliberately-scoped live check rather than testing all 250 packages'
external URLs on every push: slow, and dependent on third-party servers
staying up. Without `--live`, those two checks report "present" (a
weaker, honest claim - the field exists, reachability wasn't verified),
never a fabricated "reachable."

### Registry Analytics

`devforgekit registry stats` (`getRegistryStats()` in `core/registry.js`)
computes, from the already-validated registry: totals per kind;
dependency-graph shape (edge count, most-depended-upon package);
duplicate aliases (two packages claiming the same name/alias - a real
correctness bug schema validation alone can't catch, since two files can
each be individually valid - this exact check caught a real collision
during v1.1.3's authoring, `gcc` claimed by both `c` and `cpp`, before it
shipped); orphaned manifests (a package no collection or profile
references - not an error, just a signal); the largest collection/
profile; a metadata-completeness score (% of packages with `homepage`+
`license`+`tags` all present, unchanged, distinct from the newer score);
**`qualityScore`** - the average per-package Manifest Quality Score
across the whole registry (structural checks only, so this stays
synchronous); and **`ciVerifiedCount`** (a plain count, not a
percentage - live-verifying every component is neither feasible nor the
goal, so this just reports current real coverage). This is analytics on top of
`checkIntegrity`'s pass/fail validation, not a replacement for it.

### Rich info

`devforgekit info <name>` (distinct from `component info`, which stays
raw JSON for scripting) pretty-prints a package's full metadata plus
computed fields: **alternatives** (other packages sharing its category,
capped at 5), a **live** install size (`du -sh` on the actual Homebrew
Cellar/Caskroom path for an installed `brew-formula`/`brew-cask`
package, `"not installed"` otherwise - never a stored, guessable number),
and its **Manifest Quality Score** (above) - structural checks by
default, or the full live-reachability version with `--live`.

## 4. Plugin API

**v1.2.0 ships a full local Plugin SDK**: create -> test -> build ->
package -> publish -> install, plus lifecycle events, plugin
dependencies, digital signatures, and a documentation generator. The one
piece that remains design-only is a *hosted* marketplace (remote index,
`plugin search`, discovery UI) - everything else below is real, working
code with no mocking.

```text
plugins/<plugin-name>/
├── plugin.yml
├── plugin.lock.json        # written by `plugin build` - per-file SHA-256 + builtAt
├── README.md                # generated by `plugin build` from the manifest
├── commands/*.sh
├── hooks/*.sh
└── tests/*.sh
```

### Manifest format (schema v2, `cli/src/schemas/plugin.schema.json`)

```yaml
schemaVersion: 1
name: my-plugin
version: 0.1.0
description: A plugin that does X
author: Jane Doe            # optional
license: MIT                 # optional
homepage: "https://..."       # optional
engine: ">=1.0.0"             # semver range checked against the repo's VERSION file
dependencies: []               # optional - names of other plugins this one requires
commands:                       # zero or more commander subcommands
  - name: hello
    description: Print a greeting
    run: ./commands/hello.sh
    timeoutMs: 30000             # optional, default 30000
events:                           # zero or more lifecycle-event subscriptions
  - event: install.afterInstall
    run: ./hooks/after-install.sh
    description: Notify after any component install
    timeoutMs: 30000
```

At least one of `commands`/`events` is required (checked in
`validatePluginManifest()`, `cli/src/core/plugins.js` - the same "at
least one of X/Y" pattern `registry/profiles` already uses). The one
in-repo example, `plugins/hello-world`, uses this shape.

### Discovery and execution

`cli/src/core/plugins.js`'s `discoverPlugins()` scans two roots -
repo-local `plugins/` and user-installed `~/.devforgekit/plugins/` -
validates each manifest against the schema (ajv) plus the
commands-or-events check, and checks `engine` against the current
`VERSION` with `semver.satisfies`. Valid manifests get every `commands[]`
entry registered as a live `commander` subcommand
(`registerPluginCommands`) and every `events[]` entry subscribed to the
in-process `pluginEvents` `EventEmitter` (`registerPluginEventHooks`,
`cli/src/core/events.js`). Today exactly one event fires:
`install.beforeInstall`/`install.afterInstall`, emitted once per package
from `installer.js`'s `installPlan()` with `{ name, category }` before
and `{ name, status, code, durationMs }` after. A broken event hook logs
a warning and is skipped - it never crashes the CLI.

Every hook/command script runs through `runShellCommand` with a
`timeoutMs` (default 30000ms, `SIGTERM` on expiry). This is
**resource/time isolation, not a security sandbox** - a plugin script
still has the full filesystem/network access of the user running it.
Real sandboxing (containers/VMs restricting what a script can touch)
is out of scope for a local CLI and is not claimed anywhere in the UI
or docs.

### Lifecycle commands (`cli/src/core/pluginSdk.js`, wired via `commands/plugin.js`)

- **`plugin create <name> [dir]`** - scaffolds `plugin.yml`,
  `commands/hello.sh`, `hooks/after-install.sh`, `tests/manifest.test.sh`,
  all runnable out of the box (the generated test actually invokes the
  generated command and checks its exit code).
- **`plugin test [dir]`** - validates the manifest, checks every
  referenced command/event script exists, and runs every `tests/*.sh`
  as a subprocess, returning a PASS/FAIL score via the same
  `scoreResults()` scoring function `core/health.js` already uses.
- **`plugin build [dir]`** - re-validates (must pass), regenerates
  `README.md` from the manifest (the documentation generator - static
  generation from data already on disk, same pattern `registry
  generate` uses for `docs/Registry.md`), and writes
  `plugin.lock.json` (a SHA-256 per file, via `node:crypto`).
- **`plugin package [dir] --out <dir>`** - builds if needed, shells out
  to the system `tar -czf` (reusing the existing `runShellCommand`
  bridge rather than adding a tar/zip npm dependency), computes the
  archive's SHA-256, and - via `core/signing.js` - writes a `.sha256`
  and an Ed25519 `.sig`, auto-generating a local signing key on first
  use. Defaults the output directory to the plugin directory's *parent*
  (packaging into the plugin's own directory makes `tar` try to archive
  its own in-progress output file).
- **`plugin publish <archive> --to <dir>`** - copies the archive plus
  its `.sha256`/`.sig` into a destination directory (default
  `~/.devforgekit/published-plugins/`) and updates an `index.json`
  there. This is **local artifact staging** ("publish" = write to a
  directory you can then rsync/host anywhere yourself), **not a hosted
  marketplace** - there is no remote index, search, or discovery service.
- **`plugin install <path-or-url> [-y]`** - accepts a local `.tar.gz` or
  an `http(s)` URL (via Node's built-in `fetch`). Verifies the SHA-256
  always, hard-failing on mismatch (integrity is non-negotiable, never
  downgraded to a warning). Verifies the signature against
  `loadTrustedKeys()`; if unsigned or signed by an untrusted key, warns
  and requires confirmation (`-y`/`DEV_SETUP_ASSUME_YES` to skip).
  Extracts into `~/.devforgekit/plugins/<name>/` and cross-checks
  declared `dependencies` against currently-discoverable plugins,
  warning (not blocking) on anything missing.
- **`plugin trust <pubkey>`** / **`plugin keygen`** - manage this
  machine's trust model (below).

### Digital signatures - real crypto, honest trust model

`cli/src/core/signing.js` uses Node's built-in `node:crypto` Ed25519
support - genuine keygen/sign/verify, nothing fabricated.
`ensureSigningKey()` lazily generates a keypair at
`~/.config/devforgekit/plugin-signing-key{,.pub}` on first use.
**There is no certificate authority or marketplace trust registry.**
Trust today means "signed by a key you've explicitly told this machine
to trust": your own local key is always trusted (self-signed plugins
install without a prompt); anyone else's key must be added first via
`plugin trust <path-to-their.pub>`, after which their signed packages
install without a prompt too. A full PKI/marketplace trust model
remains v2.0 design-only (below).

### Plugin/Profile Marketplace Architecture (design only - remote index/search/discovery UI, not built)

Everything in this subsection is still unbuilt. What v1.2.0 ships
(package/publish/install/checksums/signatures, above) covers the
*mechanics* of distributing a signed, verified plugin artifact - what's
missing is a *hosted, searchable index* that lets someone discover a
plugin without already having its file or URL:

- **a remote index** - hosted JSON/YAML (e.g. a GitHub raw URL, or a
  real backend) listing available plugins/profiles by
  name/version/download URL/checksum.
- **`plugin search`** - queries that index; today `plugin install` only
  accepts a path or URL you already have.
- **an account/auth model for publishing to the shared index** - today's
  `plugin publish` writes to a directory *you* control; publishing to
  someone else's/a shared index needs auth this repo has no opinion on
  yet.
- **the same design serves `profile publish`/`profile search`** (section
  5) - one remote index format, one client workflow, since a published
  profile is just another manifest a marketplace hosts. Discovery roots
  for both (`~/.devforgekit/plugins/<name>/` and
  `~/.config/devforgekit/profiles/<name>.yaml`) already exist today, so
  nothing about *local discovery* changes when a remote index lands -
  only a fetch/search step in front of it.

None of this is implemented - `profile publish`/`profile search` and a
`plugin search` against a remote index remain stubs/design until this
phase is actually built.

## 5. Profile and recipe systems

Two distinct, deliberately coexisting concepts, both reachable under the
single `devforgekit profile` command (v1.1.2):

**Bootstrap profiles (Layer 1, unchanged since before this platform
work):** `profiles/<name>/Brewfile` + `README.md`,
`profile_brewfile_path()`/`resolve_profile()` in `common.sh`,
`.devprofile` state file, `scripts/profile.sh`. Answer "what do I
bootstrap a fresh machine with" - a Brewfile subset selected via
`bootstrap.sh --profile`. `profile use <name>` in `cli/src/commands/
profile.js` forwards to `scripts/profile.sh use <name>` unchanged.

**Environment profiles (Layer 2, new in v1.1.2):**
`registry/profiles/*.yaml` + `registry/schema/profile.schema.json`.
Answer "what do I install on an already-bootstrapped machine to
reproduce an environment." A profile composes one or more **collections**
(section 3, `collections: [backend, frontend]`) plus extra ad hoc
**components** (`components: [supabase]`) plus optional suggested config
**settings** (`settings: { editor: vscode }`) - deliberately *not* a
replacement for collections, but a richer layer built from them, per an
explicit product decision to keep the two primitives distinct. 50
profiles ship today across development (single-language profiles, plus
`full-stack`/`backend`/`frontend`/`flutter`/`react`/`nextjs`/`mobile`),
AI (`ai`, `deep-learning`, `llm-engineering`, `ai-research`, `mlops`,
`machine-learning`, `data-science`), cloud (`aws`, `azure`, `gcp`,
`firebase`, `supabase`, `kubernetes`, `platform-engineer`, `devops`,
`cloud`), security (`ethical-hacking`, `penetration-testing`,
`soc-analyst`, `malware-analysis`, `digital-forensics`, `cybersecurity`),
design (`ui-ux`, `figma`, `motion-design`), students
(`computer-science`, `software-engineering`, `student`,
`game-development`), and companies (`startup`, `enterprise`, `minimal`,
`remote-worker`).

`cli/src/core/registry.js`'s `loadProfiles()` discovers profiles from
**two roots** - the repo's `registry/profiles/` (shipped, reviewed) and
the user's own `~/.config/devforgekit/profiles/` (personal, written by
`profile create`/`profile export`) - the same multi-root pattern
`core/plugins.js` already uses, so a user's custom profile never needs a
PR to this repo. `expandProfile(profile)` resolves `collections[]` +
`components[]` into one deduplicated package-name list, fed into the
same `resolveInstallOrder()`/`installPlan()` dependency-graph machinery
components and collections already use (section 6).

`profile install <name>` installs the resolved set and applies any
`settings` to the user's config (section 7). `profile create` is an
interactive wizard (editor/browser/terminal/cloud/AI/languages/
databases/containers/fonts, `lib/prompts.js`) that writes a new user
profile. `profile export [name]` inspects the machine (runs every
component's `validate` and includes whichever pass) and writes a profile
reflecting *actual, live* installed state - never a guess. `profile
import <file>` installs an arbitrary local YAML file without requiring
it to be registered anywhere first - "reproduce another machine" from a
file someone sent you. `profile search <query>` searches collection and
profile names/descriptions locally. `profile publish` is a deliberate
**stub** (matches the `devforgekit uninstall` stub pattern) - publishing
to a community registry needs the marketplace infrastructure described
in section 4, which is design-only (see "Plugin/Profile Marketplace
Architecture" below); it prints what will eventually happen and exits
non-zero rather than pretending to work.

### Recipes (v1.2.1 - shipped)

A recipe (`registry/recipes/*.yaml` + `registry/schema/recipe.schema.json`,
`devforgekit recipe <action>`) is a lighter-weight, opinionated sibling of
an environment profile - the "recipes" item promised earlier on this
roadmap (originally scoped under v1.3's Developer Toolbox, pulled forward
because it's the highest-priority near-term feature and needed nothing
from v1.3's other, still-unbuilt items). A recipe reuses a profile's exact
`collections`/`components` shape and dependency-resolving installer
(`cli/src/core/registry.js`'s `expandRecipe` is a named wrapper around
`expandProfile` - the resolution logic is identical), then adds two things
a profile doesn't have:

- **`configure`** (`git`/`vscode`/`cursor`/`shell`/`mise`) - cross-cutting
  dotfile/environment restoration, each a thin call into the exact Layer 1
  function `scripts/restore.sh` already runs for the same purpose
  (`restore_git`/`restore_editor`/`restore_zsh`/`restore_mise` in
  `scripts/common.sh`). `cli/src/core/recipes.js`'s `runConfigureStep`
  sources `common.sh` in a fresh bash process and calls the one function
  needed, rather than adding a new Layer 1 script or CLI flag - zero
  changes to Layer 1 at all. Tool-specific setup (an AI recipe "configuring
  Ollama," say) is deliberately **not** a `configure` action - that's
  already a package's own `post_install` steps (`registry/packages/
  ollama.yaml` pulls/starts it after install), not something the recipe
  engine should special-case.
- **`verify`** (boolean, default `true`) - after install + configure,
  `core/recipes.js`'s `verifyComponents` runs every resolved component's
  `validate` command (the same check `installPlan` uses to decide
  "already satisfied") and reports an explicit PASS/FAIL/skip summary
  instead of a silent skip decision - the recipe's "verify everything"
  step from the product brief's example.

`recipe install <name>` therefore runs install -> configure -> apply
`settings` (identical to a profile's) -> verify in one command
(`cli/src/commands/recipe.js`'s `installRecipeDoc`, shared by both
`install <name>` and `import <file>` so the two commands can't drift).
Discovery is the same two-root pattern profiles/plugins already use -
`registry/recipes/` (8 built-in: `ai-engineer`, `flutter-developer`,
`backend-developer`, `devops-engineer`, `cybersecurity-lab`,
`game-developer`, `ml-engineer`, `embedded-engineer`) plus
`~/.config/devforgekit/recipes/` (personal, `recipe create` output) - and
`checkIntegrity()`/`loadRegistry()`/`getRegistryStats()` all treat
recipes as a first-class fourth bundle kind alongside collections/
profiles (referential integrity, total counts, largest-bundle/orphan
computations). `recipe publish` is a deliberate stub, identical in spirit
to `profile publish` - it needs the same marketplace infrastructure
described above. Full command reference and the built-in recipe table:
[CLI.md](CLI.md) and [Recipes.md](Recipes.md).

## 6. Component system

`cli/src/core/installer.js` is the generic executor for any manifest
produced by `registry.js`: given a package name (and optional variant id),
it dispatches on `install.method` to the right shell-out (`brew install
<id>`, `brew install --cask <id>`, `npm install -g <id>`, `pip install
<id>`, `cargo install <id>`, `mise use -g <id>`, or a raw `shell` command),
then runs any `post_install` steps. `validate`/`repair`/`uninstall` are
just the corresponding manifest command run through the same executor.
`cli/src/commands/component.js` exposes `list` (grouped by category,
optionally filtered), `info <name>`, `install [name...]` (interactive
multiselect via `prompts.js` when no name is given - the "Docker Desktop /
Colima / OrbStack checkbox" UX), `validate <name>`, `repair <name>`,
`uninstall <name>`.

## 7. Configuration system

Layered, lowest to highest precedence:

1. Built-in defaults (in code, `cli/src/core/config.js`)
2. Repo-level `.devforgekit.yml` (checked in, team-shared defaults)
3. User-level **`~/.config/devforgekit/config.yaml`** (personal
   overrides - moved here in v1.1.2, from `~/.devforgekit/config.json`,
   to the conventional XDG config location; format is YAML throughout,
   read/written with `js-yaml`)
4. Environment variables (`DEVFORGEKIT_*`, plus continued recognition of
   the existing `DEV_SETUP_ASSUME_YES` so Layer 1 and Layer 2 agree on
   the same "assume yes" signal)
5. CLI flags (highest, per-invocation)

`devforgekit config get <key>` / `set <key> <value>` / `list` operate on
the user-level file (layer 3); the repo file is edited by hand/PR, like
`mise.toml`. Fields as of v1.1.2: `editor`, `shell`, `packageManager`,
`fonts` (array), `browser`, `aiProvider`, `defaultProfile`,
`updateSchedule`, `telemetry`, `mirrors` (array), `registryUrl`,
`colorOutput`. **`mirrors`, `registryUrl`, and `updateSchedule` are
stored and settable today but not yet *consumed* by anything** - no
remote registry fetch or update scheduler exists yet (that's v1.2+,
section 4/19) - stated explicitly here rather than left to look wired up
when it isn't. `profile install`/`import` write a profile's `settings`
into this same layer (`core/config.js`'s `setConfigValue`), which is how
a profile "suggests" preferences without forcing them - installing a
profile's components always happens; applying `settings` happens right
after, as a separate, visible step.

User-created **profiles** (section 5) live alongside this file, at
`~/.config/devforgekit/profiles/*.yaml` - personal-preference data
belongs next to personal-preference config, both outside the repo.

**Phase 4 (design only)** adds a new layer between layers 3 and 4: a
remote/cloud profile fetched after authentication, so a team's shared
settings can override a personal default but a local flag still wins for
a one-off invocation. Because the loader is already a simple
ordered-merge of plain objects, adding a layer is a one-function change
in `config.js`, not a redesign.

## 8. Template system and Project Generator

`templates/` (14 existing, independent, copyable starter projects) stays
exactly what it was - a static, self-contained, `cp -r`-and-go extension
point (see [Templates.md](Templates.md)). It is **not** replaced by the
Project Generator below; the two solve different problems. A template is
"here's a folder, copy it and rename things yourself." The Project
Generator is "ask me a few questions and I'll assemble a project that
matches your answers" - parameterized, and, where a stack has one,
scaffolded through the stack's own official CLI rather than a frozen
snapshot that drifts out of date.

### `devforgekit new <stack> [name]` (v1.2.2 - shipped)

Every stack under `cli/src/generators/*.js` implements the same small,
duck-typed contract - `cli/src/core/projectGenerator.js`'s
`runProjectGenerator(generator, { name, parentDir, options })` is the one
place that actually walks it, so no individual generator duplicates this
sequence:

1. **Refuse to clobber** an existing, non-empty target directory (the
   same safety `plugin create` already applies).
2. **`requiresTool`** (optional `{ command, hint }`) - checked with a
   Node counterpart of `common.sh`'s `command_exists`
   (`core/shell.js`'s `commandExists`) *before* shelling out, so a
   missing `flutter`/`dotnet`/`composer`/`curl` fails with "`flutter` is
   not installed - run: `devforgekit component install flutter`" instead
   of a raw, confusing error three levels down inside a spawned process.
3. **`promptOptions(flags)`** (optional) - each generator prompts for
   its *own* stack-specific choices (Flutter's state management/backend,
   Express's auth/Prisma/Swagger/Docker toggles, ...) using the same
   `lib/prompts.js` primitives `profile create`/`recipe create` already
   use, short-circuited by whatever flags `commands/new.js` already
   parsed from argv - so `devforgekit new flutter my-app --state
   riverpod` skips that one prompt, and a fully-flagged invocation
   prompts for nothing.
4. **`scaffold({ name, parentDir, dir, options })`** (optional) - for
   stacks with a real official generator, shells out to it: `flutter
   create`, `create-next-app`, `create-expo-app` (used for both the Expo
   and bare-workflow React Native generators - the latter via its
   `bare-minimum` template, which produces real native `ios/`/`android/`
   folders through a CLI that's actually reliable non-interactively,
   rather than the legacy `react-native init`), the Nest CLI,
   `django-admin`, `composer create-project laravel/laravel`, `dotnet new
   webapi`, `create-tauri-app`, or - for Spring Boot, which has no local
   CLI prerequisite at all - a direct call to the **Spring Initializr
   REST API** (`start.spring.io`) via `curl`/`unzip`, so scaffolding a
   Spring Boot project needs no local Java/Maven install, only to build
   it afterward.
5. **`generate({ name, dir, options })`** (optional) - hand-written
   files layered on top (or, for stacks with no official CLI at all -
   Express, FastAPI, Django's extras, Go Fiber, Rust Axum, Electron -
   the *entire* project). Every generator composes shared, stack-agnostic
   pieces from `generators/shared.js` (MIT license text, `.editorconfig`,
   `.vscode/settings.json`, a common README shape, a shared Node CI
   workflow) rather than each reinventing them.
6. **`postGenerate`** (optional) - for the rarer case where a layered
   file needs to *modify* something the scaffold step already produced,
   not just add a new file (e.g. Next.js's generator adds shadcn/ui's
   dependencies into the `package.json` `create-next-app` already wrote).
7. **`git init`** (skippable per generator via `skipGitInit`).

**The 16 supported stacks**: Flutter (Clean Architecture - `core`/
`data`/`domain`/`presentation` - Riverpod or Bloc, Supabase or Firebase,
CI via `subosito/flutter-action`), Next.js (TypeScript, Tailwind,
shadcn/ui, Prettier, Husky + lint-staged, Docker standalone build),
Express (JWT auth, Prisma + PostgreSQL, Swagger/OpenAPI, Docker +
docker-compose), React (Vite), React Native (bare workflow), Expo,
NestJS, FastAPI, Django, Laravel, Spring Boot, ASP.NET, Go Fiber, Rust
Axum, Tauri, and Electron. Every one ships a GitHub Actions CI workflow,
a README, and - where it makes sense for the stack - a Dockerfile and a
test suite. Full per-stack reference: [ProjectGenerator.md](ProjectGenerator.md).

Two correctness properties worth calling out because they were real bugs
caught while building this, not hypothetical ones:

- **`app.js`/`server.js` split (Express)** - the generated app is
  exported from a file that never calls `.listen()`; only a separate
  entry point does. Merging them into one file (the obvious first draft)
  meant Supertest importing the app for `tests/health.test.js` also
  opened a real socket that never closed, and Jest printed "did not exit
  one second after the test run completed."
- **`npm install`, not `npm ci`, in generated Dockerfiles (Express,
  Next.js, NestJS)** - none of these generators commit a
  `package-lock.json` (Express never runs an install at all; Next.js/
  NestJS scaffold with `--skip-install`), and `npm ci` hard-requires one.
  A Docker-first user's very first `docker compose up --build`, before
  ever running `npm install` locally, would otherwise fail immediately.
  Express's Dockerfile additionally runs `npx prisma generate` when
  Prisma is enabled, before the app starts - `@prisma/client` throws
  "did not initialize yet" at import time otherwise, since the
  auth controller imports `PrismaClient` at module load. All three of
  these were caught by actually running `docker build`/`docker run`
  against a freshly generated project, not just by inspecting the
  generated files.

## 9. Diagnostics architecture

`cli/src/commands/doctor.js` and `check.js` each: (1) run the existing
`scripts/doctor.sh`/`check.sh` unchanged, with inherited stdio, so
existing output and behavior are preserved exactly; then (2) run new,
native component-validation checks (looping the registry's `validate`
commands) and print them through the same chalk-based logger in the same
PASS/WARNING/FAIL vocabulary; then (3) combine both exit codes for the
final process exit code and compute a health score (`core/health.js`)
from the native checks. A `--json` flag on `doctor`/`check` emits the
native check results as structured data - deliberately scoped to the new
native checks only (parsing the bash script's stdout would be brittle and
is not attempted). This `--json` contract is the one piece Phase 4's GUI
dashboard needs designed now: it consumes exactly this shape later,
without any redesign of the diagnostics layer itself.

## 10. Update/backup architecture

Phase 1: `cli/src/commands/update.js`/`backup.js`/`restore.js` are thin
wrappers over `scripts/update.sh`/`backup.sh`/`restore.sh` via
`shell.js` - zero behavior change, just reachable through the unified
CLI's parsing/help/aliases. **Phase 3 (design only)** adds
`devforgekit self update` (checks GitHub releases via the GitHub API,
compares against `VERSION`, pulls the new tag, re-runs bootstrap to
reconcile) and `self repair` (re-runs failed `doctor`/`check` steps'
associated fixes) as new commands layered on top - they call the existing
`update`/`doctor --fix` machinery, they do not replace it.

## 11. Extension SDK

The plugin manifest schema (`cli/src/schemas/plugin.schema.json`, section
4) *is* the SDK surface - it fully describes what a third party needs to
add a command to DevForgeKit. **Phase 5 (design only)**'s
`create-devforgekit-plugin` scaffolding tool generates exactly this
`plugin.yml` shape plus a starter hook script; it needs no new schema,
only a generator.

## 12. Directory structure

```text
dev-setup/
├── bootstrap.sh, scripts/, common.sh/colors.sh   # Layer 1, unchanged
├── devforgekit                                    # dispatcher: bash fallback + Node delegation
├── cli/                                           # Layer 2 (new)
│   ├── package.json, package-lock.json, eslint.config.js
│   ├── bin/devforgekit.js
│   ├── src/{core,lib,commands}/*.js
│   └── test/*.test.js
├── registry/                                      # Layer 4 manifests (new)
│   ├── schema/*.json
│   ├── categories/*.yaml
│   └── packages/*.yaml
├── plugins/                                       # Layer 3 manifests (new)
│   └── hello-world/{plugin.yml,hello.sh}
├── profiles/, templates/, vscode/, cursor/, reports/, preferences/  # unchanged
└── docs/, .github/workflows/                      # docs + CI, extended
```

## 13. Internal APIs

`cli/src/core/*.js` module contracts - commands depend on core, core never
depends on commands:

- **`paths.js`** - `repoRoot()`: resolves the repo root by walking up from
  the module's own location (mirrors `DEV_SETUP_ROOT` in `common.sh`).
- **`logger.js`** - `info/success/warn/error/section/step(msg)`, chalk-
  colored, plus a `--verbose`/`--debug`-gated file log under
  `~/.devforgekit/logs/`.
- **`errors.js`** - `DevForgeError` (message, exit code) and
  `withErrorHandling(actionFn)`, wrapping every command's commander
  `.action()` so failures produce one consistent, non-stack-trace message
  (full stack only with `--debug`) and the right process exit code.
- **`config.js`** - `loadConfig()` (merges the 4 layers), `getConfigValue`/
  `setConfigValue`/`listConfig`.
- **`shell.js`** - `runScript(relativePath, args) -> Promise<exitCode>`,
  spawns with inherited stdio; the only bridge to Layer 1 scripts.
- **`registry.js`** - `loadCategories()`, `loadPackages()`,
  `getPackage(name)`, each validated against the JSON Schemas at load
  time; throws a `DevForgeError` listing every validation failure at once
  (not just the first) so a bad manifest is fast to fix.
- **`plugins.js`** - `discoverPlugins()`, `registerPluginCommands(program)`.
- **`installer.js`** - `install(pkg, variantId?)`, `validate(pkg)`,
  `repair(pkg)`, `uninstall(pkg)`.
- **`health.js`** - `scoreResults(results: {status}[]) -> {score, verdict}`,
  a direct JS port of `print_health_score`'s formula
  (`(pass*100 + warn*50) / total`) so bash and Node ever agree on what a
  given PASS/WARNING/FAIL tally means.

## 14. Versioning strategy

The repo-root `VERSION` file remains the single source of truth (already
read by `scripts/release.sh`). `cli/package.json`'s `version` field is
kept in lockstep with it rather than bumped independently - `scripts/
release.sh` is the one place a version bump happens, and it will be
extended (in a later phase, not Phase 1) to also update `cli/package.json`
when it updates `VERSION`. Two additional, narrower version knobs exist
specifically so schema evolution never breaks already-authored content:

- **Plugin `engine` field** - a semver range (checked with the `semver`
  package against `VERSION`), so a plugin written against an older/newer
  DevForgeKit can declare compatibility explicitly and fail loudly instead
  of silently misbehaving.
- **Registry `schemaVersion`** - lets `registry.js` support multiple
  manifest shapes side by side if Phase 2 ever needs to add a required
  field; Phase 1 manifests are all `schemaVersion: 1` and stay valid
  forever under that version's schema.

## 15. Compatibility strategy

The single load-bearing guarantee for every future phase: **if Layer 2
(Node/`cli/`) is missing, not yet installed, or fails to load, every
existing command still works exactly as it did before Phase 1**, via the
unchanged case-arm fallback in the root `devforgekit` file. This is why
Phase 1 wraps rather than rewrites the existing scripts, and why it is
called out explicitly here: no future phase may remove this fallback path
without an explicit, separately-approved breaking-change decision.

## 16. Testing strategy

- **Layer 1 (bash)** - unchanged: `bash -n` + ShellCheck via
  `scripts/validate.sh` and `.github/workflows/shellcheck.yml`/`lint.yml`.
- **Layer 2 (Node)** - Node's built-in test runner (`node --test`, zero
  extra dependency, available in the `node = "lts"` mise already pins).
  Tests cover: config-layer precedence (`config.test.js`), registry
  manifest validation with both valid and deliberately-broken fixtures
  (`registry.test.js`), collection loading (`collections.test.js`),
  dependency-graph resolution including a deliberate cycle
  (`dependency-resolution.test.js`, using in-memory fixtures so cycle
  detection never needs a broken file committed to the real registry),
  search ranking (`search.test.js`), whole-registry referential
  integrity - every category/dependency/conflict/collection-member
  reference across all 115 real packages actually resolves
  (`registry-integrity.test.js`) - deterministic `registry generate`
  output (`registry-generate.test.js`), plugin manifest validation
  including a version-incompatible fixture (`plugins.test.js`), the
  health-score formula against known tallies (`health.test.js`), and
  command aliasing (`aliases.test.js`).
  `.github/workflows/cli.yml` runs `npm ci && npm run lint && npm test`
  inside `cli/`, then `registry generate` and fails the build if
  `registry.json`/`docs/Registry.md` drifted from a fresh run (a
  generated-file-staleness check, not a second test suite).
  `.github/workflows/registry-smoke.yml` is the one **live** check: on
  macOS, install -> validate -> uninstall -> re-validate for a fixed
  allowlist of five safe, headless, no-account formulas (`jq`, `ripgrep`,
  `fd`, `bat`, `tree`) already in the registry - proving the install/
  validate/uninstall pipeline actually works against real Homebrew, not
  just that the manifests parse. GUI casks and account-gated cloud CLIs
  are deliberately excluded from live testing (schema + referential
  validation is what covers those - literally installing all 115
  manifests, including GUI apps and services needing credentials, on
  every push would be slow, costly, and flaky for no real safety
  benefit). `scripts/validate.sh` gains an optional "Node CLI" section
  that runs the same lint/test commands when `node`/`npm` are present,
  degrading gracefully (a warning, not a failure) otherwise - matching
  how it already treats `shellcheck`/`yq`/`markdownlint`.

## 17. Future cloud sync architecture (design only - Phase 4 / v2.0)

A remote backend (self-hostable or hosted) behind one interface:
authenticate via a device-code flow (mirroring `gh auth login`'s UX),
encrypt secrets client-side before upload (so the server never sees
plaintext), and store/retrieve profiles and backups keyed by machine/team.
Slots into `config.js` as described in section 7 - a layer between the
repo file and the user file, not a redesign of the loader.

## 18. Future GUI architecture (design only - Phase 4 / v2.0)

A separate Electron/Tauri desktop client that is purely a consumer of the
Node CLI: it shells out to `devforgekit <command> --json` (section 9's
diagnostics contract, plus the same pattern extended to `component list`/
`plugin list`/`profile list`) and renders the result. No business logic is
ever duplicated into the GUI layer - every command's behavior is defined
exactly once, in `cli/src/commands/`.

## 19. Future docs/marketplace integration (design only - Phase 5 / v2.x)

A static documentation/marketplace site consumes `registry/` and
`plugins/` directly as its content source (both are already just YAML on
disk, trivially rendered into browsable pages), and the plugin
marketplace's remote index (section 4) is the same manifest shape a
`create-devforgekit-plugin` (section 11) generates - so the pipeline from
"write a plugin locally" to "publish it to the marketplace" to "it shows
up on the docs site" never needs three different formats.

## 20. Interactive Terminal Dashboard (v1.2.3 - fully built)

`devforgekit` with no arguments opens a full-screen, keyboard-driven
TUI (`cli/src/tui/`, built with Ink - React for terminals, written
without JSX so the CLI keeps its no-build-step property). The dashboard
is the same *pure consumer* pattern section 18 prescribes for the
future GUI, applied one layer down: `tui/data.js` and the pages call
`core/registry.js`, `core/installer.js`, `core/recipes.js`,
`core/plugins.js`, `core/config.js`, and `generators/` directly, and
not one behavior is reimplemented. Three additive hooks were the only
engine changes: `runShellCommand`/`install*`/`runConfigureStep` accept
an optional `onOutput(text, stream)` to stream child output into a
render-safe log pane (a child inheriting the TTY would corrupt Ink's
render loop), `installPlan`'s existing `onStep` drives progress bars,
and work that legitimately owns the terminal (doctor.sh, update.sh,
inventory.sh, scaffolding CLIs, plugin commands) runs through a
suspend/resume loop in `tui/index.js` that unmounts Ink, hands over the
real TTY, and re-renders afterwards. Non-TTY/`TERM=dumb`/
`DEVFORGEKIT_NO_TUI=1` fall back to classic `--help`; every classic
command is untouched. Theme preference rides the existing config system
(`tuiTheme`). Full page/keyboard/theming reference and the honest
scoping list (no mouse, no fake rollback/marketplace/scheduling
controls, no screen-reader mode - the classic CLI is the accessible
path) live in `docs/TUI.md`.

---

## 21. Workspace Manager (v1.2.4 - fully built)

`devforgekit workspace` (`cli/src/core/workspace/`) makes an isolated
per-project environment a first-class, switchable unit instead of
something a developer reconstructs by hand every time they context-switch
between clients/projects: git identity, SSH host identities, environment
variables (plain + encrypted secrets), Docker/Kubernetes/cloud-CLI
context, and shell aliases/functions/PATH all move together with one
`devforgekit workspace switch <name>`, the same "one command replaces a
manual checklist" pattern sections 5 and 8 already established for
recipes and project generation.

**Document**: `~/.config/devforgekit/workspaces/<name>/workspace.json`,
`schemaVersion: 2` (bumped from 1 by section 22's Compatibility Engine,
which added the `compatibility` field - the first real entry in what had
been an empty migration table), validated by
`cli/src/schemas/workspace.schema.json`
(the same ajv-validated, versioned-with-a-migration-path pattern section
7's config system and section 3's registry schemas use). A workspace
optionally references a `profile`/`collections`/`recipes`/`components`
from the existing registry (resolved through the exact same
`core/registry.js` functions `profile install`/`recipe install` use -
never reimplemented) plus workspace-specific `git`/`ssh`/`env`/`docker`/
`kubernetes`/`cloud`/`shell`/`ai`/`editor` sections and a `projectHistory`
log (`devforgekit new` appends to it when a workspace is active).

**Switching** (`core/workspace/switcher.js`) applies, per subsystem, only
what the workspace actually declares - a workspace with no `docker`
context configured leaves Docker alone rather than clearing it:

- **git** - real `git config --global` writes (name/email/signing
  key/commit.gpgsign/init.defaultBranch/core.hooksPath/credential.helper),
  captured back from the live machine with `workspace git-capture`.
- **SSH** - an idempotent, uniquely-delimited `# BEGIN/END DEVFORGEKIT
  WORKSPACE: <name>` block per workspace inside `~/.ssh/config`
  (`core/workspace/markerBlock.js` - the same delimited-block-rewrite
  pattern `scripts/common.sh`'s PATH manager uses in Layer 1, ported to
  Node), never touching a user's own `Host` entries outside that block.
  Keys are referenced by path, never copied or generated.
- **Environment** - plain variables write to a workspace-scoped `.env`
  file; secrets are AES-256-GCM-encrypted at rest with a key generated
  once per machine (`~/.config/devforgekit/workspace-secret.key`, mode
  `0600`) - a local-machine-only protection, explicitly **not** a
  multi-user secrets vault (see the honest-scoping note below).
- **Docker/Kubernetes** - `docker context use`/`kubectl config
  use-context` (+ namespace) when the named context already exists
  locally; otherwise reported as a reference the workspace declares
  without one silently being created behind the developer's back.
- **Cloud** - `AWS_PROFILE`/`GOOGLE_CLOUD_PROJECT` exported for AWS/GCP
  (`gcloud config set project` also runs for GCP), Azure recorded as a
  reference only (the Azure CLI has no equivalent of a named, pre-created
  local profile to switch into) - each provider does exactly what a real
  CLI supports, nothing simulated.
- **Shell** - a generated `~/.config/devforgekit/workspace-shell.sh`
  (exports/aliases/functions/PATH prepends for the active workspace) plus
  a one-line, idempotent hook (`workspace shell-init`) into `.zshrc`/
  `.bashrc` that sources it - the same "generated file + one rc-file
  line" shape `mise activate`/`direnv hook` use, so new shells pick up
  the active workspace without re-running anything.

**Health** (`core/workspace/health.js`) reuses `core/health.js`'s
`scoreResults` (the exact PASS/WARNING/FAIL weighting `check.sh`/`doctor`
already standardize on) across every declared subsystem -
`workspace verify` and the dashboard page render the identical shape.

**Snapshots and rollback** (`core/workspace/snapshot.js`,
`switcher.js`'s `rollbackToSnapshot`) capture the whole document as a
point-in-time JSON file; rollback restores it and, if the workspace being
rolled back is the *active* one, also re-applies it live - always taking
an automatic safety snapshot of the pre-rollback state first, so an
accidental rollback is itself always one more rollback away from undone.

**Portable bundles** (`core/workspace/bundle.js`) export/import a
workspace as a `.tar.gz` - configuration and structure travel, secret
*values* and snapshot history deliberately do not (secrets must be
re-set on the destination machine; see the security note below). Import
runs the workspace through the same repair pass `workspace repair` uses
standalone, dropping and reporting any reference to a profile/recipe/
component/plugin/collection that doesn't exist on the destination
machine's registry rather than importing a document that would fail
every later `getWorkspace()` call.

**Surfaces**: 33 subcommands under `devforgekit workspace` (lifecycle,
health, snapshots, env, SSH, git, shell-init, and - added by section 22's
Compatibility Engine - `compatibility scan`/`repair`/`history` - full
reference in `docs/WorkspaceManager.md` and `CLI.md`), plus a dashboard
page (`w`)
covering the high-frequency actions (browse/create/switch/verify/
snapshot/delete) with the full command surface staying CLI-only, the
same scoping precedent the Recipes/Doctor/Plugins pages already set.

**Honest scoping**:

- **Not a secrets vault.** The AES-256-GCM key lives unencrypted on the
  local machine (mode `0600`) precisely so a workspace is usable
  offline with no account/server - it protects secrets from casual
  disclosure (accidental commits, shoulder-surfing a config file) on
  *this* machine, not from another process running as the same user.
  Section 17's future cloud sync is the honest path to real multi-machine
  secret distribution.
- **SSH `known_hosts` trust is trust-on-first-use** - identical to
  what running `ssh` by hand already does; the workspace manager does
  not add or remove any verification beyond git/ssh's own.
- **No automatic multi-machine sync.** Export/import is a manual,
  explicit action (a file you move yourself); there is no background
  sync daemon - that is section 17's Cloud Platform, not this phase.
- **Docker/Kubernetes/Azure context switching only creates nothing.** A
  workspace records what context/namespace/profile *should* be active;
  it never creates a Docker context, Kubernetes cluster, or cloud
  profile that doesn't already exist locally.

---

## 22. Compatibility Engine (v1.2.5 - fully built)

Not to be confused with section 15's "Compatibility strategy" (that one is
about Layer 1/Layer 2 backward-compatibility fallback within this CLI
itself). This section is the product feature: DevForgeKit understanding
whether the tools it installs actually *work together*, not just whether
each is individually present - the next foundation after the Workspace
Manager (section 21), since every later phase (AI-assisted diagnostics,
benchmarking, a marketplace, team/enterprise features) needs a reliable
model of the user's environment to build on.

**Rules**: `registry/compatibility/<name>.yaml`, one file per tool
(mirroring `registry/packages/`), validated against
`registry/schema/compatibility.schema.json` and cross-checked for
referential integrity the same way `core/registry.js`'s `checkIntegrity`
already validates packages/collections/profiles/recipes
(`core/compatibility/rules.js`'s `checkRuleIntegrity`). A rule declares
version-independent `conflicts`/`recommends`, `variantConflicts` (see
below), and per-version `requires`/`recommends`/`compatible`/`conflicts`/
`deprecated`/`experimental`/`unsupported`/`lts`/`platforms`/
`architectures`. Plugins may contribute rules via an optional `rules`
field in `plugin.yml` - `core/plugins.js`'s `validatePluginManifest` now
accepts a manifest declaring only `rules` (no `commands`/`events`
required), and these are merged into the loaded rule set as synthetic,
name-exempt entries (a plugin's name is its own identity, not a registry
package).

**Version matching**: `core/compatibility/versionMatch.js` builds
entirely on `semver` (already a CLI dependency) - exact/minimum/maximum/
range/wildcard/pre-release are all `semver.satisfies` once a loose
version string ("27", "3.44") is coerced via `semver.coerce`.
`versions.js` detects an installed version honestly: an optional
`versionCommand` package field (new, additive, in
`package.schema.json`), falling back to parsing `validate`'s own output,
else "unknown" - version-specific rules are skipped for an unknown
version, never guessed.

**The engine**: `engine.js`'s `scanCompatibility(names)` is the one
function every integration point below calls, producing a 5-tier score -
Healthy/Warning/Critical/Unsupported - built on `core/health.js`'s PASS/
WARNING/FAIL formula extended with two more tiers (`RECOMMEND` earns full
credit like `PASS`; `CRITICAL`/`UNSUPPORTED` earn none). A Critical or
Unsupported finding always wins the verdict outright regardless of the
numeric score. `graph.js` adds a capability `installer.js`'s own
dependency resolution doesn't have: it walks *both* package
`dependencies` edges and compatibility-rule `requires` edges together,
so a cycle formed by mixing the two (something `resolveInstallOrder`
would never see, since it only ever looks at `dependencies`) is
detected and reported rather than silently missed.

**`variantConflicts`**: some tools are modeled as variants of one package
(`docker`'s `docker-desktop`/`colima` install variants) - an ordinary
`conflicts` entry can't express "these two don't work together" since
both share one package name. `variantConflicts` + `variantProbes` (a
shell command per variant, exit 0 = present) detects the real-world case
of both being installed against actual machine state instead of the
registry's own single-variant-at-a-time bookkeeping.

**Explain and repair**: `explain.js`'s `explainComponent(name)` gives a
per-requirement ✓/✗ breakdown (installed version, each `requires`/
`recommends` entry, conflicts, a recommendation) - the product brief's own
worked example. `repair.js`'s `planRepair(scanResult)` reads the
*structured* fields `engine.js` attaches to each issue (`dependency`,
`conflictWith`, `variantConflict`) rather than parsing prose back apart,
producing `install`/`shell`/`conflict`/`manual` actions;
`executeRepairPlan` reuses `installer.js`'s `install`/`update`/`uninstall`
and never removes a conflicting package without an explicit confirm
(`lib/prompts.js`'s `confirm()`) unless `assumeYes` is set - `manual`
actions (a `variantConflicts` finding) are never auto-executed at all,
since there's no single package to act on. `report.js` exports Markdown/
HTML/JSON; `--format pdf` is honestly labeled PDF-*ready* Markdown (clean,
heading-structured, suitable for `pandoc`), not a binary PDF - no PDF
library is bundled.

**Integration points** (every one additive - no existing behavior changes
for a caller that never touches compatibility): `doctor` runs a scan over
every installed component after its existing checks
(`--skip-compatibility`); `recipe install`/`profile install`/`import` run
a pre-install check and prompt past any Critical/Unsupported finding
(`--skip-compatibility`/`-y`), and `recipe show`/`profile list`/`show`
display the resolved score; the Project Generator's `runProjectGenerator`
runs the same pre-check when a generator opts in via a new
`compatibilityCheck: [componentNames]` field (wired for `flutter`/
`react-native`/`expo`, the product brief's own Xcode/Android SDK example -
most generators don't declare one yet); the Workspace Manager gains
`workspace compatibility scan/repair/history` and a `compatibility:
{ scanHistory, repairHistory }` field on `workspace.json`, bumping
`schemaVersion` to 2 - the first real entry in what had been an empty
`migrateWorkspace` table (section 21); the dashboard gains a 15th page
(`tui/pages/CompatibilityPage.js`, shortcut `m`), whose repair action runs
through the same suspend/resume handoff the Doctor page already uses for
`scripts/doctor.sh`, since a conflict action's confirmation prompt needs
real terminal ownership Ink's raw-mode input would otherwise fight over;
and `registry stats` gains `compatibilityCoverage` (% of packages with a
dedicated rule file), computed in the command layer
(`commands/registry.js`) rather than `core/registry.js` itself, to avoid
a circular import (`core/compatibility/rules.js` already imports
`loadPackages` from `core/registry.js`).

**Honest scoping**:

- **`compatibility update` re-validates the local rule files only** -
  there is no remote compatibility rule source anywhere in this platform
  yet, matching `core/config.js`'s `registryUrl`/`mirrors` being stored
  but unconsumed for the same reason.
- **LTS status is never fabricated.** A rule can mark `lts: true`, but
  there is no bundled, self-maintaining table of "which version is LTS
  right now" - the engine reports it as an informational note only.
- **AI-assisted recommendations are a reserved interface, not a mock.**
  `core/compatibility/ai.js`'s `getAIRecommendations` always throws,
  pointing at the planned v1.3.0 "AI Doctor & Intelligent Repair" release
  - see the roadmap note below.

See `docs/CompatibilityEngine.md`, `docs/RuleSchema.md`,
`docs/CompatibilityRules.md`, and `docs/RepairGuide.md`.

---

## 23. AI Development Assistant (v1.3.0 - fully built)

The intelligence layer over every subsystem this document describes -
`cli/src/core/ai/`, one concern per directory, the same layout section
22's Compatibility Engine and section 21's Workspace Manager already
established.

**Providers** (`providers/`): one shared `AIProvider` contract
(`chat`/`stream`/`embeddings`/`listModels`/`checkHealth`,
`providers/base.js`), real REST clients for seven providers across three
wire dialects - `openaiCompatible.js` is one factory shared by OpenAI,
Groq, OpenRouter, and LM Studio (identical `/chat/completions` format);
`anthropic.js` (a separate `system` field, typed SSE `content_block_delta`
events) and `gemini.js` (key as a query parameter, "model" not
"assistant" role, `generateContent`/`streamGenerateContent`) each have
their own shape; `ollama.js` streams NDJSON, not SSE. Every network call
takes an optional `fetchImpl` (defaults to global `fetch`) - the same
dependency-injection convention section 22's `scanCompatibility`
`packages`/`rules` overrides already established - so every provider is
unit-tested against an injected fake, never a real network call.
`providers/index.js`'s `resolveApiKey` resolves a key from the provider's
own env var → the active workspace's declared secret via its `ai.apiKeyRef`
field (already part of `workspace.schema.json` since section 21 shipped)
→ `null`, never a placeholder.

**Context Engine** (`context/gather.js`): pure aggregation - installed
components, compatibility score, active workspace, git status, config -
with zero new data collection. `{ full: true }` additionally runs the
installed-component and compatibility scan; skipped by default since most
commands don't need it.

**Prompt Library** (`prompts/library.js`): one base system prompt, ten
real domain snippets (flutter/docker/kubernetes/python/node/react/rust/
devops/security/databases), and one instruction template per `ai`
subcommand. `doctor`/`generate`/`plan` ask for strict JSON; the calling
module (`diagnostics/doctor.js`, `commands/ai.js`'s generate handler,
`planner/planner.js`) defensively strips markdown fences and falls back
to the raw text (marked `unstructured: true`) rather than assuming
compliance.

**Memory** (`memory/history.js`): a capped local JSON event log at
`~/.config/devforgekit/ai/history.json` - the same shape as
`workspace.compatibility.scanHistory`. Records structured facts ("a
repair ran", "a project was generated"), never chat contents -
`chat/session.js`'s turns live in memory only and are discarded when a
session ends, per the PRD's own "never stores user conversations"
instruction.

**Diagnostics and Planner**: `diagnostics/doctor.js`'s `runAIDoctor` turns
a scan into a plain-language summary/reason/fix/estimatedTime/risk
explanation. `planner/planner.js`'s `planGoal` maps a natural-language
goal onto real `loadCollections`/`loadRecipes`/`loadPackages` names (sent
to the model as grounding data in the context block) - any name the model
returns that isn't real is filtered into a reported `dropped` array,
never acted on. Both patterns generalize the same principle section 22's
`ai generate`/`ai planner` scope decision establishes: an AI command may
*choose among* real things, never invent new ones.

**Embeddings** (`embeddings/search.js`): a real, disk-cached embeddings
index when the configured provider supports one (OpenAI, Gemini) -
`semanticSearch` falls back to `core/registry.js`'s existing lexical
`searchPackages` when no index exists, never a fabricated "semantic"
ranking over untrained data.

**Tools** (`tools/registry.js`): a plain function registry the modules
above call directly (gather context, run a scan, list components) - not
an autonomous LLM function-calling loop that decides on its own what to
execute. Every action that changes the machine (`ai generate`'s
scaffolding, `ai repair`'s installs/removals) still goes through the exact
same confirmation-gated path (`runProjectGenerator`,
`core/compatibility/repair.js`'s `executeRepairPlan`) every non-AI command
already uses.

**Surfaces**: `devforgekit ai chat/doctor/explain/review/generate/
analyze/summarize/optimize/repair/planner/models/providers/history`;
`core/compatibility/ai.js`'s `getAIRecommendations` (section 22, formerly
a documented-but-throwing stub) is now real, delegating to this same
provider/prompt machinery - `compatibility scan --ai` is its CLI surface.
A 16th dashboard page (`tui/pages/AIPage.js`, shortcut `e`) offers
request/response (not token-streamed) chat.

**Honest scoping**:

- With no provider configured (`aiProvider: "none"`, the default), every
  `ai` command - and `compatibility scan --ai` - prints a clear,
  actionable message and exits, instead of crashing or fabricating a
  response. Verified by a dedicated test per command's degradation path.
- No real cloud-provider API keys exist in this development environment;
  OpenAI/Anthropic/Gemini/Groq/OpenRouter are verified via injected-`fetchImpl`
  unit tests exercising real request-building/response-parsing logic, not
  live network calls. Ollama/LM Studio integration degrades to
  "unreachable" rather than throwing when nothing is actually running
  locally (the same precedent `workspace/docker.js`/`kubernetes.js`'s
  `listDockerContexts`/`listKubeContexts` already set).
- Dashboard chat is request/response, not token-streamed - true streaming
  inside Ink's render loop was judged high-risk/low-value relative to
  effort; the CLI's `ai chat --stream` covers real token streaming.
- LTS version status, `compatibility update`'s "local files only" scope,
  and PDF-ready (not binary PDF) exports all predate this section (section
  22) and are unchanged by it - restated here only because `ai explain
  compatibility` narrates those same honestly-scoped facts in prose.

See `docs/AIAssistant.md`, `docs/ProviderAPI.md`, `docs/ContextEngine.md`,
`docs/MemorySystem.md`, and `docs/PromptLibrary.md`.

---

## What v1.1 / v1.1.1 / v1.1.2 / v1.1.3 / v1.2.0 / v1.2.1 / v1.2.2 / v1.2.3 / v1.2.4 / v1.2.5 / v1.3.0 / v1.3.1 / v1.3.2 / v1.3.3 / v1.3.4 / v1.3.5 / v1.3.6 / v1.3.7 actually ship

All of the above sections 2, 3 (including Collections/Search/Dependency
resolution/Registry Builder/Registry Analytics/Rich info/Package Quality
System), 4's plugin SDK lifecycle (create/test/build/package/publish/
install, lifecycle events, dependencies, signing/trust, and now rule
contribution - everything except the hosted marketplace subsection,
which stays design-only), 5 (both profile and recipe flavors, fully
built), 6, 7 (fully built, including the config migration), 8 (both the
pre-existing static `templates/` and the new `devforgekit new` Project
Generator - 16 stacks, fully built), 9 (native-checks half), 12, 13, 14
(now two real migration-table entries: the config migration and the
workspace schema's v1→v2), 15, 16, 20 (the Interactive Terminal
Dashboard), 21 (the Workspace Manager), 22 (the Compatibility Engine), and
23 (the AI Development Assistant) are real, working code as of this
release - not just design. Sections 10, 11 describe extension points that already exist
structurally (the shell bridge, the plugin schema) but whose *expansion*
is intentionally deferred. The registry itself has 251 components/35 categories/17
collections/50 profiles today (251 since section 22 added `xcode`) -
real, working, and diverse across
languages, package managers, databases, containers, Kubernetes, cloud,
DevOps, editors, fonts, terminals, browsers, AI, utilities, security,
game development, design, networking, monitoring, media, embedded, CI/CD,
build systems, testing, package signing, code quality, documentation,
API development, web, desktop, Apple development, Android, and reverse
engineering - with the format proven to scale to hundreds more without
another schema change.

**v1.3.1 (Self-Update System), v1.3.2 (Environment Snapshot & Restore),
v1.3.3 (Benchmark Engine), v1.3.4 (Intelligent Repair Engine), v1.3.5
(Package Intelligence & Analytics), v1.3.6 (Development Environment
Graph), and v1.3.7 (Enhanced Package Installation Status) are all fully
shipped** - each is real, working code with full test coverage. See the
CHANGELOG for details on each release. The v1.3 platform is now mature;
the next phase is v2.0 (Cloud-Connected Developer Platform).

**Note on the roadmap evolution:** earlier product messages proposed
various version labels for what was then unbuilt work. As of v1.3.7,
the entire v1.x platform is shipped and mature. The remaining unbuilt
roadmap is v2.0 (Cloud-Connected Developer Platform: accounts, cloud
sync, multi-machine, team workspaces, web dashboard, public API,
cross-platform bootstrap for Windows/Linux) and v2.x (Community:
docs/marketplace site at devforgekit.dev, Extension SDK, community-
contributed profiles/templates). All of this needs real infrastructure
(hosted accounts, a marketplace backend, a separate GUI codebase, actual
Windows/Linux environments) beyond what a single local session can
stand up honestly.

See [Architecture.md](Architecture.md) for the pre-existing Layer 1 bash
architecture (unchanged by this document) and [CLI.md](CLI.md) for the
user-facing command reference.
