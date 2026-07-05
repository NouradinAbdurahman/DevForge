# Compatibility Engine

The Compatibility Engine (v1.2.5) is DevForgeKit's intelligence layer: instead of
only installing packages, it understands whether they actually work
*together* - Flutter 3.44 needs Dart 3.8+, Docker Desktop and Colima
compete for the same socket, Node 18 has gone end-of-life. It validates an
environment before installation (Recipes, Profiles, the Project
Generator), after installation (`compatibility scan`), and continuously
through Doctor - without changing the behavior of any existing command for
users who never touch it.

```bash
./devforgekit compatibility explain flutter
```

```text
=== flutter 3.44.4 ===
  Matched rule: versions.3.44

  flutter requires
    ✓ dart >=3.8 - found 3.12.2
    ✓ java >=17 - found 21.0.2
    ✓ cocoapods >=1.15 (recommended) - found 1.16.2
    ✓ xcode >=15 (recommended) - found 26.6
```

## Architecture

Same shape as every other subsystem in this platform: YAML rule files +
ajv schema validation + cross-reference integrity checks
(`core/compatibility/rules.js`, mirroring `core/registry.js`), a
PASS/WARNING/FAIL-derived score (`core/health.js`'s formula, extended to
five tiers - see below), and a `core/compatibility/` directory of small,
single-purpose modules mirroring `core/workspace/`'s layout:

| Module | Responsibility |
| --- | --- |
| `rules.js` | Load/validate `registry/compatibility/*.yaml`, merge in plugin-contributed rules, cross-check every reference |
| `versionMatch.js` | Version range matching (exact/minimum/maximum/range/wildcard/pre-release), built on `semver` |
| `versions.js` | Honest installed-version detection (`versionCommand`, or a heuristic parse of `validate`'s output) |
| `graph.js` | Dependency graph: missing/circular/duplicate-tool detection |
| `engine.js` | `scanCompatibility()` - the one function every integration point calls |
| `explain.js` | Per-component requirement breakdown (the worked example above) |
| `repair.js` | Turns a scan into a concrete, confirmable repair plan |
| `report.js` | Markdown/HTML/JSON export |
| `ai.js` | Reserved interface for v1.3.0 - see "What's not built yet" |

## The compatibility score

Every scan produces a score and one of five verdicts, in order of
severity:

| Verdict | When |
| --- | --- |
| **Unsupported** | Any finding flags a platform/architecture/version as explicitly unsupported |
| **Critical** | Any unmet hard requirement or real conflict, and no Unsupported finding |
| **Healthy** | Numeric score ≥ 90%, no Critical/Unsupported findings |
| **Warning** | Numeric score < 90%, no Critical/Unsupported findings |

The numeric score itself extends `core/health.js`'s PASS=full/WARNING=half/
FAIL=none formula to five tiers: `PASS` and `RECOMMEND` findings earn full
credit (a recommendation is informational, not a defect), `WARNING` earns
half, `CRITICAL` and `UNSUPPORTED` earn none. Critically, **Unsupported and
Critical always win the verdict outright** regardless of the numeric
score - a 95% score with one platform-unsupported component is reported as
"Unsupported," not "Healthy."

## CLI

```bash
./devforgekit compatibility                      # scan everything currently installed
./devforgekit compatibility scan [names...]       # --profile/--recipe/--workspace narrows the target set
./devforgekit compatibility check <names...>      # like scan, nonzero exit on CRITICAL/UNSUPPORTED (for CI)
./devforgekit compatibility explain <name>         # per-component requirement breakdown
./devforgekit compatibility repair [names...]      # generate (and, unless --dry-run, execute) a repair plan
./devforgekit compatibility graph [names...]       # dependency graph: missing/circular/duplicate findings
./devforgekit compatibility update                 # re-validate the local rule database (see below)
./devforgekit compatibility export <path>          # write a report: --format md|html|json|pdf
```

## Where it's wired in

- **Doctor** (`devforgekit doctor`) runs a compatibility scan over every
  installed component after its existing component diagnostics
  (`--skip-compatibility` to opt out).
- **Recipes and Profiles** run a pre-install compatibility check before
  `recipe install`/`profile install`/`import`, printing any
  Critical/Unsupported finding and asking for confirmation before
  proceeding (`--skip-compatibility`/`-y` to control it); `recipe show`
  and `profile list`/`show` display the resolved score.
- **Project Generator**: a generator can declare
  `compatibilityCheck: [componentNames]` to run the same pre-check before
  scaffolding - wired today for `flutter`, `react-native`, and `expo` (see
  [ProjectGenerator.md](ProjectGenerator.md)).
- **Workspace Manager**: `workspace compatibility scan|repair|history`
  scans/repairs a workspace's resolved components and records the result
  in its `compatibility.scanHistory`/`repairHistory` (see
  [WorkspaceManager.md](WorkspaceManager.md)).
- **Plugin SDK**: a plugin can contribute rules via an optional `rules`
  field in `plugin.yml` (see [RuleSchema.md](RuleSchema.md)).
- **Dashboard**: a 15th page (shortcut `m`) shows the score, findings, and
  a one-key repair (see [TUI.md](TUI.md)).
- **Registry**: `devforgekit registry stats` reports
  `compatibilityCoverage` - the % of packages with a dedicated
  compatibility rule file.
- **Inventory**: `devforgekit inventory` also writes
  `reports/compatibility.md` unless `--skip-compatibility`.

## What's not built yet (honest scope)

- **`compatibility update`** re-validates the *local*
  `registry/compatibility/*.yaml` files against schema and integrity - it
  does not fetch anything remote. No remote registry source exists
  anywhere in this platform yet (`core/config.js`'s `registryUrl`/
  `mirrors` are stored but unconsumed for the same reason).
- **LTS version matching** is not fabricated: there is no bundled,
  self-maintaining table of "which version is LTS right now." A rule can
  mark `lts: true`, but the engine reports it as an informational note
  ("cannot verify LTS status offline"), never a guessed pass or fail.
- **`--format pdf`** produces PDF-*ready* Markdown (clean, heading-
  structured, suitable for a tool like `pandoc`) - not a binary PDF. No
  PDF rendering library is bundled.
- **AI-assisted recommendations** (`core/compatibility/ai.js`) are a
  reserved, documented interface only - calling it throws, pointing at
  the planned v1.3.0 "AI Doctor & Intelligent Repair" release. See
  [PlatformArchitecture.md](PlatformArchitecture.md)'s roadmap.

See [RuleSchema.md](RuleSchema.md) for the rule file format,
[CompatibilityRules.md](CompatibilityRules.md) for the shipped rules and
how to add your own, and [RepairGuide.md](RepairGuide.md) for how repair
plans are built and executed.
