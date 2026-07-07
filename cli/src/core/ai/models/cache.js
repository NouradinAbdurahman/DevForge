// Model list caching: avoids hitting the provider API on every `ai model list`
// call. Cache is stored as a JSON file under ~/.config/devforgekit/ai-models/
// with a TTL of 1 hour. `--refresh` forces a fresh fetch.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { userConfigDir } from "../../paths.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function cacheDir() {
    return path.join(userConfigDir(), "ai-models");
}

function cacheFile(providerId) {
    return path.join(cacheDir(), `${providerId}.json`);
}

// getCachedModels(providerId) -> { models, age } | null
export function getCachedModels(providerId) {
    const file = cacheFile(providerId);
    if (!existsSync(file)) return null;
    try {
        const data = JSON.parse(readFileSync(file, "utf8"));
        const age = Date.now() - data.cachedAt;
        if (age > CACHE_TTL_MS) return null;
        return { models: data.models || [], age };
    } catch {
        return null;
    }
}

// setCachedModels(providerId, models) -> void
export function setCachedModels(providerId, models) {
    mkdirSync(cacheDir(), { recursive: true });
    const file = cacheFile(providerId);
    writeFileSync(file, JSON.stringify({ models, cachedAt: Date.now() }));
}

// getModelsWithCache(providerId, opts) -> string[]
// Checks cache first, falls back to the provider's listModels(), caches the result.
export async function getModelsWithCache(providerId, opts = {}) {
    if (!opts.refresh) {
        const cached = getCachedModels(providerId);
        if (cached) return cached.models;
    }
    const { getProvider } = await import("../providers/index.js");
    const provider = getProvider(providerId, opts);
    const models = await provider.listModels();
    setCachedModels(providerId, models);
    return models;
}

// clearModelCache(providerId?) -> void. Clears one provider's cache or all.
export function clearModelCache(providerId) {
    const dir = cacheDir();
    if (!existsSync(dir)) return;
    if (providerId) {
        const file = cacheFile(providerId);
        if (existsSync(file)) {
            try { unlinkSync(file); } catch { /* ignore */ }
        }
        return;
    }
    // Clear all
    try {
        for (const f of readdirSync(dir)) {
            try { unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
        }
    } catch { /* ignore */ }
}
