// AI Memory: a capped local JSON event log at
// ~/.config/devforgekit/ai/history.json - the same shape as
// workspace.compatibility.scanHistory/repairHistory. Stores structured
// facts about what happened (a repair ran, a project was generated), never
// the contents of a chat conversation - the PRD's own instruction ("never
// stores user conversations"), and consistent with this codebase's
// existing privacy posture (workspace secrets never travel in exports;
// telemetry is opt-in and currently inert).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { userConfigDir } from "../../paths.js";

const MAX_ENTRIES = 200;

function historyPath() {
    return path.join(userConfigDir(), "ai", "history.json");
}

export function getHistory() {
    const file = historyPath();
    if (!existsSync(file)) return [];
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    } catch {
        return [];
    }
}

// recordEvent(type, summary, [data]) -> the recorded entry. `data` is any
// additional plain, structured fields (e.g. { score, verdict } for a
// doctor run) - never raw prompt/response text.
export function recordEvent(type, summary, data = {}) {
    const entry = { type, summary, timestamp: new Date().toISOString(), ...data };
    const history = [...getHistory(), entry].slice(-MAX_ENTRIES);
    const file = historyPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(history, null, 2)}\n`);
    return entry;
}

export function clearHistory() {
    const file = historyPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "[]\n");
}
