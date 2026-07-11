// Environment transaction log: every regeneration appends what actually
// changed (packages tracked/untracked, PATH entries added/removed,
// variables added/removed/changed, PATH order changes) to a per-day
// JSON file under ~/.config/devforgekit/logs/environment/. When a user
// reports "my PATH broke yesterday", this answers what the engine did
// and when - the same role core/ai's event log plays for AI commands.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { userConfigDir } from "../paths.js";

export function environmentLogDir() {
    return path.join(userConfigDir(), "logs", "environment");
}

// diffModels(before, after) -> the change set, or null when nothing
// observable changed (callers skip logging no-op regenerations).
export function diffModels(before, after) {
    const changes = {
        packagesAdded: after.sourcePackages.filter((p) => !before.sourcePackages.includes(p)),
        packagesRemoved: before.sourcePackages.filter((p) => !after.sourcePackages.includes(p)),
        pathAdded: after.path.filter((p) => !before.path.includes(p)),
        pathRemoved: before.path.filter((p) => !after.path.includes(p)),
        variablesAdded: [],
        variablesRemoved: [],
        variablesChanged: [],
        pathOrderChanged: false
    };

    const beforeVars = before.variables || {};
    const afterVars = after.variables || {};
    for (const key of Object.keys(afterVars)) {
        if (!(key in beforeVars)) changes.variablesAdded.push(key);
        else if (JSON.stringify({ ...beforeVars[key], sourcePackage: null }) !== JSON.stringify({ ...afterVars[key], sourcePackage: null })) changes.variablesChanged.push(key);
    }
    for (const key of Object.keys(beforeVars)) {
        if (!(key in afterVars)) changes.variablesRemoved.push(key);
    }

    // Order change only matters for entries present on both sides.
    const shared = after.path.filter((p) => before.path.includes(p));
    const beforeShared = before.path.filter((p) => shared.includes(p));
    changes.pathOrderChanged = JSON.stringify(shared) !== JSON.stringify(beforeShared);

    const anything = Object.values(changes).some((v) => (Array.isArray(v) ? v.length > 0 : v));
    return anything ? changes : null;
}

// recordTransaction(changes, { action }) -> the log file path written.
// One JSON array per day; corrupt/unreadable files start fresh rather
// than throwing away the regeneration that triggered the log write.
export function recordTransaction(changes, { action = "regenerate", now = new Date() } = {}) {
    const dir = environmentLogDir();
    mkdirSync(dir, { recursive: true });
    const day = now.toISOString().slice(0, 10);
    const file = path.join(dir, `${day}.json`);

    let entries = [];
    if (existsSync(file)) {
        try {
            const parsed = JSON.parse(readFileSync(file, "utf8"));
            if (Array.isArray(parsed)) entries = parsed;
        } catch {
            entries = [];
        }
    }

    entries.push({ timestamp: now.toISOString(), action, changes });
    writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
    return file;
}

// listTransactionDays() -> ["2026-07-10", ...], newest first.
export function listTransactionDays() {
    const dir = environmentLogDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
        .sort()
        .reverse();
}

export function readTransactions(day) {
    const file = path.join(environmentLogDir(), `${day}.json`);
    if (!existsSync(file)) return [];
    try {
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}
