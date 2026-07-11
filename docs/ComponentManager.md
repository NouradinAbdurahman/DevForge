# Component Manager

Every fact DevForgeKit knows about an installed tool used to live in a
different place: whether it's installed (`installer.js`'s `validate()`),
its version/provider/binary (the Environment Configuration Engine's
tracked state), its dependency graph (`environment/graph.js`), whether
another copy shadows it (`environment/conflicts.js`), whether it's
outdated (the platform adapter). `core/componentManager.js` is the one
place that reads all of them and returns a single object - `getComponentStatus(name)`
- so `component list`, `component info`, `component doctor`, and
`devforgekit info` can never disagree about what "installed" or
"healthy" means for the same package.

```bash
devforgekit component info java
```

```text
=== java ===
  OpenJDK - the open-source Java Development Kit

  Installed:     Yes
  Provider:      brew-formula
  Version:       21.0.2
  Binary:        /opt/homebrew/opt/openjdk/bin/java
  Health:        83% - Machine Mostly Ready - see warnings above
  Conflict:      multiple installations found
                 → mise: /Users/dev/.local/share/mise/shims/java
                   system: /usr/bin/java
  Environment:   Healthy
  Capabilities:
                 repair: available, update: available, uninstall: available
```

## Architecture

`getComponentStatus(name, opts)` composes, never re-implements:

| Fact | Source |
| --- | --- |
| `installed` | `installer.js`'s real `validate()` - a live command, never a cached guess |
| `version` / `provider` / `binary` / `verified` | The Environment Configuration Engine's tracked facts (`environment/state.js`) when already observed and verified; a fresh `discovery.js` probe otherwise - never both, to avoid a redundant live probe on every list |
| `conflict` | `environment/conflicts.js`'s `findBinaryConflicts()` - only checked for an installed package with a known binary |
| `dependencies` | Direct `pkg.dependencies`, each checked live via the same `validate()` |
| `dependents` | `environment/graph.js`'s `dependentsOf()` - the same graph `env graph`/`component uninstall`'s impact warning use |
| `environment` | Only present for a package declaring an `environment` field; runs the real validator (`environment/validator.js`) scoped to just this one package |
| `updateAvailable` | The platform adapter's outdated-package report (`null`, not `false`, for an uninstalled package - "would it update" doesn't apply) |

Every dependency is injectable (`resolvePackage`/`validateFn`/`discover`/`capture`/`outdatedList`) - `cli/test/componentManager.test.js` exercises the full aggregation against synthetic packages with fake shell results, never the real registry or a real machine.

## Performance

A full-catalog scan (`component list --status` with no filter) shells out at least one live command per package - measured at **~11s sequential / ~9s with bounded concurrency=8** for all 261 registry packages on the development machine. `getAllComponentStatuses()` uses a small worker-pool (`mapWithConcurrency`) rather than either running everything sequentially or an unbounded `Promise.all` over 261 concurrent child processes.

Because of this real cost, `component list` defaults to the **existing fast grouped browse** (name + description only, no live checks) - the live status view is opt-in via `--status`/`--json`, and `--category` narrows the scan scope. This is a deliberate choice, not a limitation to hide: browsing the catalog should be instant; asking "what's actually installed and healthy" is a genuinely different, slower operation, and the command says so (`Checking live status for N component(s)...`).

## `devforgekit component`

| Command | Description |
| --- | --- |
| `component list` | Fast grouped browse (name + description) - unchanged |
| `component list --status [--installed] [--category <id>] [--json]` | Live installed/version/health%/provider/update/conflict per component |
| `component info <name> [--json]` | Unified status: installed/provider/version/binary/health/conflict/environment/dependencies/dependents/capabilities. `--json` returns the raw registry manifest instead (the pre-existing scriptable output) |
| `component doctor <name> [--json]` | PASS/WARN diagnostic breakdown + health score + a `component repair` pointer when applicable |
| `component install [names...]` | Unchanged - dependency-resolved install, interactive picker if no names given |
| `component validate <name>` | Unchanged - runs the manifest's `validate` command |
| `component repair <name>` | Unchanged - runs the manifest's `repair` command |
| `component update <name>` | Runs the manifest's `update` command, then re-registers the package's environment facts (a version bump should be reflected immediately, not after the next unrelated install) |
| `component reinstall <name>` | Uninstall then install fresh; unregisters then re-registers environment tracking |
| `component uninstall <name>` (alias `remove`) | Warns which tracked components depend on this one before removing (`dependentsOf`), then unregisters environment tracking on success |

`devforgekit info <name>` (the separate, richer human-readable command with quality score/install size/live reachability - see `commands/info.js`) also shows the tracked environment facts and dependents for consistency, reading the same Environment Configuration Engine state `getComponentStatus` does, though it doesn't run the full component aggregation (no dependency/conflict check) - that view is scoped to a single package's own diagnostics, matching its existing, narrower purpose.

## Testing

`cli/test/componentManager.test.js` (8 tests) covers full aggregation for an installed component with dependencies/conflicts/environment metadata, an uninstalled component (honest `null` fields, not guessed), an unknown component's clear error, conflict detection via injected `which -a` output, `updateAvailable` (including alias matching), preferring already-verified tracked facts over a redundant discovery probe, the bounded-concurrency full-catalog scan, and the health-score formula - all fully isolated (synthetic packages, injected validate/discover/capture, zero real shell-outs).
