# Compatibility Rules

The shipped rule set under `registry/compatibility/`, and how to add to it.
See [RuleSchema.md](RuleSchema.md) for the file format itself.

## Shipped rules

| File | Covers |
| --- | --- |
| `flutter.yaml` | Flutter 3.44 requires Dart ≥3.8 and Java ≥17, recommends CocoaPods ≥1.15 and Xcode ≥15, and is compatible with Android Studio. Flutter 3.24 is marked deprecated. |
| `node.yaml` | Node 22/20 recommend current pnpm/npm and are compatible with pnpm/npm/yarn; Node 18 is marked deprecated. |
| `docker.yaml` | `docker-desktop` and `colima` (the two install variants of the `docker` package) are declared as a `variantConflicts` pair, detected against real machine state (see [RuleSchema.md](RuleSchema.md)'s explanation of why this needs its own mechanism). |
| `android-studio.yaml` | Recommends Flutter and Java. Deliberately has no `versions` block - Android Studio has no scriptable version probe today, so a per-version rule could never be matched (see the file's own comment). |
| `postgres.yaml` | PostgreSQL 17/15 are compatible with the Supabase CLI; 13 is marked deprecated. |

These map directly to the product brief's own examples (Node + package
managers, Flutter + Xcode/Android Studio/CocoaPods, Docker Desktop vs.
Colima, PostgreSQL + a real ORM-adjacent CLI) using this registry's actual
package identities - see the note on **adapted examples** below.

## A note on adapted examples

The registry keeps one versionless package per tool (`flutter`, `node`,
`postgres`) - not per-framework-version packages like a hypothetical
`nextjs15` or `react19`. Cross-tool version rules therefore target real
package names plus a version range (`node` `>=22` recommends `pnpm`
`>=9`), not synthetic version-suffixed names. Similarly, `prisma`/`expo`/
`nextjs`/`react` aren't standalone registry packages (they're project-level
npm dependencies a generated project installs into its own
`package.json`, not global CLI tools DevForgeKit manages) - the shipped
`postgres.yaml` rule demonstrates the same rule type against `supabase`
instead, a real, already-registered CLI.

## Adding a new rule

Create `registry/compatibility/<name>.yaml` matching
`registry/schema/compatibility.schema.json` (`schemaVersion`, `name` matching a
real `registry/packages/<name>.yaml`, plus any combination of `conflicts`/
`recommends`/`variantConflicts`/`versions`) - no code changes needed. Every
name referenced anywhere in the file (`name` itself, and every `requires`/
`recommends`/`compatible`/`conflicts` target) must be a real registry
package name; run `devforgekit compatibility update` to check before
committing.

```yaml
schemaVersion: 1
name: my-tool
versions:
  "2.0":
    requires:
      some-dependency: ">=1.4"
    recommends:
      nice-to-have: ">=2"
    deprecated: false
```

If the tool needs installed-version detection and its `validate` command
doesn't already print one, add an optional `versionCommand` to its
`registry/packages/<name>.yaml` first (e.g. `docker --version`) - see
[RuleSchema.md](RuleSchema.md)'s version-detection section.

## Verifying your rule

```bash
./devforgekit compatibility update            # schema + integrity check only
./devforgekit compatibility explain <name>     # see it evaluated against what's actually installed
./devforgekit compatibility scan <name>        # see it folded into a real scan
```
