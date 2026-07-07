# Context Engine

`cli/src/core/ai/context/gather.js`'s `gatherContext()` is pure
aggregation - every field it returns comes from a subsystem that already
existed before the AI Assistant did. There is no new probing, telemetry,
or data collection here; this module only asks questions the rest of
DevForgeKit already knows how to answer.

## What `gatherContext()` returns

```js
{
  cwd: string,
  platform: { id, label, architecture },                              // core/platform's OS Abstraction Layer (v2.1.3) - never a raw process.platform string
  config: { editor, shell, packageManager, aiProvider, aiModel },   // core/config.js's loadConfig()
  workspace: {                                                       // core/workspace/store.js's getActiveWorkspace(), or null
    name, profile, collections, recipes, components,
    lastCompatibilityScan: { score, verdict, timestamp } | null       // workspace.compatibility.scanHistory's last entry
  } | null,
  git: { isRepo: false } | { isRepo: true, branch, changedFiles },    // real `git` calls against `cwd`
  dockerAvailable: boolean,                                           // commandExists("docker")
  availableGeneratorStacks: string[],                                 // generators/index.js's listGenerators() ids (v2.1.3)
  recentActivity: { type, summary, timestamp }[],                     // the last few entries from AI memory (v2.1.3) - never chat contents

  // only with { full: true }:
  installedComponents: string[],       // every registry package whose validate command currently passes
  compatibility: { issues, score, verdict, ... },   // core/compatibility/engine.js's scanCompatibility()
  registry: { totalComponents, totalCategories, totalCollections, totalProfiles, totalRecipes, qualityScore, ... }  // core/registry.js's getRegistryStats() (v2.1.3)
}
```

## Why `full` defaults to false

`installedComponents`/`compatibility`/`registry` all require real work -
running every installed component's `validate` command (~261 shell
probes today), a compatibility scan, or reading every package/collection/
profile/recipe YAML file - genuinely useful for `ai doctor`/`ai analyze`/
`ai optimize`, which explicitly opt in, but wasteful for `ai chat`/
`ai explain <topic>`, which usually don't need it. Every command in
`commands/ai.js` decides for itself whether to pass `full: true`. The
lighter fields above them (`platform`, `availableGeneratorStacks`,
`recentActivity`) are cheap enough (no I/O, or one small local file read)
to include in every gather regardless.

## What this deliberately does not do

- **No new telemetry.** Nothing here is collected or stored beyond what
  `gatherContext()` returns for the current call - see
  [MemorySystem.md](MemorySystem.md) for what (structured events, never
  this context blob) actually persists to disk.
- **No secrets.** Workspace secret *values* are never included - only
  structural fields (`name`, `profile`, `collections`, ...). A workspace's
  `ai.apiKeyRef` is a secret *reference*, resolved separately by
  `providers/index.js`'s `resolveApiKey`, never surfaced in the context
  blob an LLM prompt embeds.
- **No arbitrary filesystem reads.** `git` status is the only thing read
  from the current project directory - there is no "read every file in
  cwd and paste it into the prompt" behavior; `ai review` relies on the
  model reasoning from git/tooling signals, not a raw file dump.

## Where it's used

Every `commands/ai.js` subcommand calls `gatherContext()` (via
`prompts/library.js`'s `buildPrompt()`, which embeds the result as a JSON
block in the system prompt) except the ones that need extra grounding
data layered on top: `ai generate` adds `availableGeneratorStacks`
(`cli/src/generators/index.js`'s real stack list) and `ai planner` adds
`registryOptions` (real collection/recipe/component names) - both merged
into the base context object, never replacing it.
