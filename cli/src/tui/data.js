// The dashboard's read-side data layer: thin, *cached* wrappers around
// the exact services the CLI commands already call (core/registry.js,
// commands/stats.js helpers, core/plugins.js, generators/) - zero
// business logic lives here, per the PRD's "no duplicated
// implementation" rule. Caching exists because Ink re-renders
// components many times per second while animating; re-parsing 250 YAML
// manifests on every render would visibly lag the UI. `refreshAll()`
// drops every cache (wired to the `R` key in App.js).
import { readdirSync } from "node:fs";
import path from "node:path";
import {
    loadCategories, loadPackages, loadCollections, loadProfiles, loadRecipes,
    getRegistryStats, searchPackages
} from "../core/registry.js";
import { computeRegistryAudit } from "../commands/registry.js";
import { validate } from "../core/installer.js";
import { outdatedPackages, osInfo, hardwareInfo, memoryGb, diskUsage, uptimeString, softwareUpdateStatus } from "../commands/stats.js";
import { scoreResults } from "../core/health.js";
import { discoverPlugins } from "../core/plugins.js";
import { listGenerators } from "../generators/index.js";
import { scoreGenerator } from "../core/generatorQuality.js";
import { loadConfig } from "../core/config.js";
import { repoRoot } from "../core/paths.js";
import { listWorkspaces, getActiveWorkspaceName } from "../core/workspace/store.js";
import { scanCompatibility } from "../core/compatibility/engine.js";
import { listAllProviders, storageLocation as aiStorageLoc } from "../core/ai/credentials/manager.js";
import { getActiveWorkspace } from "../core/workspace/store.js";
import { getHistory as getAIHistory } from "../core/ai/memory/history.js";
import { buildGraphCached } from "../core/devGraph.js";

const cache = new Map();

function cached(key, loader) {
    if (!cache.has(key)) cache.set(key, loader());
    return cache.get(key);
}

export function refreshAll() {
    cache.clear();
}

// --- Registry (synchronous underneath, cached for render speed) -------
export function registrySnapshot() {
    return cached("registry", () => {
        const categories = loadCategories();
        const packages = loadPackages();
        const collections = loadCollections();
        const profiles = loadProfiles();
        const recipes = loadRecipes();
        const stats = getRegistryStats({ categories, packages, collections, profiles, recipes });
        return { categories, packages, collections, profiles, recipes, stats };
    });
}

// registryAudit() - the same curated health scorecard `devforgekit
// registry audit` prints (v2.1.1 Registry Excellence), cached like every
// other registry read here since it re-walks all 261 packages.
export function registryAudit() {
    return cached("registryAudit", () => computeRegistryAudit(registrySnapshot()));
}

export function search(query) {
    return searchPackages(query);
}

// --- Machine state (async, slow, cached after first load) -------------
// installedStatuses runs every package's `validate` command - that's
// ~250 shell probes, tens of seconds. It's only ever kicked off in the
// background (Dashboard/Components show "checking..." until it lands)
// so the dashboard itself launches instantly - the PRD's "no blocking
// operations". Probes run in small batches with an explicit
// event-loop yield between them: a plain sequential await-chain of 250
// spawns starves stdin reads for seconds at a time, which showed up in
// the PTY smoke test as multiple keypresses coalescing into one input
// chunk ("cq") that matched no handler - see docs/TUI.md.
export function installedStatuses() {
    return cached("installed", async () => {
        const statuses = new Map();
        const probeable = registrySnapshot().packages.filter((p) => p.validate);
        const BATCH = 4;
        for (let i = 0; i < probeable.length; i += BATCH) {
            await Promise.all(probeable.slice(i, i + BATCH).map(async (pkg) => {
                try {
                    statuses.set(pkg.name, (await validate(pkg)) === 0);
                } catch {
                    statuses.set(pkg.name, false);
                }
            }));
            // A timer (not setImmediate) so the loop yields through the
            // timer phase and pending stdin I/O actually gets read.
            await new Promise((resolve) => setTimeout(resolve, 15));
        }
        return statuses;
    });
}

export function machineStats() {
    return cached("machineStats", async () => {
        const statuses = await installedStatuses();
        const results = [...statuses.values()].map((ok) => ({ status: ok ? "PASS" : "WARNING" }));
        const health = scoreResults(results);
        return {
            installed: [...statuses.values()].filter(Boolean).length,
            checked: statuses.size,
            health
        };
    });
}

export function outdated() {
    return cached("outdated", () => outdatedPackages());
}

// --- Device (real macOS/hardware probes, cached like the other slow
// background calls above - `R` refresh drops these caches too) --------
export function deviceOsInfo() {
    return cached("deviceOsInfo", () => osInfo());
}

export function deviceHardwareInfo() {
    return cached("deviceHardwareInfo", () => hardwareInfo());
}

export function deviceMemoryGb() {
    return cached("deviceMemoryGb", () => memoryGb());
}

export function deviceDiskUsage() {
    return cached("deviceDiskUsage", () => diskUsage());
}

export function deviceUptime() {
    return cached("deviceUptime", () => uptimeString());
}

export function deviceSoftwareUpdate() {
    return cached("deviceSoftwareUpdate", () => softwareUpdateStatus());
}

// --- Plugins / generators / config ------------------------------------
export function plugins() {
    return cached("plugins", () => discoverPlugins());
}

export function generators() {
    return listGenerators();
}

// generatorQualityScores() -> Promise<Map<id, scoreGenerator() result>> -
// the GeneratorPage's Stack Intelligence panel (v2.1.2 Phase 10) needs
// every stack's real Generator Quality Score (Phase 11), computed by
// actually calling each generator's pure generate(), so cached like
// installedStatuses() above rather than recomputed on every keystroke.
export function generatorQualityScores() {
    return cached("generatorQuality", async () => {
        const map = new Map();
        for (const g of listGenerators()) {
            map.set(g.id, await scoreGenerator(g));
        }
        return map;
    });
}

export function currentConfig() {
    return loadConfig(); // cheap YAML read; not cached so config edits show immediately
}

export function templates() {
    return cached("templates", () => {
        try {
            return readdirSync(path.join(repoRoot(), "templates"), { withFileTypes: true })
                .filter((e) => e.isDirectory())
                .map((e) => e.name)
                .sort();
        } catch {
            return [];
        }
    });
}

// getPackageSafe(name) -> manifest or null - registry.js's getPackage
// throws on unknown names, which is right for the CLI but inside a
// render loop a null is easier to branch on.
export function getPackageSafe(name) {
    return registrySnapshot().packages.find((p) => p.name === name) || null;
}

// --- Workspaces (cheap disk reads; not cached so create/switch/delete
// show up immediately on the very next render - same reasoning as
// currentConfig()) ------------------------------------------------------
export function workspaceList() {
    return listWorkspaces();
}

export function activeWorkspaceName() {
    return getActiveWorkspaceName();
}

// --- Compatibility (async, reuses the same installedStatuses probe so a
// component's installed-state check never runs twice). scanCompatibility
// only spawns an extra shell probe (version detection) for a component
// that actually has a compatibility rule declared - today a small subset
// of the registry (see registry/compatibility/) - so this doesn't need
// installedStatuses' own batched-with-yields treatment yet; revisit if
// rule coverage grows enough that this becomes a real block. -----------
export function compatibilitySnapshot() {
    return cached("compatibility", async () => {
        const statuses = await installedStatuses();
        const names = [...statuses.keys()].filter((name) => statuses.get(name));
        return scanCompatibility(names);
    });
}

// graphSnapshot() - the Environment Graph (v2.1.4). buildGraphCached()
// already has its own 30-minute on-disk TTL cache (core/devGraph.js), so
// wrapping it in this module's in-memory cache() just avoids redundant
// disk reads within one TUI session - the real ~15-20s cold build only
// ever happens once per cache window, same as every command-line
// `graph` subcommand.
export function graphSnapshot() {
    return cached("graph", () => buildGraphCached());
}

// --- Inventory reports (read what scripts/inventory.sh last wrote) ----
export function inventoryReports() {
    try {
        return readdirSync(path.join(repoRoot(), "reports"))
            .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
            .sort();
    } catch {
        return [];
    }
}

// --- AI (cached wrappers around core/ai/ for TUI pages) ---------------
export function aiProviders() {
    return cached("aiProviders", () => {
        return listAllProviders({ workspace: getActiveWorkspace() });
    });
}

export function aiConfig() {
    // Not cached — config edits should show immediately
    const config = loadConfig();
    return {
        provider: config.aiProvider && config.aiProvider !== "none" ? config.aiProvider : null,
        model: config.aiModel || null,
        endpoint: config.aiEndpoint || null
    };
}

export function aiHistory() {
    return cached("aiHistory", () => getAIHistory());
}

export function aiStorageLocation() {
    return cached("aiStorageLocation", () => aiStorageLoc());
}
