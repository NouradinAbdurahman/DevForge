# AI Development Assistant

The AI Development Assistant (v1.3.0) is DevForgeKit's intelligence layer: a
unified provider abstraction over cloud and local LLMs, a context engine
that assembles what DevForgeKit already knows about the machine, and a set
of AI-assisted commands that turn that context into human-readable
guidance - not a chatbot bolted on the side, but every existing subsystem
(registry, compatibility, workspace, project generator) made reasoned-over.

```bash
./devforgekit config set aiProvider ollama   # or openai/anthropic/gemini/groq/openrouter/lmstudio
./devforgekit ai doctor
```

```text
=== Flutter itself is healthy. The iOS toolchain cannot build. ===
  Reason: CocoaPods 1.15 is below the required version.
  Recommended fix: brew upgrade cocoapods
  Estimated time: 15 seconds
  Risk: none
```

## Honesty first

With no provider configured (the default), every `ai` command prints a
clear, actionable message instead of crashing or faking a response:

```text
! No AI provider configured.
i Run 'devforgekit config set aiProvider <openai|anthropic|gemini|groq|openrouter|ollama|lmstudio>' to choose one, or pass --provider explicitly.
i Cloud providers also need an API key: set the matching env var (e.g. OPENAI_API_KEY), or reference a workspace secret via the active workspace's ai.apiKeyRef.
```

Every provider client is a real REST client - no mocked responses ship in
production code. See [ProviderAPI.md](ProviderAPI.md) for the wire-format
details and [PlatformArchitecture.md](PlatformArchitecture.md)'s
Compatibility Engine section for the same honesty precedent this module
follows (LTS status, `compatibility update`'s "local files only" scope).

## Architecture

`cli/src/core/ai/`, one concern per directory (mirrors `core/compatibility/`
and `core/workspace/`):

| Module | Responsibility | Doc |
| --- | --- | --- |
| `providers/` | Real REST clients for every provider + the registry that builds them | [ProviderAPI.md](ProviderAPI.md) |
| `context/` | Pure aggregation of what DevForgeKit already knows - no new data collection | [ContextEngine.md](ContextEngine.md) |
| `prompts/` | Base system prompt, 10 domain snippets, one instruction template per command | [PromptLibrary.md](PromptLibrary.md) |
| `memory/` | A capped local event log - never a chat transcript | [MemorySystem.md](MemorySystem.md) |
| `diagnostics/doctor.js` | Turns a scan into the worked "summary/reason/fix/estimatedTime/risk" example | this doc |
| `planner/planner.js` | Maps a goal onto real registry collections/recipes/components | this doc |
| `chat/session.js` | In-memory turn-taking chat session | this doc |
| `embeddings/search.js` | Real embeddings when supported, lexical fallback otherwise | this doc |
| `tools/registry.js` | A plain function registry the code above calls - not an autonomous agent loop | this doc |
| `models/models.js` | Lists a provider's available models | this doc |

## CLI

```bash
./devforgekit ai                    # status if unconfigured, else opens chat
./devforgekit ai chat [--stream]
./devforgekit ai doctor              # the worked example above
./devforgekit ai explain <topic>     # e.g. "compatibility", or a component name
./devforgekit ai review              # inside a project directory
./devforgekit ai generate [prompt]   # maps onto a real Project Generator stack
./devforgekit ai analyze
./devforgekit ai summarize
./devforgekit ai optimize
./devforgekit ai repair [-y]         # AI-narrated compatibility repair
./devforgekit ai planner <goal>      # e.g. "I want to become a backend engineer"
./devforgekit ai models
./devforgekit ai providers [--check]
./devforgekit ai history
```

## Never invents, never executes without confirmation

Two scope boundaries carried through every command:

- **`ai generate`/`ai planner` select from what's real.** `generate` maps
  a description onto one of the Project Generator's actual 16 stacks
  (`cli/src/generators/index.js`) and runs the exact same
  `runProjectGenerator` every `devforgekit new` call already uses - never
  freehand file generation. `planner` maps a goal onto real registry
  collections/recipes/components (passed to the model as grounding data);
  any name the model returns that isn't real is dropped and reported in
  `plan.dropped`, never silently acted on.
- **No autonomous execution.** `ai repair` explains a repair plan, then
  runs it through the exact same `core/compatibility/repair.js`
  `executeRepairPlan` every `compatibility repair` call uses - a
  conflicting-package removal still requires explicit confirmation. The
  `tools/` module (PRD naming) is a plain function registry the
  assistant's own code calls directly (gather context, run a scan) - not
  an LLM function-calling loop that decides what to execute on its own.

## Dashboard

A 16th page ("AI Assistant", shortcut `e` - `a` was already taken by About
and `m` by Compatibility) shows request/response chat, grounded the same
way `ai chat` is. Not token-streamed (see the module's own doc comment for
why) - the CLI's `ai chat --stream` covers real token streaming.

## Config and workspace integration

`core/config.js`'s `aiProvider`/`aiModel`/`aiEndpoint` set the default
provider/model/endpoint for every `ai` command; `--provider`/`--model`/
`--endpoint` override them per-invocation. API key resolution order: the
provider's own env var (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`) → the active
workspace's declared secret via its `ai.apiKeyRef` field (already part of
`workspace.schema.json` since the Workspace Manager shipped) → none.
Ollama/LM Studio need no key (local servers).
