# Workspace Manager Excellence Audit (v2.1.8)

Pre-implementation audit of the Workspace Manager subsystem, conducted to the same standard as the Repair Engine, Snapshot Engine, and Benchmark Engine audits.

## Architecture Overview

The Workspace Manager spans 14 source files:

| File | Lines | Responsibility |
|------|-------|----------------|
| `core/workspace/store.js` | 271 | CRUD: create/get/save/list/delete/rename/clone + active pointer + search |
| `core/workspace/switcher.js` | 74 | Orchestrated switch across all subsystems + rollback |
| `core/workspace/health.js` | 252 | PASS/WARNING/FAIL verification sweep across all subsystems |
| `core/workspace/snapshot.js` | 164 | Point-in-time snapshots: create/list/restore/delete/export/compare |
| `core/workspace/bundle.js` | 167 | Portable tar.gz export/import with auto-repair |
| `core/workspace/schema.js` | 140 | AJV validation, defaults factory, migration v1→v2 |
| `core/workspace/env.js` | 248 | Plain variables + AES-256-GCM encrypted secrets + .env import/export |
| `core/workspace/git.js` | 103 | Real `git config --global` identity management |
| `core/workspace/ssh.js` | 117 | ~/.ssh/config marker-block Host management + known_hosts |
| `core/workspace/docker.js` | 59 | `docker context use` switching |
| `core/workspace/kubernetes.js` | 49 | `kubectl config use-context` + namespace |
| `core/workspace/cloud.js` | 105 | gcp/azure real switches, aws env-var, others reference-only |
| `core/workspace/shellIntegration.js` | 128 | Shell rc-file hook + generated workspace-shell.sh |
| `core/workspace/markerBlock.js` | ~80 | Idempotent marker-block editor for rc files |
| `commands/workspace.js` | 659 | CLI command surface (30+ subcommands) |
| `tui/pages/WorkspacePage.js` | 245 | TUI dashboard page (list/create/switch/verify/snapshot/delete) |

**Test files**: 12 test files (workspace-store, workspace-switcher, workspace-health, workspace-bundle, workspace-env, workspace-git, workspace-ssh, workspace-infra, workspace-marker-block, workspace-schema, workspace-shell-integration, workspace-snapshot).

## Strengths

1. **Honest scoping everywhere**: Each subsystem documents exactly what it can and cannot do. Cloud providers that lack a real global switch are explicitly "reference-only." Shell prompt/theme are reference-only because PS1 syntax varies too much. This is a flagship pattern.

2. **Per-subsystem fault isolation**: `switchToWorkspace()` attempts every subsystem and records results without hard-failing. A missing `docker`/`kubectl` never blocks a switch.

3. **Security model**: Secrets never appear in workspace.json — only key names. AES-256-GCM with per-workspace keys. Exports/clones/bundles exclude secrets and snapshot history by default (`WORKSPACE_TRANSFER_EXCLUDES`).

4. **Schema validation + migration**: AJV-validated documents with a migration table. Every save re-validates. Every load migrates.

5. **Snapshot system**: Safety snapshot before rollback. Timestamp-derived IDs with random suffix. Corrupt snapshots are surfaced, not hidden.

6. **Marker-block editor**: Idempotent rc-file editing with backup. Same pattern used for SSH config blocks.

7. **Search**: Multi-field search across name, description, tags, profile, recipes, collections, components, git identity, SSH, cloud references.

## Weaknesses

### W1: No `lastUsed` tracking
Workspaces don't record when they were last switched to or used. The `modifiedAt` field only updates on explicit saves, not on switches. This means "recently used" sorting and display is impossible.

### W2: Verification output is flat
`verifyWorkspace()` returns a flat list of PASS/WARNING/FAIL strings. There's no structured per-subsystem grouping — the user sees "git is installed", "git-lfs is installed", "Docker context 'prod' exists" as a flat list, not grouped under "Git" and "Docker" headings with details (User, Email, Context, Status).

### W3: No switch preview
`switchToWorkspace()` applies everything immediately. There's no "preview what would change" mode showing the delta between the current live state and the target workspace's declared configuration. The user can't see "Git identity will change from John to Jane, Docker context will switch from default to prod" before confirming.

### W4: No workspace diff
There's no way to diff two workspaces' configurations. `snapshot compare` diffs a snapshot vs current or vs another snapshot, but only at the top-level key granularity (added/removed/changed field names). No per-subsystem diff (git name differs, docker context differs, etc.).

### W5: Bundle import lacks preview/validation phase
`importWorkspaceBundle()` extracts, repairs, and writes in one step. No preview mode to see what would be imported, what references would be dropped, and whether the bundle is compatible before committing.

### W6: No checksums on bundles
Bundle archives have no integrity verification. A corrupted or tampered .tar.gz would be extracted without any detection.

### W7: TUI page is minimal
The Workspace TUI page only supports list/create/switch/verify/snapshot/delete. No snapshots browsing, no history, no switch preview, no health score display, no search/filter, no tags view. The footer explicitly says "Full management... is available via CLI."

### W8: No workspace health score in metadata
`verifyWorkspace()` returns a score, but it's not stored or cached. Each verify re-runs all checks. There's no quick "health" field on the workspace document or list output.

### W9: No performance benchmarking
No way to measure how long switch/verify/snapshot/restore/bundle operations take. No benchmark command for the workspace subsystem.

### W10: `resolveWorkspaceComponents` duplicated
The `resolveWorkspaceComponents` function exists in both `commands/workspace.js` (lines 44-56) and `core/workspace/health.js` (lines 46-69). Both do the same thing — expand profile/recipes/collections into a component set — but with slightly different shapes (one returns a Set, the other returns `{ adHoc, viaExpansion }`).

## Real Bugs

### B1: `deleteWorkspace` doesn't clean up SSH blocks
When a workspace is deleted, `store.js`'s `deleteWorkspace()` removes the directory and clears the active pointer if needed, but never calls `ssh.js`'s `removeWorkspaceSsh(name)`. The workspace's `Host` blocks persist in `~/.ssh/config` forever, pointing at a workspace that no longer exists.

### B2: `createWorkspace` log message is misleading
Line 181 of `commands/workspace.js`: `logger.success(\`Created workspace '${name}' at ${path.dirname(process.cwd())}\`)` — this prints the parent of the current working directory, not the workspace's actual path. The workspace is created under `~/.config/devforgekit/workspaces/<name>/`, not under `path.dirname(process.cwd())`.

### B3: `deactivateWorkspace` doesn't clean up SSH blocks
When deactivating, `switcher.js` only clears the shell file and the active pointer. SSH Host blocks for the formerly-active workspace remain in `~/.ssh/config`. While this is by design (SSH blocks are additive and coexist), the deactivate flow could at least note that SSH blocks persist.

### B4: `rollbackToSnapshot` always creates a safety snapshot even for inactive workspaces
`switcher.js` line 65: `createSnapshot(name, { message: ... })` runs unconditionally, even when the workspace is not active (so there's nothing live to lose). The safety snapshot is only meaningful for active workspaces where live state will be re-applied.

## Dead Code

### D1: `describeDockerReferences` and `describeKubernetesReferences` are unused
`docker.js` exports `describeDockerReferences()` and `kubernetes.js` exports `describeKubernetesReferences()`, but neither is called anywhere in the codebase. They were likely intended for health/display but health.js reads the fields directly.

### D2: `variables` field in schema is unused
`schema.js`'s `createWorkspaceDoc()` creates a top-level `variables: {}` field, but the actual env variables live under `env.variables`. The top-level `variables` is never read or written by any module.

## Duplicate Logic

### DL1: `resolveWorkspaceComponents` (see W10 above)
Two implementations of the same expansion logic.

### DL2: `tempDir` helper
`bundle.js` has its own `tempDir()` function (line 23-25). The benchmark engine and other modules have similar patterns. A shared `withTempDir` helper would reduce duplication.

## Improvement Plan

### Phase 2: Better Metadata
- Track `lastUsedAt` on switch
- Expose structured metadata: git identity details, ssh identity count, docker context, k8s context, cloud refs, env var/secret counts, health score, compatibility status
- Add `getWorkspaceMetadata(doc)` function returning a rich metadata object

### Phase 3: Better Verification
- Group results by subsystem (Git, SSH, Docker, Kubernetes, Cloud, Env, Components, Plugins, AI, Editor)
- Include structured details per check (not just "PASS: git is installed" but { subsystem: "git", field: "user.name", value: "John", status: "PASS" })
- Add `verifyWorkspaceStructured()` returning grouped results

### Phase 4: Better Switching
- Add `previewSwitch(name)` returning what would change for each subsystem
- Add `--preview` flag to `workspace switch` command
- Show current → target for each subsystem

### Phase 5: Workspace Diff
- Add `diffWorkspaces(nameA, nameB)` comparing all subsystems
- Add `workspace diff <a> <b>` CLI command
- Per-subsystem diff: git, ssh, docker, k8s, cloud, env, shell, ai, editor

### Phase 6: Better Import/Export
- Add `previewBundleImport(archivePath)` — extract to temp, report what would be imported, what references would be dropped, compatibility status
- Add checksum (SHA-256) to bundle.json, verify on import
- Add `--preview` flag to `workspace import`

### Phase 7: Workspace Health Score
- Cache health score on workspace document after verify
- Display health score in list/show/TUI
- Per-subsystem health breakdown

### Phase 8: TUI Redesign
- Tabs: Overview, Workspaces, Snapshots, History, Switch Preview
- Health score card with per-subsystem indicators
- Search and tag filtering
- Snapshot browsing and restore
- Switch preview panel

### Phase 9: Performance Benchmark
- Add `benchmarkWorkspace()` measuring switch/verify/snapshot/restore/bundle times
- Add `workspace benchmark` CLI command

### Phase 10: Bug Fixes
- Fix B1: Call `removeWorkspaceSsh(name)` in `deleteWorkspace()`
- Fix B2: Print actual workspace path in create success message
- Fix B3: Document SSH block persistence in deactivate output
- Fix B4: Only create safety snapshot for active workspaces in rollback

### Phase 11: Dead Code Cleanup
- Remove D1: `describeDockerReferences` and `describeKubernetesReferences`
- Remove D2: Top-level `variables` field from schema
- Consolidate DL1: Single `resolveWorkspaceComponents` helper
