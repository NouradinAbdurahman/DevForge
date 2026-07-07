# Environment Graph

The Environment Graph (`devforgekit graph`, v1.3.6, overhauled for
**Environment Graph Excellence** in v2.1.4) models the entire local
development ecosystem as one graph: registry packages, compatibility
rules, Project Generator stacks, profiles/recipes/collections,
workspaces, plugins, configuration, and repair history - real
relationships between real DevForgeKit data, never invented. Everything
runs locally; there is no remote service involved.

This document covers what v2.1.4 changed and why. For the day-to-day
command reference, see [CLI.md](CLI.md)'s "Development Environment
Graph" section and the TUI section below.

## What v2.1.4 actually found and fixed

Before making any changes, this milestone started with a full audit of
`cli/src/core/devGraph.js` (the engine) and `cli/src/commands/graph.js`
(the CLI surface). Two findings shaped everything else:

**A real, severe bug: ~22% of edges were silently dangling.** Every
node's type is resolved one of two ways - a hardcoded name list (`node`,
`docker`, `postgres`, ...) or, failing that, the package's registry
`category` (e.g. `category: languages` → type `language`). The function
that types a node's *own* subject (`determineNodeType(pkg)`) had access
to the full package object and used both rules. The function that typed
an *edge's target* (`determineNodeTypeForName(name)`) only ever saw a
bare string - it had no `category` to fall back on, so it always
defaulted to `package`. Any package whose real type came from its
category rather than a hardcoded name - `dart`, `git`, `vscode`, and
many more - got a **different node id** depending on whether it was an
edge's source or its target. Measured against the real registry, this
left roughly 22% of all edges pointing at an id nothing else in the
graph ever created - dangling, dropped from traversal, and invisible.
`graph impact dart` returned an empty result even though Flutter
genuinely depends on Dart. The fix: `determineNodeTypeForName` now
accepts a `name → package` lookup map and calls the exact same
`determineNodeType()` logic when a real package exists, so both paths
agree. Verified fixed: 0 dangling edges against the real ~413-node graph
(confirmed by a real, non-mocked `buildGraph()` integration test - see
[Testing](#testing) below).

**Real duplicated logic and dead code, despite the file's own "no
duplicated logic" claim.** Orphan detection was implemented twice,
byte-for-byte identically, inside `computeStats()` and again as the
exported `findOrphans()`. Conflict-edge filtering had the same
duplication. `commands/graph.js`'s `focus` subcommand reimplemented
DOT/Mermaid formatting inline instead of calling the engine's own
`exportGraph()`. Five of `applyGraphFilter()`'s ten filter branches
(`duplicate`, `large`, `recent`, `outdated`, and half of `unused`) keyed
off properties (`isDuplicate`, `sizeBytes`, `lastUpdate`, `isOutdated`)
that `buildGraph()` never set on any node - always silently returning an
empty result. A private helper, `graph_reverseEmpty()`, was a hardcoded
`return false` stub whose own comment admitted as much. All of this is
fixed: shared helpers (`computeOrphanNodes`/`computeConflictEdges`) back
both `computeStats()` and the exported finder functions; `focus` calls
`exportGraph()`; the dead filter branches are removed (not silently
kept) and `unused`/`broken` are now genuinely real.

## Rich nodes and real relationships (Phases 2-3)

Package nodes now carry a real Manifest Quality Score
(`core/quality.js`'s `scoreManifest()` - the same score `registry
stats`/`info` use, synchronous, no network) and their real
`platforms`/`architectures` from the registry - not fabricated values.
`version` remains `null` - real per-tool installed-version detection
would mean shelling out again for every package, which this milestone
deliberately didn't add on top of an already-real scan cost (see
[Performance](#performance-caching)).

Two node types that were declared in `NODE_TYPES`/were structurally
impossible to populate before are now real:

- **`compatibility-rule`** nodes - one per `registry/compatibility/*.yaml`
  file (34 on the current registry), each wired with:
  - `RECOMMENDS` edges from that rule's top-level `recommends` array
  - `CONFLICTS_WITH` edges from its top-level `conflicts` array
  - `REQUIRES` edges from the union of every version block's `requires`
    keys (the schema's `requires` is version-scoped; the graph models
    "required in at least one declared version" rather than picking one)
- **`generator`** nodes - one per Project Generator stack (17), each
  wired with `RECOMMENDS` edges from that generator's real `recommends`
  array (Project Generator Excellence, v2.1.2) - e.g. the `flutter`
  generator stack recommends `firebase`, `supabase`, `android-studio`.

`REQUIRES` and `RECOMMENDS` are new edge types, added deliberately
narrow: they map onto real schema fields (a compatibility rule's own
`requires`/`recommends`, a generator's own `recommends`), not a
5-relationship-type wishlist implemented by guessing. `Optional` and
`Enhances` relationships aren't modeled - no existing DevForgeKit data
field distinctly captures that semantic today, so nothing claims to
support them.

**Repair history nodes now have real edges.** Before, every
snapshot/benchmark/repair "history" node was created with zero edges -
a structural guarantee that they'd always show up as 100% orphaned,
regardless of what was on the machine. Repair records genuinely do
reference the specific tools they touched (each result carries the
original compatibility `issue.tool`), so repair nodes now get real
`REPAIRS` edges to the tools they actually fixed. Snapshot and benchmark
records don't have an equivalent per-tool reference (a snapshot captures
the whole system at once; a benchmark measures abstract categories like
cpu/disk/memory) - rather than fabricate a connection, both types are
excluded from orphan analysis entirely (`NON_ORPHANABLE_TYPES` in
`devGraph.js`).

## Impact analysis now covers generators and compatibility rules for free

`analyzeImpact()`'s algorithm didn't need to change at all - it already
did a real reverse-BFS over whatever edges exist. Once compatibility-rule
and generator nodes carry real edges pointing at packages, `graph impact
<package>` naturally surfaces "which generator stacks recommend this"
and "which compatibility rules require/recommend this" as part of its
existing `byType` breakdown - a genuine capability gained by fixing the
data model, not by adding special-case code to the impact algorithm.

## Orphan analysis, grouped by type (Phase 6)

`graph orphan` now groups its output by node type
(`groupOrphansByType()`) instead of one flat list - "5 unused CLIs, 3
unused themes" reads a lot more actionably than a single undifferentiated
list. Snapshot/benchmark nodes are excluded from orphan output entirely
(see above); a disconnected repair node is still a meaningful orphan
(it fixed nothing tracked in the graph) and is not excluded.

## Expanded statistics (Phase 7)

`graph stats` now reports, on top of the existing node/edge/depth/orphan/
conflict/cycle counts: **installed** vs **missing** package counts, and
**category**/**platform**/**architecture** distribution - real, cheap
aggregations over properties `buildGraph()` already attaches to every
package node, not new probes.

## Export formats (Phase 8)

| Format | Status |
| --- | --- |
| JSON | real |
| Markdown | real |
| HTML | real |
| DOT / Graphviz | real |
| Mermaid | real |
| **SVG** | **new in v2.1.4** - see below |
| ASCII tree | real |
| PlantUML | real |
| PNG | **not supported, deliberately** |

**SVG** (`graph export svg`, `graph focus <name> --format svg`) is a
real, hand-rolled, well-formed SVG generator - no new dependency (no
canvas/image library) and no shelling out to an external tool (Graphviz's
`dot -Tsvg` isn't guaranteed to be installed on the machine running
DevForgeKit). It's honestly scoped: a deterministic grid layout, colored
by node type, not a force-directed auto-layout - readable for a focused
subgraph (`graph focus flutter --format svg`), visually dense for the
full ~413-node graph. **PNG is not implemented** for the same
dependency-free reasoning: rasterizing would require either a new heavy
dependency or an external binary this codebase can't assume is present.
The export error message says so explicitly rather than silently
omitting it from the list.

## Performance: caching (Phase 11)

`buildGraph()` does real work: it detects installed packages the same
way `packageIntel.js`'s scan does (one shell probe per package with a
`validate` command - all 261 packages today), and runs a real
compatibility scan. Measured cold: **~15-20 seconds**. That's real work
this module doesn't own and shouldn't try to shortcut - but paying it on
every one of `devforgekit graph`'s 13 subcommands, or every visit to the
TUI's Environment Graph page, would make "instant" a lie.

Two real fixes:

1. **Batched, not sequential, package probing.** The installed-package
   scan now runs in batches of 8 with a timer yield between batches (the
   same pattern `tui/data.js`'s `installedStatuses()` already uses for
   an identical ~261-probe scan), instead of one `await` at a time.
2. **`buildGraphCached()`** - a real, TTL-bound (30 minutes), always-
   overwritten on-disk cache (`~/.local/state/devforgekit/dev-graph/cache.json`),
   the same pattern `packageIntel.js`'s own `loadCache()`/`saveCache()`
   already established for an identical scan. Deliberately distinct from
   `saveGraph()`/`graph history` below - those are explicit, permanent,
   user-chosen snapshots; this cache is invisible plumbing that expires
   on its own. Every CLI subcommand and the TUI page read through this
   cache by default; `--refresh` (CLI) or the `F` key (TUI) forces a
   rebuild; `graph cache --clear` clears it outright.

Measured: ~15-20s cold, **~1ms on a cache hit**.

## AI integration (Phase 10)

`graph explain <name>` (and the TUI's `x` key on a selected node) asks a
configured AI provider to explain a node - why it's installed, what
depends on it, the real impact of removing it, any real conflicts -
using a context block built entirely from `analyzeImpact()`'s and the
graph's own `stats`. Before v2.1.4, this reused the generic `explain`
prompt template with an entire paragraph stuffed in as its "topic",
producing an awkward doubled "Explain ... Explain this node..."
phrasing - the same pattern several other AI integrations in this
codebase share (repair, packageIntel, snapshot, benchmark). This is the
first one broken out into its own dedicated prompt kind
(`graph-explain` in `core/ai/prompts/library.js`), which explicitly
instructs the model to reference only the real data in the context block
and say "not tracked in the graph" rather than guess when something
isn't there.

## TUI: the Environment Graph page (Phase 9)

Before v2.1.4, the graph had no TUI presence at all - CLI only. The new
page (shortcut `G`) follows this dashboard's established list+detail
pattern (the same shape `CompatibilityPage`/`ComponentsPage` already
use): a searchable/filterable node list (`/` to filter by name/type/
category) on the left, a detail panel on the right showing the
highlighted node's type, category, installed status, quality score,
platforms, real impact count, and real dependents (from
`analyzeImpact()`). `F` triggers a real rebuild (bypassing the cache);
`x` asks AI to explain the highlighted node, suspending to the real
terminal the same way other AI-powered TUI actions do.

Like every other page in this dashboard, its minimum terminal size
(`hooks/useTerminalSize.js`'s `graph: { columns: 90, rows: 26 }`) was
chosen by actually rendering the page with real, non-synthetic data at
candidate sizes and checking for Ink's known row-drop corruption
(documented in `docs/TUI.md`'s v2.1.1 and v2.1.3.2 notes) - not
estimated from how many lines the content looks like on paper.

## Testing

`cli/test/devGraph.test.js` (70 tests) covers every pure algorithm
against a hand-built synthetic fixture - fast, deterministic, and
unchanged in spirit from before v2.1.4, extended with new tests for the
distribution stats, the orphan-exclusion rules, the fixed `unused`/
`broken` filters, and SVG export.

`cli/test/devGraph-build.test.js` (new in v2.1.4, 8 tests) is a
deliberately separate file for real, non-mocked integration tests
against the actual `buildGraph()` pipeline - exactly the coverage gap
the v2.1.4 audit flagged as critical (a synthetic fixture can't catch a
bug in how the real registry gets turned into a graph, which is exactly
where this milestone's headline bug lived). `buildGraph()` runs once in
a shared `before()` hook (~15-20s) and every test asserts against that
one result, rather than each test paying the cost separately.

## Architecture reference

See `docs/PlatformArchitecture.md`'s Environment Graph Excellence
section for the full technical write-up (exact function signatures,
line-level detail) alongside the platform's other "vX Excellence"
milestones (Registry, Project Generator, AI Assistant).
