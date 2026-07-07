# Plugin SDK Audit (v2.1.9)

**Date:** 2026-07-07
**Scope:** Full audit of the Plugin SDK subsystem to identify bugs, dead code, missing metadata, UX gaps, and opportunities for the Excellence release.

---

## 1. Current Architecture

### Files

| File | Role |
| --- | --- |
| `cli/src/core/plugins.js` | Discovery, manifest validation (AJV), command/event registration |
| `cli/src/core/pluginSdk.js` | Lifecycle: create → test → build → package → publish → install |
| `cli/src/core/signing.js` | Ed25519 signing, trust model, key management |
| `cli/src/core/events.js` | Plugin event bus (EventEmitter) |
| `cli/src/commands/plugin.js` | CLI command surface (list, info, run, create, test, build, package, publish, install, trust, keygen) |
| `cli/src/schemas/plugin.schema.json` | JSON Schema (draft 2020-12) for plugin manifests |
| `cli/src/tui/pages/PluginsPage.js` | TUI page (list + detail panel) |
| `cli/test/plugin-sdk.test.js` | Integration tests for full lifecycle |
| `cli/test/plugins.test.js` | Unit tests for discovery and validation |
| `cli/test/fixtures/plugin-bad-engine/` | Test fixtures for incompatible/malformed plugins |
| `plugins/hello-world/` | Bundled example plugin |

### Discovery

- **Roots:** `repoRoot()/plugins/` (bundled) + `userStateDir()/plugins/` (user-installed).
- **Method:** `readdirSync` on each root, looking for `*/plugin.yml`.
- **Never throws:** Invalid plugins are reported per-plugin with `valid: false, reason`.
- **Engine check:** `semver.satisfies(getVersion(), manifest.engine, { includePrerelease: true })`.

### Loading

- **Manifest format:** YAML (`js-yaml`).
- **Validation:** AJV draft 2020-12 against `plugin.schema.json`, plus a semantic check ("at least one of commands/events/rules").
- **Command registration:** `registerPluginCommands(program)` adds each command as a commander subcommand. Duplicate command names are skipped with a warning.
- **Event hooks:** `registerPluginEventHooks()` subscribes to `pluginEvents` bus. Hook failures are logged as warnings, never thrown.

### Packaging

- **Build:** `buildPlugin()` requires `testPlugin()` to pass first, regenerates README.md, writes `plugin.lock.json` (SHA-256 per file + timestamp).
- **Package:** `packagePlugin()` tars the plugin directory, computes SHA-256 checksum, signs with Ed25519.
- **Publish:** `publishPlugin()` stages the archive + sidecar files to a local directory with `index.json`.
- **Install:** `installPlugin()` accepts local path or URL, verifies checksum (mandatory), verifies signature (warning + prompt if untrusted), extracts, validates manifest, checks dependencies.

### Signing

- **Algorithm:** Ed25519 via `node:crypto`.
- **Key location:** `~/.config/devforgekit/plugin-signing-key{,.pub}`.
- **Trust model:** Self-trusted by default; third-party keys added via `plugin trust <pubkey>`.
- **Missing/untrusted signature:** Warning + confirmation prompt (not a hard failure).

### Versioning

- **Schema version:** `schemaVersion: 1` (const in JSON schema).
- **Engine compatibility:** `semver.satisfies()` against `getVersion()`.
- **No migration system:** Unlike workspace schema (which has `migrations[]`), the plugin schema has no migration path. A `schemaVersion: 2` would require a new const + migration logic.

### Dependency Handling

- **Declaration:** `dependencies: [string]` in manifest (array of plugin names).
- **Check:** `installPlugin()` warns if declared dependencies are not discovered and valid.
- **No resolution:** No automatic installation of dependencies. No version constraints on dependencies (just names).

---

## 2. Findings

### Bugs

| ID | Severity | Description |
| --- | --- | --- |
| **B1** | Medium | `createPlugin()` always creates the same single template (one command, one event hook). No template selection. The `--template` flag doesn't exist yet. |
| **B2** | Low | `testPlugin()` doesn't check if test scripts are executable (missing `chmod +x` on some systems could cause false failures). |
| **B3** | Low | `packagePlugin()` output doesn't include archive size or manifest validation summary — the user gets just the path and checksum. |
| **B4** | Medium | `installPlugin()` dependency check only warns about missing deps but doesn't check version compatibility — `dependencies` is `string[]` (names only), not `{ name, version }[]`. |
| **B5** | Low | `PluginsPage.js` TUI only shows the first command in the hint (`x` to run), and doesn't let users select which command to run. |

### Dead Code

| ID | Description |
| --- | --- |
| **D1** | None found — the codebase is lean. All exported functions are used. |

### Missing Metadata

| ID | Description |
| --- | --- |
| **M1** | No `repository` field in schema — plugins can't declare their source repo. |
| **M2** | No `compatibility` field — no way to declare platform/architecture constraints (e.g., "macOS only", "arm64"). |
| **M3** | No `permissions` field — no way to declare what a plugin needs access to (filesystem, network, env vars). |
| **M4** | No `capabilities` field — no way to declare what extension points a plugin provides (command, tui-page, generator, benchmark, repair, graph, ai-provider, compat-rule). |
| **M5** | No `keywords` field — no search/discovery metadata. |
| **M6** | No `icon` field — no visual identity for TUI/marketplace. |

### UX Gaps

| ID | Description |
| --- | --- |
| **U1** | No `plugin doctor` command — no way to diagnose all plugins at once for common issues. |
| **U2** | No `plugin quality` command — no quality score like registry packages have. |
| **U3** | No `--template` option on `plugin create` — all scaffolds are identical. |
| **U4** | No `--json` output on `plugin list` or `plugin test` — hard to integrate with CI/scripts. |
| **U5** | TUI PluginsPage is basic — single list + detail panel, no tabs, no search, no quality/health display. |
| **U6** | No `plugin validate` command — `test` does validation + runs tests, but there's no quick "just validate the manifest" command. |
| **U7** | No `plugin search` command — can only `list` all discovered plugins. |
| **U8** | No plugin documentation file — Plugin SDK is documented only inside PlatformArchitecture.md, not in its own dedicated doc. |

### Inconsistencies

| ID | Description |
| --- | --- |
| **I1** | `plugin list` output format differs from `workspace list` — no table format, no `--json`. |
| **I2** | `plugin test` uses `scoreResults()` from `health.js` (good), but `plugin build` doesn't expose the score in its output. |
| **I3** | Plugin schema has no migration system, unlike workspace schema which has `migrations[]`. If schema v2 is needed, there's no path. |

---

## 3. Strengths

- **Real crypto:** Ed25519 signing with `node:crypto`, not a stub.
- **Honest trust model:** No fake CA; trust is explicit and local.
- **Checksum verification is mandatory:** Tampered packages are refused.
- **Never crashes on bad plugins:** Invalid manifests, incompatible engines, duplicate commands — all handled gracefully.
- **Full lifecycle:** create → test → build → package → publish → install is complete and working.
- **Real integration tests:** The full lifecycle is tested end-to-end with real tar, real SHA-256, real signatures.

---

## 4. Phase Plan

### Phase 2: Plugin Metadata
- Bump schema to v2, add `repository`, `keywords`, `icon`, `compatibility` (platforms, architectures), `permissions`, `capabilities`.
- Add migration v1→v2 (additive — new fields are optional).
- Update `createPlugin()` to include new fields in scaffold.
- Update `generateReadme()` to render new fields.

### Phase 3: Plugin Validation
- Create `validatePlugin(dir)` that checks: manifest schema, command scripts exist + executable, event scripts exist + executable, README exists, LICENSE exists (if declared), icon exists (if declared), signature valid, engine compatible, dependency graph resolvable, no duplicate command names across plugins.
- Add `plugin validate [dir]` CLI command.
- Add `--json` output.

### Phase 4: Plugin Quality Score
- Create `scorePlugin(dir)` with categories: Documentation, Architecture, Testing, Signing, Compatibility, Examples, Versioning, Manifest, Permissions.
- Add `plugin quality [name|dir]` CLI command with `--json`.

### Phase 5: Plugin Diagnostics
- Create `diagnosePlugins()` that scans all discovered plugins for: invalid manifests, duplicate commands, incompatible versions, missing dependencies, bad manifests, missing signatures, deprecated APIs.
- Add `plugin doctor` CLI command.

### Phase 6: Plugin Templates
- Add `--template` option to `plugin create` with templates: `simple-command`, `tui-page`, `generator`, `benchmark`, `repair`, `graph-extension`, `ai-provider`, `compatibility-rule`.
- Each template scaffolds appropriate directory structure, scripts, and manifest.

### Phase 7: Plugin Testing
- Improve `testPlugin()`: add isolation (temp HOME), fixture support, coverage reporting, diagnostic output.
- Add `--json` output to `plugin test`.

### Phase 8: Plugin Packaging
- Improve `packagePlugin()` output: show archive size, checksum, signature status, manifest validation, compatibility check.
- Add `--json` output to `plugin package`.

### Phase 9: Plugin TUI
- Redesign `PluginsPage.js` with tabs: Installed, Available, Validation, Quality, Details.
- Add search, filters, health indicators, dependency display, compatibility info, signing status.

### Phase 10: Plugin Documentation
- Create `docs/PluginSdk.md` with: SDK overview, manifest reference, hook reference, API reference, templates, best practices, migration guide.

### Phase 11: Testing Audit
- Run all plugin tests, fix failures, remove duplicates, ensure 100% pass rate.
- Add new tests for all v2.1.9 features.
