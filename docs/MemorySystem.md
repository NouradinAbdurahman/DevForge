# Memory System

`cli/src/core/ai/memory/history.js` is a capped local JSON event log at
`~/.config/devforgekit/ai/history.json` - the same shape as
`workspace.compatibility.scanHistory`/`repairHistory`
([WorkspaceManager.md](WorkspaceManager.md)).

## What it stores - and what it never stores

Per the PRD's own instruction ("never stores user conversations"), this
module records **structured facts about what happened**, never the
contents of a chat conversation:

```json
{ "type": "ai-doctor", "summary": "Flutter itself is healthy...", "timestamp": "2026-01-01T00:00:00.000Z", "risk": "none" }
```

`chat/session.js`'s conversation turns (`turns`) are held in-memory only
for the duration of a session and are never written to this file, or
anywhere else on disk - closing the chat (or the process) discards them.
This is consistent with this codebase's existing privacy posture: workspace
secret *values* never travel in exports/snapshots (only their key names
do), and `telemetry` is opt-in and currently inert.

## Event types recorded today

| Type | Recorded by | Extra fields |
| --- | --- | --- |
| `ai-doctor` | `ai doctor` | `risk` |
| `ai-explain`/`ai-review`/`ai-analyze`/`ai-summarize`/`ai-optimize` | the matching command | - |
| `ai-generate` | `ai generate`, after a project is actually created | - |
| `ai-repair` | `ai repair`, after the repair plan runs | - |
| `ai-plan` | `ai planner` | `collections`/`recipes`/`components` counts |
| `ai-chat` | when a chat session ends | turn count only, never the turns themselves |

## API

- `recordEvent(type, summary, [data])` - appends one entry (capped at 200,
  oldest dropped first, matching `workspace.compatibility.scanHistory`'s
  own cap).
- `getHistory()` - returns `[]` (never throws) if the file doesn't exist
  or is corrupt - the same "degrade gracefully" convention
  `core/workspace/store.js`'s `listWorkspaces()` already uses for a bad
  entry.
- `clearHistory()` - resets to an empty log.

`devforgekit ai history` is the CLI surface over `getHistory()`.
