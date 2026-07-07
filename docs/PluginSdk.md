# Plugin SDK

The Plugin SDK (v2.1.9) is `devforgekit plugin` — it lets DevForgeKit
grow without modifying the core. Plugins are plain directories with a
`plugin.yml` manifest, discovered from two roots: bundled examples
(`plugins/`) and user-installed (`~/.devforgekit/plugins/`).

## Quick start

```bash
# Scaffold a plugin from a template
devforgekit plugin create my-plugin --template simple-command

# Test it (validates manifest + runs test scripts)
devforgekit plugin test ./my-plugin

# Build it (regenerates README, writes plugin.lock.json)
devforgekit plugin build ./my-plugin

# Package it (tar.gz + SHA-256 + Ed25519 signature)
devforgekit plugin package ./my-plugin

# Publish to a local staging directory
devforgekit plugin publish ./my-plugin-0.1.0.tar.gz --to ./published

# Install from a local archive or URL
devforgekit plugin install ./my-plugin-0.1.0.tar.gz

# Validate, score, and diagnose
devforgekit plugin validate ./my-plugin
devforgekit plugin quality my-plugin
devforgekit plugin doctor
```

## The plugin manifest

Each plugin has a `plugin.yml` (YAML, validated against
`cli/src/schemas/plugin.schema.json`):

```yaml
schemaVersion: 2
name: my-plugin
version: 0.1.0
description: Does something useful
author: Alice
license: MIT
homepage: https://example.com/my-plugin
repository: https://github.com/alice/my-plugin
keywords: ["example", "utility"]
icon: icon.png
engine: ">=2.1.9"
capabilities: ["command"]
permissions: ["shell", "filesystem"]
compatibility:
  platforms: ["darwin", "linux", "win32"]
  architectures: ["x64", "arm64"]
dependencies: []
commands:
  - name: greet
    description: Print a greeting
    run: ./commands/greet.sh
    timeoutMs: 30000
events:
  - event: install.afterInstall
    description: React after any component install
    run: ./hooks/after-install.sh
```

### Manifest fields

| Field | Required | Purpose |
| --- | --- | --- |
| `schemaVersion` | Yes | Manifest schema version (1 or 2). v2 adds metadata fields. |
| `name` | Yes | Plugin name (`^[a-z][a-z0-9-]*$`) |
| `version` | Yes | Semver version string |
| `description` | Yes | Human-readable description |
| `engine` | Yes | Semver range for DevForgeKit compatibility |
| `author` | No | Author name |
| `license` | No | License identifier (e.g., MIT, Apache-2.0) |
| `homepage` | No | Homepage URL |
| `repository` | No | Source repository URL |
| `keywords` | No | Search/discovery tags |
| `icon` | No | Path to icon file (relative to plugin dir) |
| `compatibility` | No | Platform/architecture constraints |
| `permissions` | No | Required permissions: `filesystem`, `network`, `env`, `shell`, `subprocess` |
| `capabilities` | No | Extension points: `command`, `tui-page`, `generator`, `benchmark`, `repair`, `graph`, `ai-provider`, `compatibility-rule` |
| `dependencies` | No | Array of plugin names this plugin depends on |
| `commands` | No* | Array of command hooks |
| `events` | No* | Array of event hooks |
| `rules` | No* | Compatibility rules (requires/conflicts/recommends) |

\* At least one of `commands`, `events`, or `rules` is required.

### Schema versioning

- **v1:** Original schema (name, version, description, engine, commands, events, rules).
- **v2 (v2.1.9):** Adds `author`, `license`, `homepage`, `repository`, `keywords`, `icon`, `compatibility`, `permissions`, `capabilities`. All new fields are optional — v1 manifests remain valid.

## Templates

`devforgekit plugin create <name> --template <template>` scaffolds from
one of 8 templates:

| Template | Capability | Permissions | Description |
| --- | --- | --- | --- |
| `simple-command` | `command` | `shell` | Basic command + event hook (default) |
| `tui-page` | `tui-page` | `shell` | TUI dashboard page integration |
| `generator` | `generator` | `shell`, `filesystem` | Project generator |
| `benchmark` | `benchmark` | `shell`, `subprocess` | Performance benchmark |
| `repair` | `repair` | `shell`, `filesystem` | Repair/diagnostic tool |
| `graph-extension` | `graph` | `shell` | DEV Graph extension |
| `ai-provider` | `ai-provider` | `network`, `env` | Custom LLM provider |
| `compatibility-rule` | `compatibility-rule` | (none) | Compatibility Engine rules |

## Lifecycle

### create → test → build → package → publish → install

1. **create:** Scaffolds plugin directory from a template.
2. **test:** Validates manifest schema, checks script existence, runs `tests/*.sh`.
3. **build:** Requires test pass, regenerates README.md, writes `plugin.lock.json` (SHA-256 per file).
4. **package:** Tars the plugin dir, computes SHA-256 checksum, signs with Ed25519.
5. **publish:** Stages archive + sidecar files to a local directory with `index.json`.
6. **install:** Verifies checksum (mandatory), verifies signature (warning if untrusted), extracts, validates, checks dependencies.

### Validation

`devforgekit plugin validate [dir]` runs comprehensive structural checks:

- Manifest schema valid (AJV)
- Engine compatibility
- Command scripts exist + executable
- Event scripts exist + executable
- README.md present
- LICENSE file present (if declared)
- Icon file present (if declared)
- Platform/architecture compatibility
- Dependencies resolvable
- No duplicate command names
- Version is valid semver
- tests/ directory present

### Quality score

`devforgekit plugin quality [name|dir]` scores across 9 categories:

| Category | What it checks |
| --- | --- |
| Documentation | README, description, license, homepage, repository |
| Architecture | Capabilities, permissions, compatibility, commands/events |
| Testing | tests/ directory, test scripts |
| Signing | plugin.lock.json present (built) |
| Compatibility | Engine, platform, architecture |
| Versioning | Valid semver, schema v2+ |
| Manifest | Schema validation |
| Permissions | All permissions recognized |
| Examples | Command scripts exist |

### Diagnostics

`devforgekit plugin doctor` scans all discovered plugins for:

- Invalid plugins (bad manifests, incompatible engine)
- Duplicate command names across plugins
- Missing command/event scripts
- Missing or invalid dependencies
- Unbuilt plugins (no plugin.lock.json)
- Deprecated schema version (v1)
- Missing README or LICENSE
- Platform/architecture incompatibility

## Signing and trust

- **Algorithm:** Ed25519 via `node:crypto` (no external dependencies).
- **Key location:** `~/.config/devforgekit/plugin-signing-key{,.pub}`.
- **Self-trusted:** Your own local key is always trusted.
- **Third-party trust:** `devforgekit plugin trust <pubkey>` adds a key to the trusted set.
- **Missing/untrusted signature:** Warning + confirmation prompt (not a hard failure).
- **Checksum verification:** Mandatory — tampered packages are refused.

## Event hooks

Plugins can subscribe to events on the shared `pluginEvents` bus
(`core/events.js`):

| Event | When it fires | Payload |
| --- | --- | --- |
| `install.beforeInstall` | Before each package install | `{ name, category }` |
| `install.afterInstall` | After each package install | `{ name, category, status, code, durationMs }` |

Adding new events is additive — emitting one nobody has hooked is a
silent no-op. Hook failures are logged as warnings, never thrown.

## TUI integration

The Plugins page (`p` in the dashboard, see [TUI.md](TUI.md)) has four
tabs (v2.1.9 redesign):

- **Installed** (press `1`): Browse discovered plugins with capabilities/permissions.
- **Validation** (press `2`): Per-plugin validation results with score and check count.
- **Quality** (press `3`): Per-plugin quality scores across 9 categories.
- **Details** (press `4`): Full manifest breakdown (identity, compatibility, extension points, commands/events).

Press `x` to run the highlighted plugin's first command (suspends the
dashboard for interactive output).

## Command reference

| Command | Does |
| --- | --- |
| `plugin list` | List all discovered plugins |
| `plugin info <name>` | Show full manifest for one plugin |
| `plugin run <name> [command]` | Run a plugin's command directly |
| `plugin create <name> [dir]` | `-t/--template` to select template |
| `plugin test [dir]` | `--json` for machine-readable output |
| `plugin build [dir]` | Validate + regenerate README + write lock file |
| `plugin package [dir]` | `--out <dir>`, `--json` |
| `plugin publish <archive>` | `--to <dir>` |
| `plugin install <pathOrUrl>` | `-y/--yes` to skip confirmation |
| `plugin validate [dir]` | `--json` |
| `plugin quality [name\|dir]` | `--json` |
| `plugin doctor` | `--json` |
| `plugin trust <pubkey>` | Add a trusted signing key |
| `plugin keygen` | (Re-)generate local signing keypair |

## Best practices

- **Always declare `capabilities` and `permissions`** — they tell users what your plugin does and what it needs.
- **Set `compatibility.platforms`** if your plugin only works on specific OSes.
- **Include a LICENSE file** when you declare a license.
- **Write tests** in `tests/*.sh` — they run during `plugin test` and `plugin build`.
- **Use semver for `version`** — non-semver versions get a quality score warning.
- **Upgrade to schemaVersion 2** — v1 is deprecated and gets a diagnostic info message.
- **Pin `engine` to a conservative range** — `>=2.1.9` is safer than `>=1.0.0` if you use v2 features.

## Migration guide: v1 → v2

Schema v2 is fully backward-compatible — v1 manifests work without
changes. To upgrade:

1. Change `schemaVersion: 1` to `schemaVersion: 2`.
2. Add optional metadata fields as needed:
   ```yaml
   author: Your Name
   license: MIT
   repository: https://github.com/you/your-plugin
   keywords: ["your", "keywords"]
   capabilities: ["command"]
   permissions: ["shell"]
   compatibility:
     platforms: ["darwin", "linux", "win32"]
     architectures: ["x64", "arm64"]
   ```
3. Run `devforgekit plugin build` to regenerate README.md with the new fields.
4. Run `devforgekit plugin validate` to confirm everything checks out.

No data is lost — v2 only adds fields, never removes them.
