# Migration Guide

How to upgrade DevForgeKit across versions, and what changes between
major versions.

## General upgrade

```bash
devforgekit self-update          # git pull + npm install + config migration + plugin updates
devforgekit self-update --dry-run  # preview without changes
```

The self-update system handles:
- Git pull (repo + registry + bundled plugins/recipes/profiles)
- `npm install` for CLI dependencies
- Config migration (versioned migration framework)
- User plugin updates
- Changelog summary
- Full rollback on any step failure

## v1.x → v2.x

### Config format

The config file moved from `~/.devforgekit/config.json` (JSON) to
`~/.config/devforgekit/config.yaml` (YAML). The self-update system
migrates automatically. If you have a manual setup:

```bash
# Old: ~/.devforgekit/config.json
# New: ~/.config/devforgekit/config.yaml
```

New config fields added in v2.x: `tuiTheme`, `startupAnimation`,
`startupAnimationSpeed`, `reducedMotion`, `onboardingSeen`.

### Plugin schema v1 → v2 (v2.1.9)

Schema v2 is fully backward-compatible — v1 manifests work without
changes. To upgrade:

1. Change `schemaVersion: 1` to `schemaVersion: 2`.
2. Add optional metadata fields:
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
3. Run `devforgekit plugin build` to regenerate README.md.
4. Run `devforgekit plugin validate` to confirm.

No data is lost — v2 only adds fields, never removes them.

### Workspace schema v1 → v2 (v1.2.5)

The Compatibility Engine added a `compatibility` field to workspace
definitions. The migration framework handles this automatically. If
`migrateWorkspace` encounters a newer schema than it supports, it
throws rather than guessing.

### Registry quality fields (v1.1.3 / v2.1.1)

All registry packages gained optional `documentation`, `architectures`,
`stability`, `lastVerified`, and `ciVerified` fields. Existing packages
without these fields still validate — they just get a lower Manifest
Quality Score.

The Manifest Quality Score was redesigned in v2.1.1 from 10 checks (3
of which were the same `ciVerified` boolean counted three times) to 13
checks grouped into 6 categories (Metadata/Documentation/Reliability/
Discoverability/Compatibility/Platform Support). Scores may change
after upgrade — this is expected and reflects more accurate assessment.

### TUI (v1.2.3)

The interactive terminal dashboard was added in v1.2.3. It's purely
additive — all classic CLI commands work exactly as before. If you
prefer the classic CLI:

```bash
DEVFORGEKIT_NO_TUI=1 devforgekit <command>
# or
devforgekit <command>  # any argument skips the TUI
```

### AI Assistant (v1.3.0)

The AI Assistant degrades gracefully with no provider configured —
every command prints a clear, actionable message instead of crashing.
To enable:

```bash
export OPENAI_API_KEY="sk-..."     # or ANTHROPIC_API_KEY, GEMINI_API_KEY, etc.
devforgekit config set aiProvider openai
```

### DEV Graph (v1.3.6 / v2.1.4)

The Development Environment Graph was added in v1.3.6. In v2.1.4, a
node-ID mismatch bug was fixed that caused ~22% of edges to be silently
dangling. If you have saved graph history from v1.3.6, old snapshots
may show different connectivity after the fix — this is expected.

### Plugin SDK (v1.2.0 → v2.1.9)

The Plugin SDK has evolved significantly:
- v1.2.0: Basic lifecycle (create/test/build/package/publish/install)
- v2.1.9: Schema v2, 8 templates, validation, quality scoring, diagnostics

Existing v1 plugins continue to work. Run `devforgekit plugin doctor`
to check for issues and get recommendations.

## Version compatibility matrix

| DevForgeKit | Plugin schema | Workspace schema | Config format | Node.js |
| --- | --- | --- | --- | --- |
| v1.0-v1.1 | v1 | v1 | JSON | ≥18 |
| v1.2-v2.0 | v1 | v1→v2 | JSON→YAML | ≥18 |
| v2.1.x | v1 + v2 | v2 | YAML | ≥18 |
| v2.2.x (planned) | v1 + v2 | v2 | YAML | ≥18 |

## Breaking changes

There have been no breaking changes to the CLI command interface. All
commands that worked in v1.0 still work in v2.1.9. The `devforgekit`
dispatcher's fallback table ensures bash commands work even if Node.js
isn't installed.

### Config migration framework

The self-update system includes a versioned migration framework. Each
migration is a function that transforms the config from one version to
the next. Migrations run in order, and the framework tracks which
migrations have been applied. If a migration fails, the entire update
rolls back.

### Plugin signing keys

If you generated a plugin signing keypair in v1.2.0, it continues to
work in v2.1.9. The key format (Ed25519) hasn't changed. Keys are
stored at:
- `~/.config/devforgekit/plugin-signing-key` (private, mode 0600)
- `~/.config/devforgekit/plugin-signing-key.pub` (public)

## Manual migration

If `self-update` isn't available (very old version):

```bash
git pull origin main
cd cli && npm install
devforgekit doctor  # verify everything works
```
