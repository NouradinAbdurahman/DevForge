# Contributing to DevForgeKit

Issues and pull requests are welcome. This guide covers everything you
need to get started as a contributor.

## Development setup

```bash
git clone https://github.com/NouradinAbdurahman/DevForgeKit.git
cd DevForgeKit
chmod +x bootstrap.sh devforgekit
./bootstrap.sh            # full provision (or --profile minimal for a lighter setup)
```

After bootstrap, the Node.js CLI is ready:

```bash
cd cli
npm install               # install dependencies
npm run lint              # eslint
npm test                  # node --test test/ (1,088 tests)
node bin/devforgekit.js --help
```

## Project structure

DevForgeKit has four layers:

```
Layer 1: scripts/*.sh, bootstrap.sh, common.sh, colors.sh  (bash, macOS-only)
Layer 2: cli/                                               (Node.js ESM)
Layer 3: plugins/                                           (manifest-driven)
Layer 4: registry/                                          (YAML manifests)
```

- **Layer 1** (bash) must run on stock macOS `/bin/bash` 3.2 — no
  bash 4+ features. See [docs/Architecture.md](docs/Architecture.md).
- **Layer 2** (Node.js) is ESM, no build step, no JSX. Uses
  `React.createElement` (aliased `h`) for the TUI.
- **Layer 3** (plugins) are manifest-driven (`plugin.yml`), discovered
  from `plugins/` and `~/.devforgekit/plugins/`.
- **Layer 4** (registry) is YAML manifests, validated by AJV schemas.

See [docs/PlatformArchitecture.md](docs/PlatformArchitecture.md) for the
full architecture, and [docs/ArchitectureDiagrams.md](docs/ArchitectureDiagrams.md)
for visual diagrams.

## Coding standards

### Bash (Layer 1)

- **bash 3.2 compatible**: no `declare -A`, `declare -g`, `mapfile`,
  `readarray`, `${var,,}`, `${var^^}`.
- **`set -Eeuo pipefail`**: every script uses this. See
  [docs/Architecture.md](docs/Architecture.md#set--e--pipefail-hazards)
  for the two failure modes this repo has already hit.
- **Never bare `print_summary`**: always wrap it:
  `if print_summary; then exit 0; else exit 1; fi`.
- **Guard pipelines**: `find ... | grep ... || true` when "found nothing"
  is valid.
- **Source `common.sh`**: every script starts with
  `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` then
  `source "$SCRIPT_DIR/common.sh"`.
- **Use `run_step`/`run_step_optional`**: for anything worth reporting.
- **Prefer POSIX flags**: `df -Pk` not `df -g` (GNU/BSD difference).
- **No extension for `devforgekit`**: it's checked explicitly in
  `validate.sh` and `shellcheck.yml`.

### JavaScript (Layer 2)

- **ESM only**: `"type": "module"` in `package.json`. Use `import`/`export`.
- **No JSX**: `React.createElement` aliased as `h`. The CLI has no build
  step and must not introduce one.
- **No business logic in the TUI**: pages call `core/` services, never
  duplicate logic.
- **Dependency injection for testability**: provider clients take
  `fetchImpl`, graph takes `packages`/`rules` overrides, etc.
- **Error handling**: use `withErrorHandling` from `core/errors.js` in
  CLI command handlers.
- **Existing style**: follow the patterns in `src/core/` and `src/commands/`.
  2-space indent, no semicolons, single quotes.

### YAML (Layers 3 & 4)

- **Schema-validated**: every manifest is validated by the matching
  `schema/*.schema.json` (AJV).
- **One file per entity**: one package = one `registry/packages/<name>.yaml`.
- **Honest metadata**: never fabricate `ciVerified: true`. Set
  `lastVerified` to the date you actually confirmed the commands work.
- **Run `registry generate`**: after adding/modifying registry packages,
  run `node bin/devforgekit.js registry generate` to refresh
  `registry/registry.json` and `docs/Registry.md`. CI fails if you forget.

## Testing

### Running tests

```bash
cd cli
npm test                          # all tests
npm test -- --test-name-pattern="plugin"  # filter by name
node --test test/plugin-excellence.test.js  # specific file
```

### Test conventions

- **Node.js built-in test runner** (`node:test`), no Jest/Mocha.
- **`assert/strict`** from `node:assert`.
- **Temp `$HOME`**: tests that write config use `mkdtempSync` and restore
  `process.env.HOME` in a `finally` block.
- **No mocks for core services**: tests exercise real registry loading,
  real plugin discovery, real graph building. Use dependency injection
  (e.g., `fetchImpl`) for external calls.
- **One test file per module**: `test/plugin-sdk.test.js`,
  `test/plugin-excellence.test.js`, `test/tui.test.js`, etc.
- **Test names are sentences**: `"full plugin lifecycle: create -> test ->
  build -> package -> install"`.

### Test coverage areas

| Area | Test files | Tests |
| --- | --- | --- |
| Plugin SDK lifecycle | `plugin-sdk.test.js` | 3 |
| Plugin excellence (v2.1.9) | `plugin-excellence.test.js` | 31 |
| Plugin discovery | `plugins.test.js` | 6 |
| TUI | `tui.test.js` | 38 |
| Registry | `registry.test.js` | ~30 |
| Project generator | `generator.test.js` | ~20 |
| Workspace | `workspace-*.test.js` | ~40 |
| AI providers | `ai-providers.test.js` | ~15 |
| Compatibility | `compatibility.test.js` | ~20 |
| DEV Graph | `devGraph.test.js` + `devGraph-build.test.js` | ~62 |
| Benchmark | `benchmark.test.js` | ~28 |
| Repair | `repair.test.js` | ~28 |
| Package intel | `package.test.js` | ~44 |
| Platform | `platform.test.js` | ~10 |
| Startup animation | `startup-animation.test.js` | ~15 |
| Markdown | `markdown-*.test.js` | ~31 |

## Validation before submitting a PR

```bash
./scripts/validate.sh              # shell syntax, ShellCheck, Brewfile, mise.toml, JSON, YAML, Markdown
./bootstrap.sh --dry-run --yes     # exercises preflight/detection, no side effects
cd cli && npm run lint             # eslint
cd cli && npm test                 # all unit tests
```

All four must pass. CI runs the same checks.

## How to add things

| What to add | How |
| --- | --- |
| **Registry component** | One `registry/packages/<name>.yaml` matching `schema/package.schema.json`. Run `registry generate`. |
| **Collection** | One `registry/collections/<name>.yaml` matching `schema/collection.schema.json`. |
| **Profile** | One `registry/profiles/<name>.yaml` matching `schema/profile.schema.json`. |
| **Recipe** | One `registry/recipes/<name>.yaml` matching `schema/recipe.schema.json`. |
| **Compatibility rule** | One `registry/compatibility/<name>.yaml` matching `schema/rule.schema.json`. |
| **Plugin** | `devforgekit plugin create <name> --template <template>`. See [docs/PluginSdk.md](docs/PluginSdk.md). |
| **Project generator stack** | One file under `cli/src/generators/<stack>.js` + one entry in `generators/index.js`. See [docs/ProjectGenerator.md](docs/ProjectGenerator.md). |
| **CLI command** | One file under `cli/src/commands/<name>.js` + one call in `src/index.js`. |
| **TUI page** | One file in `cli/src/tui/pages/` + entries in `store.js`'s `PAGES` and `App.js`'s `PAGE_COMPONENTS`. |
| **Bash script** | One `scripts/<name>.sh` sourcing `common.sh` + one `case` arm in `devforgekit` + one `cli/src/commands/<name>.js` using `defineScriptCommand`. |
| **Theme** | One `~/.config/devforgekit/themes/<name>.yaml` or add to `cli/src/tui/theme.js`. See [docs/TUI.md](docs/TUI.md). |

## Documentation

- **Deep-dive docs** live in `docs/`. See [docs/CommandReference.md](docs/CommandReference.md)
  for a complete command reference, [docs/KeyboardShortcuts.md](docs/KeyboardShortcuts.md)
  for TUI shortcuts, and [docs/ArchitectureDiagrams.md](docs/ArchitectureDiagrams.md)
  for visual diagrams.
- **CLAUDE.md** is a guide for AI coding assistants working in this repo.
  It's not human documentation — see `docs/` and `cli/README.md` for that.
- **CHANGELOG.md** follows [Keep a Changelog](https://keepachangelog.com/).
  Add entries under `[Unreleased]` → `Added`/`Changed`/`Fixed`/`Removed`.
- **VERSION** is a single line (e.g., `2.1.9`). `cli/package.json` must
  match. `scripts/release.sh` bumps both.

## Pull request process

1. Fork the repo and create a branch from `main`.
2. Make your changes following the coding standards above.
3. Run all four validation steps (validate.sh, bootstrap dry-run, lint, test).
4. If you added a registry component, run `registry generate` and commit
   the updated `registry.json`/`docs/Registry.md`.
5. Write a clear PR description. Reference any related issues.
6. CI runs automatically on your PR — all checks must pass.

## Release process

Releases are handled by the maintainer via `scripts/release.sh`. See
[docs/ReleaseProcess.md](docs/ReleaseProcess.md). Contributors don't
need to worry about this — just keep `VERSION`/`CHANGELOG.md`/`cli/package.json`
in sync if you happen to touch them.
