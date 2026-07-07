// AI usage statistics: tracks request counts, response times, most used
// models, and favorite providers — all locally, never uploaded.
// Stored at ~/.config/devforgekit/ai/stats.json alongside history.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { userConfigDir } from "../../paths.js";

function statsPath() {
    return path.join(userConfigDir(), "ai", "stats.json");
}

function emptyStats() {
    return {
        totalRequests: 0,
        byDate: {},
        byModel: {},
        byProvider: {},
        byCommand: {},
        responseTimes: [],
        firstUsed: null,
        lastUsed: null
    };
}

export function getStats() {
    const file = statsPath();
    if (!existsSync(file)) return emptyStats();
    try {
        return { ...emptyStats(), ...JSON.parse(readFileSync(file, "utf8")) };
    } catch {
        return emptyStats();
    }
}

// recordRequest({ provider, model, command, responseTimeMs }) -> void
export function recordRequest({ provider, model, command, responseTimeMs }) {
    const stats = getStats();
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);

    stats.totalRequests++;
    stats.byDate[dateKey] = (stats.byDate[dateKey] || 0) + 1;
    stats.byModel[model] = (stats.byModel[model] || 0) + 1;
    stats.byProvider[provider] = (stats.byProvider[provider] || 0) + 1;
    if (command) stats.byCommand[command] = (stats.byCommand[command] || 0) + 1;
    if (responseTimeMs != null) {
        stats.responseTimes.push(responseTimeMs);
        if (stats.responseTimes.length > 500) stats.responseTimes = stats.responseTimes.slice(-500);
    }
    if (!stats.firstUsed) stats.firstUsed = now.toISOString();
    stats.lastUsed = now.toISOString();

    const file = statsPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(stats, null, 2)}\n`);
}

// getStatsSummary() -> { todayCount, weekCount, mostUsedModel, favoriteProvider, avgResponseTime }
export function getStatsSummary() {
    const stats = getStats();
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const todayCount = stats.byDate[todayKey] || 0;
    const weekCount = Object.entries(stats.byDate)
        .filter(([date]) => new Date(date) >= weekAgo)
        .reduce((sum, [, count]) => sum + count, 0);

    const mostUsedModel = Object.entries(stats.byModel)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const favoriteProvider = Object.entries(stats.byProvider)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const avgResponseTime = stats.responseTimes.length > 0
        ? Math.round(stats.responseTimes.reduce((a, b) => a + b, 0) / stats.responseTimes.length)
        : null;

    return {
        totalRequests: stats.totalRequests,
        todayCount,
        weekCount,
        mostUsedModel,
        favoriteProvider,
        avgResponseTime,
        byModel: stats.byModel,
        byProvider: stats.byProvider,
        byCommand: stats.byCommand,
        firstUsed: stats.firstUsed,
        lastUsed: stats.lastUsed
    };
}

export function clearStats() {
    const file = statsPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(emptyStats(), null, 2)}\n`);
}
