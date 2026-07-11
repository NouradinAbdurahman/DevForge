# Environment Configuration Engine

The Environment Configuration Engine (`core/environment/`) is the single
source of truth for every tool DevForgeKit installs: a user never manually
edits `.zshrc`/`.bashrc` to add a `PATH` entry or `export JAVA_HOME=...`
again. Every successful install is tracked with **observed facts** (where
the binary really landed, what version answered, which provider installed
it); packages that declare an `environment` field in their registry
manifest additionally contribute lines to one owned, regenerated shell
file; the user's real rc file gets exactly one line sourcing it.

```bash
devforgekit component install java
devforgekit env doctor
```

```text
✓ PATH entry's command is resolvable: $(brew --prefix openjdk)/bin
✓ No duplicate PATH entries
✓ JAVA_HOME is resolvable ($(echo $(brew --prefix openjdk)/libexec/openjdk.jdk/Contents/Home))
✓ java 21.0.2 verified (/opt/homebrew/opt/openjdk/bin/java)
✓ Shell config synchronized (zsh)
✓ Shell hook installed (zsh)

Health score: 100% - Machine Ready
```

## Architecture

The chain is **EnvironmentEngine → Platform → Shell → Writer**: the
platform adapter (`core/platform/`) says which shells matter on this OS
(`Platform.shells()` - macOS: zsh+bash, Linux: bash+zsh, Windows:
powershell), and the writer registry says how each one is written. Small,
single-purpose modules, no classes except where there's genuine
polymorphism (the writers, mirroring `core/platform/`'s adapter pattern):

| Module | Responsibility |
| --- | --- |
| `state.js` | Persisted `~/.config/devforgekit/environment.json` (schema v2) - **which packages are tracked + observed facts per package** (provider/binary/location/version/verified/lastVerified), plus per-shell content hashes for manual-edit detection. Never a computed copy of PATH/variables. v1 documents (a plain name array) migrate on read. |
| `discovery.js` | Reality verification after install: `command -v` for the real binary location (hint order: `versionCommand` → `validate` → package name), `core/compatibility/versions.js` for the real version, the manifest's platform-resolved install step for the provider. A tool that can't be found is recorded unverified with `location: null` - never guessed. |
| `conflicts.js` | Multi-installation detection: `which -a` per tracked binary, PATH-duplicate lines deduplicated, each location classified by source (Homebrew/mise/system/manual/cargo/npm - a path heuristic, labeled as exactly that), the first one marked as what actually runs. |
| `model.js` | Reads each tracked package's `environment` field fresh from the registry, merges into one deduplicated (trailing slashes normalized), canonically-ordered PATH list + variables map + shell lines, with per-entry package attribution (`pathOwners`). |
| `writers/posix.js`, `writers/fish.js`, `writers/index.js` | One writer per shell, each owning `render(model)`, `hookLine(file)` (the source line in that shell's own syntax), and an honest `capabilities` matrix (supported/partial/planned per feature - `env shells`). |
| `shellFile.js` | Writes `~/.config/devforgekit/shell.<ext>` - always a full overwrite - and detects manual edits via the recorded content hash. |
| `hook.js` | Installs the one-line source hook into the real rc file via `core/workspace/markerBlock.js` (reused as-is, zero changes). |
| `validator.js` | Checks the model against real filesystem/shell state, with package attribution, concrete repair suggestions, versioned-path migration detection, and per-tracked-package live verification + conflict checks - the engine behind `env doctor`. |
| `graph.js` | Dependency tree of tracked tools + `dependentsOf()` ("Removing Java will affect: ...") - reuses `core/compatibility/graph.js`'s `buildDependencyGraph`, not a third dependency representation. |
| `changelog.js` | Transaction log: every regeneration that changed something appends what changed to `~/.config/devforgekit/logs/environment/<day>.json` (`env history`). |
| `diff.js` | `env diff [snapshotId]` - packages/versions/PATH/variable deltas since a snapshot, both sides built against the current registry. |
| `watch.js` | `env watch` - polls the platform's bin directories; a newly-appeared binary matching a registry package is tracked + regenerated live. Imported by the command directly (it imports the engine, so re-exporting from index.js would be a cycle). |
| `editors.js` | Running-editor detection (`pgrep`) for honest "VS Code is running - reload its window" guidance after regeneration. Never pretends to reload anything itself. |
| `snapshot.js` | Point-in-time snapshots of the tracked state + generated files; restore is itself reversible (automatic safety snapshot first, same convention as workspace rollback). |
| `index.js` | The only module other subsystems should import (except `watch.js`, above). |

**Why `environment.json` stores observed facts but never computed PATH/variables**: the observed facts (version, location) are things the engine *measured* - they can only be refreshed, not derived. The PATH/variable/shell lines are always rebuilt fresh from the registry at generation time; storing a computed copy would let it drift from the manifest after a `registry generate` update - the exact class of bug this subsystem exists to prevent elsewhere.

## Canonical PATH ordering

Ordering matters (`mise` shims must shadow Homebrew; nothing managed may
be shadowed by `/usr/bin`), so every regeneration applies one fixed tier
ranking - install order never changes the result:

1. DevForgeKit-owned paths
2. mise shims (runtime activators)
3. Homebrew / package-manager prefixes
4. Package-specific bins (the default tier)
5. System paths (`/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`)

Classification works on the raw shell expression (values expand at
shell-startup time, not generation time), so it's substring/prefix based
and documented as exactly that; within a tier, order is stable
(alphabetical by contributing package). Exact-duplicate entries are
deduplicated at generation (trailing slashes normalized first); two
*different* expressions that resolve to the same real directory are
reported by `env doctor` as a duplicate warning.

## Metadata schema

```yaml
# registry/packages/java.yaml
environment:
  path:
    - "$(brew --prefix openjdk)/bin"
  variables:
    JAVA_HOME:
      command: echo $(brew --prefix openjdk)/libexec/openjdk.jdk/Contents/Home
```

- `path: string[]` - directories to prepend to `PATH`, as shell expressions. May reference `$HOME`/`$VARNAME` or `$(command)` - expanded at **shell-startup time**, not at generation time, so a dynamic value (like a Homebrew keg-only formula's real prefix) stays correct across version bumps with no regeneration needed.
- `variables: { NAME: { value } | { command } }` - exactly one of `value` (a literal shell expression) or `command` (a shell command whose stdout becomes the value, re-resolved every shell startup). `openjdk` is keg-only on Homebrew (verified via `brew info openjdk`) - it's the canonical case for `command`, since a fixed path would break on the next JDK bump.
- `shell: string[]` - raw shell lines appended verbatim (e.g. `eval "$(mise activate zsh)"`). POSIX-authored; the fish writer comments them out with attribution rather than emitting broken syntax (see Cross-platform below).

Values are registry-authored, trusted content - the POSIX writer embeds them inside double quotes so `$HOME`/`$(...)` expansion actually happens, deliberately **not** run through `core/shell.js`'s `shellQuote()` (which single-quotes specifically to *prevent* expansion - correct for a workspace's decrypted secrets, wrong here).

**The registry hints, discovery verifies.** The manifest is never blindly trusted: after every install the engine re-observes reality (`command -v`, a real version command) and records what it actually found.

**Not yet implemented** (planned): `aliases`, `functions`, `completions`, `startupCommands`, `shutdownCommands`, `validation`, `repair`, `uninstall` metadata fields. Only `path`/`variables`/`shell` exist in `package.schema.json` today - the others are a planned slice, not silently-ignored fields.

## How a package gets tracked

Two independent paths converge on the same tracked state:

1. **`devforgekit component install <name>`** (and `collection install`/`profile install`/`recipe install`, which all go through the same `installRunner.js` → `installPlan()`) fires the existing `install.afterInstall` plugin event (`core/events.js`). The Environment Configuration Engine is simply that event bus's first, built-in subscriber (`registerEnvironmentEventHooks()`, called once at CLI startup in `cli/src/index.js`) - exactly the same mechanism a third-party plugin would use, not a special case. **Every** successfully-installed package is tracked with discovered facts, whether or not it declares `environment` metadata.
2. **`./devforgekit install`** (the bash bootstrap/Brewfile path) doesn't go through `installPlan()` at all - Homebrew installs there happen directly via `scripts/common.sh`'s `install_brewfile`. `bootstrap.sh`'s Verification step calls `devforgekit env regenerate` once, after `verify_devforgekit_cli` confirms the Node CLI actually works.

`unregisterPackageEnvironment(name)` is the uninstall-side API (stops tracking, regenerates so the package's lines disappear); wiring it into `component uninstall`/`devforgekit uninstall` is part of the repair/uninstall slice.

## Manual edits are never silently destroyed

- **Outside the managed block/file**: structurally impossible to clobber - `markerBlock.js` only ever rewrites its own delimited block in the rc file, and the engine writes nothing else outside `~/.config/devforgekit/`.
- **Inside the generated shell file**: `state.js` records a content hash at every write. If the on-disk file no longer matches what the engine last generated, the edited version is preserved as `shell.<ext>.user-<timestamp>` before the overwrite, and `env regenerate` says so explicitly.
- **Inside the rc-file hook block**: the whole rc file is backed up as `<rcfile>.devforgekit-backup-<timestamp>` before an edited block is replaced.

## Generation is deterministic

`regenerateEnvironment()` rebuilds every supported shell's file from scratch every time - never an edit, never an append. Re-running it twice in a row produces byte-identical output and reports no manual edit (a real regression test - see `cli/test/environment.test.js`). After regeneration, the engine checks whether the *current* shell already has the generated literal PATH entries and prints honest reload guidance ("Run 'exec $SHELL' or open a new terminal") - a child process cannot mutate an already-running parent shell's environment, no CLI can, so nothing pretends to.

## Cross-platform status

| Shell | Status |
| --- | --- |
| zsh | Implemented (`writers/posix.js`) |
| bash | Implemented (same POSIX writer - identical `export`/`PATH` syntax) |
| fish | Implemented (`writers/fish.js`) - native `set -gx`/`(command)` syntax with a mechanical POSIX→fish translation for `$(...)`; untranslatable POSIX-only constructs (backticks, `${VAR%...}`) and raw POSIX `shell` lines are emitted as attributed comments, never as broken syntax. Not in any platform's default `shells()` list yet. |
| PowerShell | Declared (`windows.js` names it in `shells()`, `shellConfigFile()` resolves a real `profile.ps1` path) but **no writer exists** - `$env:` assignments and `;` PATH separators have no mechanical translation from POSIX-authored metadata values. The engine skips it with a warning; requesting it directly throws `EnvironmentUnsupportedShellError` (the `PlatformNotSupportedError` precedent). |

## `devforgekit env`

| Command | Description |
| --- | --- |
| `env doctor [--shell <shell>] [--json]` | Validate the generated environment against real filesystem/shell state: PATH existence (per-package attribution + a concrete `devforgekit component repair <pkg>` suggestion, and a found-replacement hint when a versioned directory moved in an upgrade), duplicates, variables, live re-verification of every tracked package's binary + version, multi-installation conflicts (`which -a`), shell-file sync, hook presence - plus a per-package health breakdown ("java: 87% - Multiple java installations detected") and the overall score. |
| `env validate` | Alias for `env doctor` |
| `env list [--json]` | Tracked packages with observed version/provider/location/verified status, plus the merged PATH (canonical order, with owners), variables, and shell lines |
| `env regenerate` | Rebuild every generated shell file and reinstall the hook; reports preserved manual edits, shell reload guidance, and (when VS Code/Cursor/JetBrains is running) editor reload guidance |
| `env graph [name]` | Dependency tree of tracked tools; with a name, what removing it would affect |
| `env shells [--json]` | Per-shell writer capability matrix (supported ✓ / partial ◐ / planned …) |
| `env diff [snapshotId] [--json]` | Packages/versions/PATH/variable deltas since a snapshot (default: the most recent) |
| `env history [day] [--json]` | The transaction log - what each regeneration actually changed, per day |
| `env watch [--interval <s>]` | Live watch: a newly-installed known tool is tracked and the environment regenerated the moment its binary appears (honestly reports whether a restart is needed, per-directory) |
| `env snapshot [-m <message>]` | Save a snapshot of the tracked state + generated files (`snapshot list` to enumerate) |
| `env restore <id>` | Restore a snapshot's tracked state and regenerate from it against the **current** registry (a safety snapshot of the current state is taken first) |

Integration beyond `env`: `devforgekit info <name>` shows the tracked environment facts (provider/version/binary/verified) and what depends on the package; `devforgekit component uninstall <name>` warns which tracked tools removal will affect (`dependentsOf`), and unregisters the package from the environment on success.

**Planned, not built**: `env repair` (a dedicated `repair.js` `environment` scanner category - the category ID already exists, reserved, unused, in `REPAIR_CATEGORIES`), `env inspect <pkg>`, install-event-driven uninstall wiring for the bash `devforgekit uninstall` path, a TUI Environment page, and plugin-declared `environment` metadata. Manual-edit handling is preserve-and-report (a backup plus a warning), not an interactive keep/restore/merge prompt - regeneration runs inside install events where prompting would block unattended installs.

## Testing

`cli/test/environment.test.js` (56 tests) covers state round-trips + the v1→v2 migration, discovery with injected probes (nothing depends on what the host has installed), canonical PATH ordering + normalization + attribution, all three writers (including fish translation limits), manual-edit detection for both the generated file and the rc-file block, the hook's idempotency/coexistence with the workspace hook, every validator check (including multi-installation conflicts and versioned-path replacement detection), the transaction log, the dependency graph, shell capabilities, snapshots + diff (including the same-millisecond id-collision fix a failing test caught), watch-mode scanning, editor detection, and the full register/unregister/regenerate/restore pipeline - all against a scratch `$HOME` (`mkdtempSync`) with injected shell probes, the same isolation `workspace-git.test.js` uses, so no test ever touches the machine running it.
