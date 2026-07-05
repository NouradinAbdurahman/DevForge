# Rule Schema

The compatibility rule manifest format (`registry/schema/compatibility.schema.json`),
one file per tool under `registry/compatibility/`, mirroring the
one-package-per-file convention `registry/packages/` already uses.

## Shape

```yaml
schemaVersion: 1
name: flutter                 # must match a real registry/packages/<name>.yaml
conflicts: [docker-desktop]    # version-independent tool-vs-tool conflicts (real package names)
recommends: [android-studio]   # version-independent "pairs well with"
variantConflicts:              # pairs of THIS package's own variant ids that conflict in practice
  - [docker-desktop, colima]
variantProbes:                 # variantId -> shell command (exit 0 = present), only used to check variantConflicts
  docker-desktop: "test -d '/Applications/Docker.app'"
  colima: "command -v colima"
versions:
  "3.44":
    requires:
      dart: ">=3.8"
      xcode: ">=15"
    recommends:
      cocoapods: ">=1.15"
    compatible: [android-studio]
    conflicts: []
    deprecated: false
    experimental: false
    unsupported: false
    lts: false
    platforms: [macos]
    architectures: [intel, apple-silicon]
```

Every field is optional except `schemaVersion` and `name` - a rule file can
declare just `conflicts`, just `versions`, or any combination.

## Rule types

| Field | Type | Meaning |
| --- | --- | --- |
| `conflicts` (top-level) | `string[]` | Real package names this tool conflicts with, at any version |
| `recommends` (top-level) | `string[]` | Real package names generally recommended alongside this tool |
| `variantConflicts` | `[string, string][]` | Pairs of this package's own `variants[].id` that conflict in practice (see below) |
| `variantProbes` | `{ variantId: command }` | How to detect each variant is actually present, for `variantConflicts` |
| `versions.<key>.requires` | `{ package: range }` | Hard requirement - unmet is **CRITICAL** |
| `versions.<key>.recommends` | `{ package: range }` | Soft requirement - unmet is **WARNING**, not CRITICAL |
| `versions.<key>.compatible` | `string[]` | Known-good pairings (informational **PASS**) |
| `versions.<key>.conflicts` | `string[]` | Conflicts specific to this version |
| `versions.<key>.deprecated` | `boolean` | **WARNING** |
| `versions.<key>.experimental` | `boolean` | **WARNING** |
| `versions.<key>.unsupported` | `boolean` | **UNSUPPORTED** (wins the verdict outright) |
| `versions.<key>.lts` | `boolean` | Informational note only - see [CompatibilityEngine.md](CompatibilityEngine.md)'s honest-scope section |
| `versions.<key>.platforms` | `string[]` | Narrows/overrides the package's own `platforms` for this version |
| `versions.<key>.architectures` | `string[]` | Narrows/overrides the package's own `architectures` for this version |

## Why `variantConflicts` exists

Some tools are modeled in the registry as **variants of one package**
(`registry/packages/docker.yaml` has `docker-desktop` and `colima` as two
install variants of the single package `docker`) - so an ordinary
`conflicts: [docker-desktop]` entry can't express "these two don't work
together," since both variants share the name `docker`. In practice a
user can still end up with both really installed (one via DevForgeKit, one
by hand) - `variantConflicts` + `variantProbes` detects that against real
machine state instead of against the registry's own install bookkeeping,
which only ever tracks one chosen variant at a time.

## Version matching

Range strings are matched by `core/compatibility/versionMatch.js`, built
on the `semver` package (already a CLI dependency):

| Form | Example | Notes |
| --- | --- | --- |
| Wildcard | `*`, `` (empty) | Always matches |
| Minimum | `>=3.8` | Native semver |
| Maximum | `<=27` | Native semver |
| Range | `>=3.8 <4.0` | Native semver |
| Exact / bare number | `27` | Coerced and compared directly if not a valid semver range |
| Pre-release | `>=3.44.0-beta.1` | `includePrerelease: true` throughout |

Loose version strings ("27", "3.44") are coerced via `semver.coerce()`
before comparison. If an installed version can't be detected or coerced at
all, matching returns `null` ("unverifiable") - reported as a WARNING, not
guessed as a pass or fail.

## Version detection

A package needs an optional `versionCommand` field
(`registry/schema/package.schema.json`) for the engine to read its
installed version - e.g. `docker --version`. If absent, the engine falls
back to parsing `validate`'s own output (many `validate` commands, like
`node --version`, already print a version); if neither yields a
recognizable version token, the tool's version is reported as "unknown"
and its version-specific rules are skipped - never guessed.

## Plugin-contributed rules

A plugin can contribute rules via an optional `rules` field in its
`plugin.yml` (`cli/src/schemas/plugin.schema.json`), which alone is enough
to make an otherwise commandless/eventless plugin valid:

```yaml
rules:
  requires:
    docker: ">=29"          # plain string range
    node: { version: ">=18" } # or the explicit { version } shape
  conflicts: [podman]
  recommends:
    pnpm: ">=9"
```

These are merged into the loaded rule set as synthetic entries keyed by
the plugin's own name (`source: "plugin"`) - exempt from the "must match a
real registry package" check every registry-authored rule file's own
`name` is held to, since a plugin's name is its own identity, not a
package.

## Integrity

`core/compatibility/rules.js`'s `checkRuleIntegrity` cross-checks every
name a rule references - its own `name`, every `requires`/`recommends`/
`compatible`/`conflicts` target (top-level and per-version), and every
`variantConflicts` id against the real package's declared `variants` -
against the real registry. Run `devforgekit compatibility update` to
re-validate the whole set on demand; `devforgekit registry generate` and
the CI test suite both exercise it on every push.
