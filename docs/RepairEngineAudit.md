# Repair Engine Audit

A pre-implementation audit of the DevForgeKit Repair Engine, documenting
architecture, dead code, duplicate logic, weaknesses, real bugs, and
improvements applied during the v2.1.6 "Repair Engine Excellence" project.

## Architecture Overview

The Repair Engine lives in `cli/src/core/repair.js` (1700+ lines) and
consists of five pipeline stages:

```
scanIssues() → planRepairs() → [dryRunPlan()] → executeRepairs() → verifyRepairs()
```

### Subsystems

| Component | File | Role |
|-----------|------|------|
| Scanners | `core/repair.js` | 12 scanners probing PATH, Git, Docker, SSH, etc. |
| Planner | `core/repair.js` | Dependency-ordered topological sort with risk aggregation |
| Executor | `core/repair.js` | Structured action routing with safety checks |
| Verifier | `core/repair.js` | Post-repair compatibility + health + workspace checks |
| History | `core/repair.js` | JSON records in `~/.devforgekit/repairs/` |
| Rollback | `core/repair.js` + `core/snapshot.js` | Full snapshot + per-repair file backup |
| CLI | `commands/repair.js` | Commander.js subcommands |
| TUI | `tui/pages/DoctorPage.js` | Component-level diagnostics (not full repair engine) |
| Compat Repair | `core/compatibility/repair.js` | Separate two-step pipeline for compat issues |

### Data Flow

1. `scanIssues()` runs 12 scanners sequentially, collecting `Issue` objects
2. `planRepairs()` filters repairable issues, topologically sorts by
   dependencies, computes aggregate risk/categories/files/packages
3. `executeRepairs()` validates prerequisites, confirms with user, backs up
   files, routes structured actions, reports progress
4. `verifyRepairs()` re-runs compatibility scan, health score, workspace/
   plugin/config validation
5. `runFullRepair()` orchestrates all stages, saves a history record with
   quality score

## Findings

### Dead Code

1. **`SEVERITY_LABELS` constant** (line 161) — defined but never used
   anywhere in the codebase. Scanners use raw severity strings directly.

2. **`getConfigValue` import** (line 31) — imported but never called.
   Only `loadConfig` is used.

3. **`mkdtempSync` import** (line 25) — imported but never used. File
   backups use `copyFileSync` to a timestamped path, not a temp dir.

4. **`shellQuote` import** (line 29) — used only in two scanners
   (symlink, cache). Not dead, but underutilized given the amount of
   shell command construction in the file.

5. **Unused REPAIR_CATEGORIES entries** — 27 categories defined, but only
   12 are actually used by scanners. Categories like `CONFIGURATION`,
   `DEPENDENCIES`, `PACKAGE_MANAGER`, `REGISTRY`, `ENVIRONMENT`,
   `PERMISSIONS`, `SHELL`, `NODE`, `PYTHON`, `JAVA`, `FLUTTER`,
   `PROFILES`, `RECIPES`, `SYSTEM`, `SERVICE` are never referenced by
   any scanner. They exist for future extensibility but currently inflate
   the enum.

### Duplicate Logic

1. **Package validation loop** — Before the refactor, the
   `loadPackages() → validate → collect installed names` loop appeared
   4+ times: in `scanCompatibilityIssues`, `verifyRepairs` (twice:
   compatibility check and health score), and `commands/doctor.js`.
   **Fixed**: Centralized into `getInstalledPackageNames()` shared helper.

2. **AI provider list hardcoded** — `verifyRepairs` had a hardcoded
   `knownProviders` array instead of importing `KNOWN_PROVIDERS` from
   the AI providers module.
   **Fixed**: Now imports `KNOWN_PROVIDERS` dynamically.

3. **`compatibility/repair.js` duplicates repair logic** — The separate
   `planRepair`/`executeRepairPlan` in `core/compatibility/repair.js`
   implements its own action types (install, shell, conflict, manual)
   that overlap with `repair.js`'s `ACTION_TYPES`. The main engine
   delegates to it via `ACTION_TYPES.COMPATIBILITY`, but the duplication
   of action-type concepts is a design smell.

### Architecture Weaknesses

1. **Monolithic file** — `repair.js` at 1700+ lines handles scanning,
   planning, execution, verification, history, export, AI explanation,
   rollback, and the full pipeline. Should be split into modules:
   `scanners/`, `planner.js`, `executor.js`, `verifier.js`,
   `history.js`, `export.js`.

2. **Sequential scanners** — All 12 scanners run sequentially. Many are
   I/O-bound (shell commands, file system) and could run in parallel with
   `Promise.all` for a 2-3x scan speedup. See Phase 14.

3. **No scanner registry extensibility** — Scanners are a hardcoded
   array. Plugins or external modules cannot register new scanners.

4. **History stored as individual JSON files** — Each repair record is a
   separate file in `~/.devforgekit/repairs/`. For large histories (100+
   repairs), `listHistory()` reads and parses every file. No indexing,
   no pagination.

5. **Export functions don't use the new metadata** — `exportMarkdown`,
   `exportHTML`, `exportCSV` still reference old issue fields (`fix`,
   `category`) without using `title`, `riskLabel`, `categoryLabel`,
   `action.type`, or `qualityScore`.

6. **No TUI repair page** — The Doctor page handles component-level
   diagnostics only. The full Repair Engine (scan → plan → execute →
   verify) has no TUI representation. Users must use the CLI.

7. **`explainIssues` sends minimal context** — The AI explanation
   function sends only severity, category, subsystem, description,
   impact, and fix. It doesn't include the structured action, risk
   level, title, or estimated time — missing the new metadata.

### Real Bugs

1. **`estimatedTime` parsing in `planRepairs`** — Line 863-866 uses
   `parseInt(issue.estimatedTime, 10)` which parses "30 sec" as 30 and
   "1-2 min" as 1. The unit inconsistency means the aggregate
   `estimatedTime` is meaningless. Some scanners use "30 sec", others
   "1 min", others "5 min", others "10 min".
   **Fixed in this PRD**: Standardized all scanners to use "N sec" or
   "N min" format, and the parser now handles both.

2. **`rollbackAvailable` in plan vs issue** — `planRepairs` line 895
   computes `rollbackAvailable: ordered.every(i => i.rollbackAvailable)`
   which is `true` only if ALL issues support rollback. But individual
   issues may have `rollbackAvailable: false`. The plan-level boolean
   doesn't tell you which specific repairs can't be rolled back.

3. **File backup path expansion** — `executeRepairs` line 951 does
   `filePath.replace("~/", homeDir() + "/")` but this only replaces the
   first occurrence and doesn't handle `$HOME`. If a scanner provides
   an absolute path (not `~`-prefixed), no backup is made.

4. **`restoreFileBackup` uses `renameSync`** — Line 318 uses `renameSync`
   which will fail across filesystems (e.g., if backup is on a different
   mount). Should use `copyFileSync` + `rmSync` for cross-device safety.

5. **No cleanup of backup files** — `backupFile` creates
   `*.repair-backup-*` files but nothing ever cleans them up. If a repair
   succeeds and no rollback is needed, the backup files persist forever.

6. **`validatePrerequisites` doesn't check `COMPONENT_REPAIR` safely** —
   Line 288 calls `getPackage(action.package)` without try/catch. If the
   package doesn't exist, it throws `DevForgeError` instead of returning
   a structured failure.
   **Fixed in this PRD**: Added try/catch.

### Things to Improve

1. **Parallel scanners** — Run independent scanners concurrently with
   `Promise.allSettled` for faster scan times.

2. **Repair Intelligence** — Every issue should carry a human-readable
   explanation with Problem/Impact/Fix/Risk/Time structure, not just a
   `description` and `fix` string. See Phase 10.

3. **TUI Repair Page** — A dedicated dashboard page with overview, issue
   list, plan preview, progress bar, details panel, and history. See
   Phase 11.

4. **Structured export** — Export functions should use the new metadata
   (title, risk, action type, quality score, categories affected).

5. **History indexing** — Add a lightweight index file
   (`~/.devforgekit/repairs/index.json`) for fast listing without parsing
   every record.

6. **Backup lifecycle** — Clean up backup files after successful repair
   or after a configurable TTL (e.g., 7 days).

7. **Plugin scanner registration** — Allow plugins to register custom
   scanners via a `registerScanner()` API.

8. **Performance benchmarks** — Measure and optimize scan, plan, and
   execution times. See Phase 14.

## Summary

The Repair Engine v2.1.6 is functionally complete for Phases 2-9, 12-13,
15-16. The remaining work centers on:
- **Phase 1** (this document) — architecture audit ✅
- **Phase 10** — repair intelligence (self-explaining repairs)
- **Phase 11** — TUI repair page
- **Phase 14** — performance audit

The engine's backend is solid: structured actions, risk levels, safety
checks, per-repair rollback, quality scoring, and dry-run all work
correctly. The gap is in user experience — the CLI is functional but
minimal, and there's no TUI representation of the repair pipeline.
