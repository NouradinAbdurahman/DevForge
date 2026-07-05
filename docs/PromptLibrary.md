# Prompt Library

`cli/src/core/ai/prompts/library.js` assembles every prompt an `ai`
command sends - plain string composition, no business logic (the same
"formatting only" scope as `core/compatibility/report.js`).

## Structure

```text
buildPrompt(kind, context, input) -> [
  { role: "system", content: BASE_SYSTEM_PROMPT + domain snippet (if detected) + context JSON },
  { role: "user", content: the kind's instruction, filled in with `input` }
]
```

## The base system prompt

Grounds every response in the real context block and explicitly forbids
inventing tool names/versions/paths not present in it - the same "never
invent" principle `ai generate`/`ai planner` enforce structurally (see
[AIAssistant.md](AIAssistant.md)).

## Domain snippets

Ten short, real snippets (not filler) - one per domain the PRD names:
`flutter`, `docker`, `kubernetes`, `python`, `node`, `react`, `rust`,
`devops`, `security`, `databases`. `detectDomain(text)` is a plain
substring heuristic (not a classifier) - the first domain name mentioned
in the input gets its snippet layered into the system prompt. Honest about
what it is: a nudge toward that ecosystem's real conventions, not a claim
of deeper domain expertise.

## Instruction kinds

One per `ai` command, plus `plan` (the planner's own kind, not exposed as
a bare CLI verb):

| Kind | Used by | Asks for strict JSON? |
| --- | --- | --- |
| `chat` | `ai chat` | no - passes the user's text straight through |
| `doctor` | `ai doctor` | yes - `{ summary, reason, fix, estimatedTime, risk }` |
| `explain` | `ai explain <topic>` | no |
| `review` | `ai review` | no |
| `generate` | `ai generate` | yes - `{ stack, name, options }`, `stack` constrained to the context's `availableGeneratorStacks` |
| `analyze` | `ai analyze` | no |
| `summarize` | `ai summarize` | no |
| `optimize` | `ai optimize` | no |
| `repair` | `ai repair` | no - narrates an already-computed plan, never proposes new actions |
| `plan` | `ai planner <goal>` | yes - `{ profileName, description, collections, recipes, components }`, every name constrained to the context's `registryOptions` |

The three JSON kinds (`doctor`, `generate`, `plan`) each explicitly forbid
markdown fences and invented names - `diagnostics/doctor.js` and
`planner/planner.js` still defensively strip fences and validate every
returned name against the real registry before using anything, in case a
model doesn't comply exactly.

## Adding a new prompt kind

Add one entry to `library.js`'s `INSTRUCTIONS` map (a function
`(input) => instructionText`) and wire a new `commands/ai.js` subcommand
that calls `buildPrompt("<kind>", context, input)` - `buildPrompt` throws
immediately for an unregistered kind rather than silently falling back to
a generic prompt, so a typo is caught at the call site, not in a model's
confused response.
