# Repair Guide

How `devforgekit compatibility repair` turns a scan into action, and the
safety rules it never breaks.

## The two-step pipeline

```text
scanCompatibility()  ->  planRepair()  ->  executeRepairPlan()
     (find issues)        (decide what           (do it)
                           to do about them)
```

`core/compatibility/repair.js`'s `planRepair(scanResult)` reads the
*structured* fields `engine.js` attaches to each issue (`dependency`,
`conflictWith`, `variantConflict`, `recommendation`) - never regexes an
English sentence back apart - and turns each actionable one into exactly
one of:

| Action type | From | What it does |
| --- | --- | --- |
| `install` | A `requires` issue naming a missing dependency | `devforgekit component install <dep>` |
| `shell` | A `deprecated`/version-mismatch issue with a `Run: <cmd>` recommendation | Runs that command (usually the dependency's own `update`) |
| `conflict` | A `conflicts`/`conflictWith` issue | Uninstalls one of the two conflicting packages - **only after confirmation** |
| `manual` | A `variantConflict` issue | Never executed - see below |

## Never destructive without confirmation

`executeRepairPlan(actions, { assumeYes })` only ever removes anything
(`conflict` actions) after `lib/prompts.js`'s `confirm()` returns true -
unless `assumeYes` is explicitly set (`--yes`/`-y` on the CLI, or the
existing `DEV_SETUP_ASSUME_YES=1` convention this platform already uses
everywhere else). `install`/`shell` actions are additive/idempotent and
don't need confirmation, matching how `component install`/`update` already
behave without one.

## Why `variantConflict` actions are never auto-repaired

A `variantConflicts` finding (see [RuleSchema.md](RuleSchema.md)) means two
of one package's own install variants (e.g. `docker`'s `docker-desktop`
and `colima`) both appear installed. The registry only ever tracks *one*
chosen variant per package - there's no single "the package to uninstall"
to act on, so this always surfaces as a `manual` action: reported, never
executed. Resolving it means manually choosing which backend to keep
(e.g. `brew uninstall colima`) outside DevForgeKit's own uninstall path.

## Usage

```bash
./devforgekit compatibility repair                 # plan + execute over everything installed
./devforgekit compatibility repair flutter dart      # scoped to specific components
./devforgekit compatibility repair --dry-run         # print the plan only, change nothing
./devforgekit compatibility repair --yes             # don't prompt for conflict removals
```

A workspace has its own scoped equivalent, which also records the result:

```bash
./devforgekit workspace compatibility repair [name]   # --dry-run / -y supported the same way
./devforgekit workspace compatibility history [name]    # review past scans/repairs
```

## In the Dashboard

The Compatibility page's `F` key runs the same `planRepair`/
`executeRepairPlan` pipeline, but always through the suspend/resume
handoff (`suspend()`, the same mechanism the Doctor page uses to run
`scripts/doctor.sh`) - a `conflict` action's confirmation prompt needs the
real terminal, which Ink's raw-mode input would otherwise fight over.
