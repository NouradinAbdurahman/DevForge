// Semantic search: real embeddings when a provider that exposes an
// embeddings endpoint is configured and its index has been built
// (`buildEmbeddingsIndex`), cached to disk keyed by provider so switching
// providers never reuses another provider's vector space. Without one,
// falls back to the registry's existing lexical `searchPackages()` -
// never a fabricated "semantic" ranking over untrained data.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { userConfigDir } from "../../paths.js";
import { loadPackages, searchPackages } from "../../registry.js";
import { getProvider } from "../providers/index.js";

function cachePath(providerId) {
    return path.join(userConfigDir(), "ai", `embeddings-${providerId}.json`);
}

function loadCache(providerId) {
    const file = cachePath(providerId);
    if (!existsSync(file)) return null;
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    } catch {
        return null;
    }
}

function saveCache(providerId, index) {
    const file = cachePath(providerId);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(index));
}

function cosineSimilarity(a, b) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// buildEmbeddingsIndex(providerId, opts) -> the built index
// ([{ name, vector }, ...]), embedding every registry package's
// name+description exactly once and caching the result.
export async function buildEmbeddingsIndex(providerId, opts = {}) {
    const provider = getProvider(providerId, opts);
    const packages = loadPackages();
    const texts = packages.map((p) => `${p.name}: ${p.description}`);
    const { vectors } = await provider.embeddings(texts, opts);
    const index = packages.map((p, i) => ({ name: p.name, vector: vectors[i] }));
    saveCache(providerId, index);
    return index;
}

export function hasEmbeddingsIndex(providerId) {
    return Boolean(loadCache(providerId));
}

// semanticSearch(query, [{ providerId, ...opts }]) -> ranked package names,
// best match first.
export async function semanticSearch(query, { providerId, ...opts } = {}) {
    const cache = providerId ? loadCache(providerId) : null;
    if (!cache) {
        return searchPackages(query).map((r) => r.pkg.name);
    }

    const provider = getProvider(providerId, opts);
    const { vectors } = await provider.embeddings(query, opts);
    const queryVector = vectors[0];
    return cache
        .map((entry) => ({ name: entry.name, score: cosineSimilarity(queryVector, entry.vector) }))
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.name);
}
