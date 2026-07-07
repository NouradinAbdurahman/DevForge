// The Development Environment Graph (DEV Graph) engine (v1.3.6, overhauled
// for Environment Graph Excellence in v2.1.4 - see docs/EnvironmentGraph.md).
// Models the entire development ecosystem as a unified graph connecting
// every DevForgeKit subsystem: packages, runtimes, workspaces, recipes,
// profiles, collections, plugins, services, themes, configs, benchmarks,
// snapshots, repairs, compatibility rules, project generator stacks, and
// AI providers.
//
// This is the single source of truth for environment relationships.
//
// Reuses every existing subsystem - genuinely, this time (a v2.1.4 audit
// found the previous version of this comment listed several modules that
// were imported but never actually called - see the CHANGELOG for the
// full list of what that audit found and fixed):
//   - registry.js (loadPackages, loadProfiles, loadRecipes, loadCollections)
//   - compatibility/graph.js (detectCycles)
//   - compatibility/engine.js (scanCompatibility)
//   - compatibility/rules.js (loadCompatibilityRules - real compatibility-rule nodes/edges, v2.1.4)
//   - generators/index.js (listGenerators - real generator/stack nodes, v2.1.4)
//   - quality.js (scoreManifest - real per-node quality scores, v2.1.4)
//   - workspace/store.js (listWorkspaces)
//   - plugins.js (discoverPlugins)
//   - installer.js (validate)
//   - repair.js (listHistory/getRepairRecord - real REPAIRS edges from actual repair history, v2.1.4)
//   - config.js (loadConfig)
//   - tui/theme.js (listThemes)
//   - paths.js, version.js, logger.js, errors.js
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { loadPackages, loadProfiles, loadRecipes, loadCollections } from "./registry.js";
import { detectCycles } from "./compatibility/graph.js";
import { scanCompatibility } from "./compatibility/engine.js";
import { loadCompatibilityRules } from "./compatibility/rules.js";
import { scoreManifest } from "./quality.js";
import { listGenerators } from "../generators/index.js";
import { validate } from "./installer.js";
import { listWorkspaces } from "./workspace/store.js";
import { discoverPlugins } from "./plugins.js";
import { listHistory as listRepairHistory, getRepairRecord } from "./repair.js";
import { loadConfig } from "./config.js";
import { userStateDir } from "./paths.js";
import { getVersion } from "../version.js";
import { logger } from "./logger.js";
import { DevForgeError } from "./errors.js";

// ─── Constants ────────────────────────────────────────────────────────

export const DEV_GRAPH_VERSION = 1;
export const DEV_GRAPH_DIR = "dev-graph";

// Node types
export const NODE_TYPES = {
    PACKAGE: "package",
    FRAMEWORK: "framework",
    RUNTIME: "runtime",
    LANGUAGE: "language",
    SDK: "sdk",
    CLI: "cli",
    PLUGIN: "plugin",
    RECIPE: "recipe",
    PROFILE: "profile",
    WORKSPACE: "workspace",
    COLLECTION: "collection",
    DATABASE: "database",
    SERVICE: "service",
    PACKAGE_MANAGER: "package-manager",
    THEME: "theme",
    CONFIGURATION: "configuration",
    BENCHMARK: "benchmark",
    SNAPSHOT: "snapshot",
    REPAIR: "repair",
    COMPATIBILITY_RULE: "compatibility-rule",
    AI_PROVIDER: "ai-provider",
    GENERATOR: "generator"
};

// Edge types
export const EDGE_TYPES = {
    INSTALLED_BY: "installed-by",
    DEPENDS_ON: "depends-on",
    REQUIRED_BY: "required-by",
    USES: "uses",
    PROVIDES: "provides",
    CONFLICTS_WITH: "conflicts-with",
    UPDATES: "updates",
    REPAIRS: "repairs",
    BENCHMARKS: "benchmarks",
    CONFIGURED_BY: "configured-by",
    CREATED_BY: "created-by",
    BELONGS_TO: "belongs-to",
    EXPORTS: "exports",
    IMPORTS: "imports",
    COMPATIBLE_WITH: "compatible-with",
    INCOMPATIBLE_WITH: "incompatible-with",
    // v2.1.4: real relationship semantics from registry/compatibility
    // rule files' own `requires`/`recommends` fields (see loadCompatibilityRules()
    // below) - distinct from DEPENDS_ON (a package's own registry
    // `dependencies` field, a different real signal).
    REQUIRES: "requires",
    RECOMMENDS: "recommends"
};

// Categories that map to node types
const CATEGORY_TO_NODE_TYPE = {
    mobile: "framework",
    languages: "language",
    databases: "database",
    services: "service",
    editors: "cli",
    terminals: "cli",
    fonts: "package",
    security: "cli",
    cloud: "cli",
    iot: "cli",
    science: "package",
    design: "package",
    browsers: "package",
    communication: "package",
    productivity: "package",
    media: "package",
    networking: "cli",
    virtualization: "service",
    "package-managers": "package-manager",
    "version-managers": "package-manager",
    ai: "package"
};

// Known package managers
const PACKAGE_MANAGER_NAMES = ["brew", "npm", "pnpm", "yarn", "bun", "pip", "pipx", "poetry", "uv", "gem", "composer", "cargo", "go"];

// Known runtimes/languages
const RUNTIME_NAMES = ["node", "bun", "deno", "python", "python3", "ruby", "go", "java", "rust", "swift", "kotlin", "scala", "elixir", "phoenix", "haskell", "lua", "perl", "php", "r", "julia", "nim", "ocaml", "clojure", "c", "cpp", "csharp"];

// Known databases
const DATABASE_NAMES = ["postgres", "mysql", "redis", "mongodb", "mariadb", "sqlite", "cassandra", "cockroachdb", "neo4j", "influxdb", "elasticsearch", "arangodb", "duckdb", "clickhouse", "minio", "qdrant", "chromadb"];

// Known services
const SERVICE_NAMES = ["docker", "docker-compose", "colima", "lima", "podman", "nerdctl", "minikube", "kind", "kubectl", "helm", "nginx", "caddy", "vault", "consul", "nomad", "grafana", "prometheus", "netdata", "minikube"];

// Known SDKs
const SDK_NAMES = ["flutter", "android-studio", "xcode", "sdkman", "asdf", "mise", "volta"];

function graphDir() {
    return path.join(userStateDir(), DEV_GRAPH_DIR);
}

function makeNodeId(type, name) {
    return `${type}:${name}`;
}

// ─── Node Creation ────────────────────────────────────────────────────

function makeNode({ id, type, name, label, properties = {} }) {
    return {
        id: id || makeNodeId(type, name),
        type,
        name,
        label: label || name,
        properties
    };
}

function makeEdge({ from, to, type, properties = {} }) {
    return { from, to, type, properties };
}

// ─── Graph Builder ────────────────────────────────────────────────────

export async function buildGraph({ onProgress } = {}) {
    logger.section("DEV Graph: Building");
    logger.info("Collecting nodes from all subsystems...\n");

    const nodes = new Map();
    const edges = [];
    const installedPackages = new Set();

    function addNode(node) {
        nodes.set(node.id, node);
        return node;
    }

    function addEdge(edge) {
        edges.push(edge);
    }

    // ── 1. Registry Packages ────────────────────────────────────────
    if (onProgress) onProgress({ subsystem: "registry", status: "running" });
    logger.info("  Loading registry packages...");
    const packages = loadPackages();
    // packagesByName: the fix for a real, severe bug (v2.1.4 audit) - edge
    // targets used to be typed by name alone (determineNodeTypeForName had
    // no access to a package's `category`), while a node's own type used
    // the full package object (name lists first, category fallback). Any
    // package whose type came from its category rather than a hardcoded
    // name list - dart, git, vscode, ~22% of all edges on the real
    // registry - got a DIFFERENT node id depending on whether it was an
    // edge source or an edge target, leaving those edges permanently
    // dangling. Passing this map through makes both paths agree.
    const packagesByName = new Map(packages.map((p) => [p.name, p]));

    // Detect installed packages - batched (not sequential) shell probes,
    // the same BATCH-with-a-timer-yield pattern tui/data.js's
    // installedStatuses() already uses for the identical ~250-probe scan.
    // Sequential awaits here measured ~20s on a full registry (v2.1.4
    // audit) - unacceptable for a feature meant to feel instant; sitting
    // behind buildGraphCached()'s TTL cache below means most callers never
    // pay this at all, but the raw scan itself needed to be faster too.
    const BATCH = 8;
    const probeable = packages.filter((p) => p.validate);
    for (let i = 0; i < probeable.length; i += BATCH) {
        await Promise.all(probeable.slice(i, i + BATCH).map(async (pkg) => {
            try {
                if ((await validate(pkg)) === 0) installedPackages.add(pkg.name);
            } catch {
                // Not installed
            }
        }));
        await new Promise((resolve) => setTimeout(resolve, 5));
    }

    for (const pkg of packages) {
        const isInstalled = installedPackages.has(pkg.name);
        const nodeType = determineNodeType(pkg);
        const node = makeNode({
            type: nodeType,
            name: pkg.name,
            label: pkg.name,
            properties: {
                description: pkg.description || null,
                category: pkg.category || null,
                version: null,
                license: pkg.license || null,
                homepage: pkg.homepage || null,
                repository: pkg.repository || null,
                tags: pkg.tags || [],
                stability: pkg.stability || null,
                platforms: pkg.platforms || [],
                architectures: pkg.architectures || [],
                installMethod: pkg.install?.method || null,
                installed: isInstalled,
                healthStatus: isInstalled ? "healthy" : "not-installed",
                // Real, existing signal (core/quality.js's Manifest
                // Quality Score, same one `registry stats`/`info` use) -
                // not fabricated, and cheap (synchronous, no network).
                qualityScore: scoreManifest(pkg).score
            }
        });
        addNode(node);

        // Dependency edges
        for (const dep of pkg.dependencies || []) {
            addEdge(makeEdge({ from: node.id, to: makeNodeId(determineNodeTypeForName(dep, packagesByName), dep), type: EDGE_TYPES.DEPENDS_ON }));
        }

        // Installed-by edge (connect to package manager)
        if (pkg.install?.method) {
            const pmId = makeNodeId(NODE_TYPES.PACKAGE_MANAGER, pkg.install.method);
            if (!nodes.has(pmId)) {
                addNode(makeNode({ type: NODE_TYPES.PACKAGE_MANAGER, name: pkg.install.method, label: pkg.install.method }));
            }
            addEdge(makeEdge({ from: node.id, to: pmId, type: EDGE_TYPES.INSTALLED_BY }));
        }
    }
    logger.success(`  ${packages.length} packages loaded (${installedPackages.size} installed)`);
    if (onProgress) onProgress({ subsystem: "registry", status: "done", count: packages.length });

    // ── 2. Profiles ─────────────────────────────────────────────────
    if (onProgress) onProgress({ subsystem: "profiles", status: "running" });
    logger.info("  Loading profiles...");
    try {
        for (const profile of loadProfiles()) {
            const node = makeNode({
                type: NODE_TYPES.PROFILE,
                name: profile.name,
                label: profile.name,
                properties: { description: profile.description || null }
            });
            addNode(node);

            for (const component of profile.components || []) {
                addEdge(makeEdge({ from: node.id, to: makeNodeId(determineNodeTypeForName(component, packagesByName), component), type: EDGE_TYPES.USES }));
            }
        }
    } catch {
        // Profiles loading failed
    }
    if (onProgress) onProgress({ subsystem: "profiles", status: "done" });

    // ── 3. Recipes ──────────────────────────────────────────────────
    if (onProgress) onProgress({ subsystem: "recipes", status: "running" });
    logger.info("  Loading recipes...");
    try {
        for (const recipe of loadRecipes()) {
            const node = makeNode({
                type: NODE_TYPES.RECIPE,
                name: recipe.name,
                label: recipe.name,
                properties: { description: recipe.description || null }
            });
            addNode(node);

            for (const component of recipe.components || []) {
                addEdge(makeEdge({ from: node.id, to: makeNodeId(determineNodeTypeForName(component, packagesByName), component), type: EDGE_TYPES.REQUIRED_BY }));
            }
        }
    } catch {
        // Recipes loading failed
    }
    if (onProgress) onProgress({ subsystem: "recipes", status: "done" });

    // ── 4. Collections ──────────────────────────────────────────────
    if (onProgress) onProgress({ subsystem: "collections", status: "running" });
    logger.info("  Loading collections...");
    try {
        for (const collection of loadCollections()) {
            const node = makeNode({
                type: NODE_TYPES.COLLECTION,
                name: collection.name,
                label: collection.name,
                properties: { description: collection.description || null }
            });
            addNode(node);

            for (const component of collection.components || []) {
                addEdge(makeEdge({ from: node.id, to: makeNodeId(determineNodeTypeForName(component, packagesByName), component), type: EDGE_TYPES.USES }));
            }
        }
    } catch {
        // Collections loading failed
    }
    if (onProgress) onProgress({ subsystem: "collections", status: "done" });

    // ── 5. Workspaces ───────────────────────────────────────────────
    if (onProgress) onProgress({ subsystem: "workspaces", status: "running" });
    logger.info("  Loading workspaces...");
    try {
        for (const ws of listWorkspaces()) {
            const node = makeNode({
                type: NODE_TYPES.WORKSPACE,
                name: ws.name,
                label: ws.name,
                properties: { description: ws.description || null, valid: ws.valid }
            });
            addNode(node);

            for (const tool of ws.tools || []) {
                addEdge(makeEdge({ from: node.id, to: makeNodeId(determineNodeTypeForName(tool, packagesByName), tool), type: EDGE_TYPES.USES }));
            }
        }
    } catch {
        // Workspaces loading failed
    }
    if (onProgress) onProgress({ subsystem: "workspaces", status: "done" });

    // ── 6. Plugins ──────────────────────────────────────────────────
    if (onProgress) onProgress({ subsystem: "plugins", status: "running" });
    logger.info("  Loading plugins...");
    try {
        for (const plugin of discoverPlugins()) {
            const node = makeNode({
                type: NODE_TYPES.PLUGIN,
                name: plugin.name,
                label: plugin.name,
                properties: { valid: plugin.valid, error: plugin.error || null }
            });
            addNode(node);

            for (const req of plugin.requires || []) {
                addEdge(makeEdge({ from: node.id, to: makeNodeId(determineNodeTypeForName(req, packagesByName), req), type: EDGE_TYPES.DEPENDS_ON }));
            }
        }
    } catch {
        // Plugins loading failed
    }
    if (onProgress) onProgress({ subsystem: "plugins", status: "done" });

    // ── 7. Configuration ────────────────────────────────────────────
    if (onProgress) onProgress({ subsystem: "config", status: "running" });
    logger.info("  Loading configuration...");
    try {
        const config = loadConfig();
        const configNode = makeNode({
            type: NODE_TYPES.CONFIGURATION,
            name: "devforgekit-config",
            label: "DevForgeKit Configuration",
            properties: { editor: config.editor, shell: config.shell, packageManager: config.packageManager }
        });
        addNode(configNode);

        // AI provider node
        if (config.aiProvider && config.aiProvider !== "none") {
            const aiNode = makeNode({
                type: NODE_TYPES.AI_PROVIDER,
                name: config.aiProvider,
                label: config.aiProvider,
                properties: { model: config.aiModel, endpoint: config.aiEndpoint }
            });
            addNode(aiNode);
            addEdge(makeEdge({ from: configNode.id, to: aiNode.id, type: EDGE_TYPES.CONFIGURED_BY }));
        }
    } catch {
        // Config loading failed
    }
    if (onProgress) onProgress({ subsystem: "config", status: "done" });

    // ── 8. Themes ───────────────────────────────────────────────────
    if (onProgress) onProgress({ subsystem: "themes", status: "running" });
    logger.info("  Loading themes...");
    try {
        const { listThemes } = await import("../tui/theme.js");
        for (const theme of listThemes()) {
            const node = makeNode({
                type: NODE_TYPES.THEME,
                name: theme.id,
                label: theme.id,
                properties: { description: theme.description || null }
            });
            addNode(node);
        }
    } catch {
        // Theme loading failed
    }
    if (onProgress) onProgress({ subsystem: "themes", status: "done" });

    // ── 9. Compatibility conflicts (live scan against what's installed) ─
    if (onProgress) onProgress({ subsystem: "compatibility", status: "running" });
    logger.info("  Scanning compatibility...");
    try {
        const compatResult = await scanCompatibility([...installedPackages]);
        for (const issue of compatResult.issues || []) {
            if (issue.severity === "CRITICAL" && issue.conflictWith) {
                const fromId = makeNodeId(determineNodeTypeForName(issue.tool, packagesByName), issue.tool);
                const toId = makeNodeId(determineNodeTypeForName(issue.conflictWith, packagesByName), issue.conflictWith);
                addEdge(makeEdge({ from: fromId, to: toId, type: EDGE_TYPES.CONFLICTS_WITH, properties: { message: issue.message } }));
            }
        }
    } catch {
        // Compatibility scan failed
    }
    if (onProgress) onProgress({ subsystem: "compatibility", status: "done" });

    // ── 10. Compatibility rules (static declarations, not a live scan) ──
    // Makes NODE_TYPES.COMPATIBILITY_RULE real (v2.1.4 - it was declared
    // but zero nodes of this type were ever created before this) and adds
    // the richer REQUIRES/RECOMMENDS edge semantics the PRD asked for,
    // straight from registry/compatibility/*.yaml's own `requires`/
    // `recommends`/`conflicts` fields - real relationships someone already
    // wrote down, not derived or guessed. `requires` is version-scoped in
    // the schema (`versions.<v>.requires`); the graph models "is required
    // in at least one declared version" rather than picking one version.
    if (onProgress) onProgress({ subsystem: "compatibility-rules", status: "running" });
    logger.info("  Loading compatibility rules...");
    try {
        for (const rule of loadCompatibilityRules()) {
            const ruleNode = makeNode({
                type: NODE_TYPES.COMPATIBILITY_RULE,
                name: rule.name,
                label: `${rule.name} rule`,
                properties: { source: "registry/compatibility" }
            });
            addNode(ruleNode);

            const subjectId = makeNodeId(determineNodeTypeForName(rule.name, packagesByName), rule.name);
            for (const target of rule.recommends || []) {
                addEdge(makeEdge({ from: subjectId, to: makeNodeId(determineNodeTypeForName(target, packagesByName), target), type: EDGE_TYPES.RECOMMENDS }));
            }
            for (const target of rule.conflicts || []) {
                addEdge(makeEdge({ from: subjectId, to: makeNodeId(determineNodeTypeForName(target, packagesByName), target), type: EDGE_TYPES.CONFLICTS_WITH, properties: { source: "compatibility-rule" } }));
            }
            const requiredTargets = new Set();
            for (const versionRule of Object.values(rule.versions || {})) {
                for (const dep of Object.keys(versionRule.requires || {})) requiredTargets.add(dep);
            }
            for (const target of requiredTargets) {
                addEdge(makeEdge({ from: subjectId, to: makeNodeId(determineNodeTypeForName(target, packagesByName), target), type: EDGE_TYPES.REQUIRES }));
            }
        }
    } catch {
        // Compatibility rules failed to load/validate - a broken rule
        // shouldn't take down the whole graph build.
    }
    if (onProgress) onProgress({ subsystem: "compatibility-rules", status: "done" });

    // ── 11. Project Generator stacks ────────────────────────────────────
    // Real stack nodes, wired to each generator's actual `recommends`
    // array (Project Generator Excellence, v2.1.2) - closes the "affected
    // generators" gap the PRD asked impact analysis to cover, using data
    // that already existed rather than inventing a new concept.
    if (onProgress) onProgress({ subsystem: "generators", status: "running" });
    logger.info("  Loading project generator stacks...");
    try {
        for (const generator of listGenerators()) {
            const node = makeNode({
                type: NODE_TYPES.GENERATOR,
                name: generator.id,
                label: generator.label,
                properties: { description: generator.description || null, tags: generator.tags || [] }
            });
            addNode(node);
            for (const target of generator.recommends || []) {
                addEdge(makeEdge({ from: node.id, to: makeNodeId(determineNodeTypeForName(target, packagesByName), target), type: EDGE_TYPES.RECOMMENDS }));
            }
        }
    } catch {
        // Generator loading failed
    }
    if (onProgress) onProgress({ subsystem: "generators", status: "done" });

    // ── 12. Snapshots, benchmarks, repairs (history nodes) ──────────
    if (onProgress) onProgress({ subsystem: "history", status: "running" });
    logger.info("  Loading history nodes...");

    // Snapshots - a whole-system capture, not tied to any specific tool's
    // usage; deliberately excluded from orphan analysis (see findOrphans)
    // rather than given fabricated edges.
    try {
        const snapshotsDir = path.join(userStateDir(), "snapshots");
        if (existsSync(snapshotsDir)) {
            for (const entry of readdirSync(snapshotsDir, { withFileTypes: true })) {
                if (!entry.isFile() || !entry.name.endsWith(".dfk")) continue;
                const id = entry.name.replace(/\.dfk$/, "");
                addNode(makeNode({ type: NODE_TYPES.SNAPSHOT, name: id, label: id, properties: { file: entry.name } }));
            }
        }
    } catch {
        // Snapshots loading failed
    }

    // Benchmarks - categories (cpu/disk/memory/...), not specific
    // packages; same reasoning as snapshots, excluded from orphan
    // analysis rather than given a fabricated edge.
    try {
        const benchmarksDir = path.join(userStateDir(), "benchmarks");
        if (existsSync(benchmarksDir)) {
            for (const entry of readdirSync(benchmarksDir, { withFileTypes: true })) {
                if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
                const id = entry.name.replace(/\.json$/, "");
                addNode(makeNode({ type: NODE_TYPES.BENCHMARK, name: id, label: id, properties: { file: entry.name } }));
            }
        }
    } catch {
        // Benchmarks loading failed
    }

    // Repairs - unlike snapshots/benchmarks, a repair record genuinely
    // does reference the specific tools it touched (each result carries
    // the original compatibility `issue.tool`), so this makes the
    // declared-but-previously-dead EDGE_TYPES.REPAIRS real instead of
    // leaving every repair node a permanent, meaningless orphan.
    try {
        for (const entry of listRepairHistory()) {
            const node = addNode(makeNode({
                type: NODE_TYPES.REPAIR,
                name: entry.id,
                label: entry.id,
                properties: { createdAt: entry.createdAt, fixed: entry.fixed, failed: entry.failed, skipped: entry.skipped }
            }));
            try {
                const record = getRepairRecord(entry.id);
                const tools = new Set((record.repairResults || []).filter((r) => r.ok && r.issue?.tool).map((r) => r.issue.tool));
                for (const tool of tools) {
                    addEdge(makeEdge({ from: node.id, to: makeNodeId(determineNodeTypeForName(tool, packagesByName), tool), type: EDGE_TYPES.REPAIRS }));
                }
            } catch {
                // This one record was unreadable - the node above still
                // stands, just without edges.
            }
        }
    } catch {
        // Repairs loading failed
    }
    if (onProgress) onProgress({ subsystem: "history", status: "done" });

    // ── Build adjacency maps ────────────────────────────────────────
    const adjacency = new Map(); // forward edges
    const reverseAdjacency = new Map(); // reverse edges

    for (const node of nodes.values()) {
        adjacency.set(node.id, []);
        reverseAdjacency.set(node.id, []);
    }

    for (const edge of edges) {
        if (adjacency.has(edge.from)) adjacency.get(edge.from).push(edge);
        if (reverseAdjacency.has(edge.to)) reverseAdjacency.get(edge.to).push(edge);
    }

    // ── Calculate depth for each node ───────────────────────────────
    const depthMap = new Map();
    function calculateDepth(nodeId, visited = new Set()) {
        if (depthMap.has(nodeId)) return depthMap.get(nodeId);
        if (visited.has(nodeId)) return 0;
        visited.add(nodeId);
        const deps = (adjacency.get(nodeId) || []).filter((e) => e.type === EDGE_TYPES.DEPENDS_ON);
        if (deps.length === 0) {
            depthMap.set(nodeId, 0);
            return 0;
        }
        const maxDepDepth = Math.max(...deps.map((e) => calculateDepth(e.to, new Set(visited))));
        const depth = maxDepDepth + 1;
        depthMap.set(nodeId, depth);
        return depth;
    }

    for (const node of nodes.values()) {
        calculateDepth(node.id);
    }

    // ── Detect cycles ───────────────────────────────────────────────
    const packageNames = [...nodes.values()].filter((n) => n.type === NODE_TYPES.PACKAGE || n.type === NODE_TYPES.RUNTIME || n.type === NODE_TYPES.LANGUAGE || n.type === NODE_TYPES.FRAMEWORK || n.type === NODE_TYPES.SDK).map((n) => n.name);
    const cycles = detectCycles(packageNames.filter((n) => installedPackages.has(n)));

    logger.section("Graph Built");
    logger.info(`Nodes: ${nodes.size}`);
    logger.info(`Edges: ${edges.length}`);
    logger.info(`Cycles: ${cycles.length}`);

    const graph = {
        devGraphVersion: DEV_GRAPH_VERSION,
        createdAt: new Date().toISOString(),
        devforgekitVersion: getVersion(),
        machine: { hostname: hostname() },
        nodes: [...nodes.values()],
        edges,
        adjacency: Object.fromEntries([...adjacency.entries()].map(([k, v]) => [k, v.map((e) => ({ to: e.to, type: e.type }))])),
        reverseAdjacency: Object.fromEntries([...reverseAdjacency.entries()].map(([k, v]) => [k, v.map((e) => ({ from: e.from, type: e.type }))])),
        depthMap: Object.fromEntries(depthMap),
        cycles,
        stats: computeStats([...nodes.values()], edges, depthMap, cycles)
    };

    return graph;
}

// ─── Cache (v2.1.4 - Environment Graph Excellence, Phase 11) ───────────
// buildGraph() measured ~15-20s on a real 261-package registry (mostly
// the registry validate-scan and the compatibility scan, both real work
// this module doesn't own and shouldn't try to shortcut) - unacceptable
// to pay on every one of the 12 CLI subcommands and every TUI page visit.
// This is a single, TTL-bound, always-overwritten cache purely for
// interactive speed - the same pattern packageIntel.js's own
// loadCache()/saveCache() already established for an identical scan.
// Deliberately distinct from saveGraph()/listHistory() below: those are
// explicit, permanent, user-chosen snapshots (`graph open --save`,
// `graph history`); this cache is invisible plumbing nobody asks for by
// name and that expires on its own.
const GRAPH_CACHE_TTL_MS = 30 * 60 * 1000;

function graphCachePath() {
    return path.join(graphDir(), "cache.json");
}

function loadGraphCache() {
    const filePath = graphCachePath();
    if (!existsSync(filePath)) return null;
    try {
        const graph = JSON.parse(readFileSync(filePath, "utf8"));
        const age = Date.now() - new Date(graph.createdAt).getTime();
        if (!Number.isFinite(age) || age > GRAPH_CACHE_TTL_MS) return null;
        return graph;
    } catch {
        return null;
    }
}

function saveGraphCache(graph) {
    const dir = graphDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(graphCachePath(), `${JSON.stringify(graph, null, 2)}\n`);
}

// clearGraphCache() -> true if a cache file existed and was removed.
export function clearGraphCache() {
    const filePath = graphCachePath();
    if (existsSync(filePath)) {
        rmSync(filePath, { force: true });
        return true;
    }
    return false;
}

// buildGraphCached({ refresh, onProgress }) -> a cached graph (if one
// exists and is under 30 minutes old) or a fresh buildGraph() call,
// which is then cached for next time. Every `commands/graph.js`
// subcommand should call this instead of buildGraph() directly -
// `--refresh` (wired per-command) forces a rebuild.
export async function buildGraphCached({ refresh = false, onProgress } = {}) {
    if (!refresh) {
        const cached = loadGraphCache();
        if (cached) return cached;
    }
    const graph = await buildGraph({ onProgress });
    saveGraphCache(graph);
    return graph;
}

// ─── Node Type Determination ──────────────────────────────────────────

function determineNodeType(pkg) {
    if (SDK_NAMES.includes(pkg.name)) return NODE_TYPES.SDK;
    if (RUNTIME_NAMES.includes(pkg.name)) return NODE_TYPES.RUNTIME;
    if (DATABASE_NAMES.includes(pkg.name)) return NODE_TYPES.DATABASE;
    if (SERVICE_NAMES.includes(pkg.name)) return NODE_TYPES.SERVICE;
    if (PACKAGE_MANAGER_NAMES.includes(pkg.name)) return NODE_TYPES.PACKAGE_MANAGER;
    if (pkg.category && CATEGORY_TO_NODE_TYPE[pkg.category]) return CATEGORY_TO_NODE_TYPE[pkg.category];
    return NODE_TYPES.PACKAGE;
}

// determineNodeTypeForName(name, packagesByName) - resolves an EDGE
// TARGET's node type using the exact same rules determineNodeType()
// applies when that same name is a node's own subject (real package
// lookup + category fallback first, then the hardcoded name lists).
// Before this fix (v2.1.4), edge targets were typed by name alone with
// no category lookup, while node creation typed by the full package
// object - so any package whose type came from `category` rather than a
// hardcoded name list (dart, git, vscode, ...) got a DIFFERENT node id
// depending on whether it was an edge source or an edge target, leaving
// ~22% of all edges on the real registry silently dangling. See
// docs/EnvironmentGraph.md.
function determineNodeTypeForName(name, packagesByName) {
    const pkg = packagesByName?.get(name);
    if (pkg) return determineNodeType(pkg);
    if (SDK_NAMES.includes(name)) return NODE_TYPES.SDK;
    if (RUNTIME_NAMES.includes(name)) return NODE_TYPES.RUNTIME;
    if (DATABASE_NAMES.includes(name)) return NODE_TYPES.DATABASE;
    if (SERVICE_NAMES.includes(name)) return NODE_TYPES.SERVICE;
    if (PACKAGE_MANAGER_NAMES.includes(name)) return NODE_TYPES.PACKAGE_MANAGER;
    return NODE_TYPES.PACKAGE;
}

// ─── Statistics ───────────────────────────────────────────────────────

// NON_ORPHANABLE_TYPES - node types that are historical/point-in-time
// records rather than tools that could plausibly have a "used by
// something" edge. A snapshot captures the WHOLE system at once; a
// benchmark measures abstract categories (cpu/disk/memory), not specific
// package usage - neither has a real, honest edge to attach, so both are
// excluded from orphan analysis here rather than given a fabricated
// connection (v2.1.4 audit finding: these node types were always 100%
// orphaned by construction, making orphan output noisy). Repair records
// are NOT excluded - a repair's actually-touched tools are wired as real
// REPAIRS edges now (see buildGraph()'s history-nodes section), so a
// repair that legitimately fixed nothing tracked in the graph is a
// meaningful orphan, not a structural one.
const NON_ORPHANABLE_TYPES = new Set([NODE_TYPES.SNAPSHOT, NODE_TYPES.BENCHMARK]);

// computeOrphanNodes(nodes, edges) - the one place "what counts as an
// orphan" is decided. computeStats(), the exported findOrphans(), and
// applyGraphFilter()'s "unused" branch all call this instead of each
// reimplementing the same loop - a v2.1.4 audit found this exact logic
// duplicated byte-for-byte between computeStats and findOrphans.
function computeOrphanNodes(nodes, edges) {
    const connectedIds = new Set();
    for (const edge of edges) {
        connectedIds.add(edge.from);
        connectedIds.add(edge.to);
    }
    return nodes.filter((n) => !connectedIds.has(n.id) && !NON_ORPHANABLE_TYPES.has(n.type));
}

// computeConflictEdges(edges) - the raw CONFLICTS_WITH edges; findConflicts()
// below maps these into a display shape, computeStats() just counts them.
function computeConflictEdges(edges) {
    return edges.filter((e) => e.type === EDGE_TYPES.CONFLICTS_WITH);
}

export function computeStats(nodes, edges, depthMap, cycles) {
    const nodesByType = {};
    for (const node of nodes) {
        nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
    }

    const edgesByType = {};
    for (const edge of edges) {
        edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
    }

    const depthValues = depthMap instanceof Map ? [...depthMap.values()] : Object.values(depthMap);
    const depths = depthValues.filter((d) => d > 0);
    const avgDepth = depths.length > 0 ? depths.reduce((a, b) => a + b, 0) / depths.length : 0;
    const maxDepth = depths.length > 0 ? Math.max(...depths) : 0;

    // Most depended-upon (most incoming DEPENDS_ON edges)
    const dependencyCount = new Map();
    for (const edge of edges) {
        if (edge.type === EDGE_TYPES.DEPENDS_ON || edge.type === EDGE_TYPES.REQUIRED_BY) {
            dependencyCount.set(edge.to, (dependencyCount.get(edge.to) || 0) + 1);
        }
    }
    let mostDepended = null;
    let maxDeps = 0;
    for (const [nodeId, count] of dependencyCount) {
        if (count > maxDeps) {
            maxDeps = count;
            mostDepended = nodeId;
        }
    }

    const orphans = computeOrphanNodes(nodes, edges);
    const conflicts = computeConflictEdges(edges);

    // Distribution stats (v2.1.4 Phase 7) - real, cheap aggregations over
    // properties buildGraph() already attaches to every package node;
    // nothing here is a new probe.
    const byCategory = {};
    const byPlatform = {};
    const byArchitecture = {};
    let installedCount = 0;
    let missingCount = 0;
    for (const node of nodes) {
        const props = node.properties || {};
        if (props.category) byCategory[props.category] = (byCategory[props.category] || 0) + 1;
        for (const platform of props.platforms || []) byPlatform[platform] = (byPlatform[platform] || 0) + 1;
        for (const arch of props.architectures || []) byArchitecture[arch] = (byArchitecture[arch] || 0) + 1;
        if (props.installed === true) installedCount++;
        else if (props.installed === false) missingCount++;
    }

    return {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        nodesByType,
        edgesByType,
        averageDepth: Number(avgDepth.toFixed(2)),
        maxDepth,
        mostDependedNode: mostDepended,
        mostDependedCount: maxDeps,
        orphanCount: orphans.length,
        conflictCount: conflicts.length,
        cycleCount: cycles.length,
        installedCount,
        missingCount,
        byCategory,
        byPlatform,
        byArchitecture
    };
}

// ─── Impact Analysis ──────────────────────────────────────────────────

export function analyzeImpact(graph, nodeName) {
    const nodeId = findNodeId(graph, nodeName);
    if (!nodeId) {
        throw new DevForgeError(`Node '${nodeName}' not found in graph`);
    }

    // BFS to find all nodes that depend on this one (reverse traversal)
    const affected = new Set();
    const queue = [nodeId];
    const visited = new Set();

    while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);

        const reverseEdges = graph.reverseAdjacency[current] || [];
        for (const edge of reverseEdges) {
            if (!affected.has(edge.from)) {
                affected.add(edge.from);
                queue.push(edge.from);
            }
        }
    }

    // Categorize affected nodes by type
    const affectedNodes = [...affected].map((id) => graph.nodes.find((n) => n.id === id)).filter(Boolean);
    const byType = {};
    for (const node of affectedNodes) {
        byType[node.type] = (byType[node.type] || 0) + 1;
    }

    // Direct dependents
    const directDependents = (graph.reverseAdjacency[nodeId] || []).map((e) => e.from);

    return {
        node: graph.nodes.find((n) => n.id === nodeId),
        totalAffected: affectedNodes.length,
        directDependents: directDependents.map((id) => graph.nodes.find((n) => n.id === id)?.name).filter(Boolean),
        affectedNodes: affectedNodes.map((n) => ({ name: n.name, type: n.type })),
        byType
    };
}

// ─── Path Analysis ────────────────────────────────────────────────────

export function findPath(graph, fromName, toName) {
    const fromId = findNodeId(graph, fromName);
    const toId = findNodeId(graph, toName);

    if (!fromId) throw new DevForgeError(`Node '${fromName}' not found in graph`);
    if (!toId) throw new DevForgeError(`Node '${toName}' not found in graph`);

    // BFS shortest path
    const queue = [[fromId]];
    const visited = new Set();

    while (queue.length > 0) {
        const path = queue.shift();
        const current = path[path.length - 1];

        if (current === toId) {
            return path.map((id) => graph.nodes.find((n) => n.id === id)?.name).filter(Boolean);
        }

        if (visited.has(current)) continue;
        visited.add(current);

        const forwardEdges = graph.adjacency[current] || [];
        for (const edge of forwardEdges) {
            if (!visited.has(edge.to)) {
                queue.push([...path, edge.to]);
            }
        }
    }

    return null; // No path found
}

// ─── Search ───────────────────────────────────────────────────────────

export function searchGraph(graph, query, { filter } = {}) {
    let results = graph.nodes;

    // Apply filter
    if (filter) {
        results = applyGraphFilter(results, filter, graph.edges);
    }

    // Apply search
    if (query) {
        const q = query.toLowerCase();
        results = results.filter((n) => {
            if (n.name && n.name.toLowerCase().includes(q)) return true;
            if (n.label && n.label.toLowerCase().includes(q)) return true;
            if (n.type && n.type.toLowerCase().includes(q)) return true;
            if (n.properties?.description && n.properties.description.toLowerCase().includes(q)) return true;
            if (n.properties?.category && n.properties.category.toLowerCase().includes(q)) return true;
            if (n.properties?.tags && n.properties.tags.some((t) => t.toLowerCase().includes(q))) return true;
            return false;
        });
    }

    return results;
}

// applyGraphFilter(nodes, filter, [edges]) - `edges` is optional; only
// `unused` needs it (orphan status isn't determinable from a node object
// alone). Without edges, `unused` returns `[]` rather than guessing.
//
// v2.1.4 audit finding: `duplicate`/`large`/`recent`/`outdated` filtered
// on `properties.isDuplicate`/`sizeBytes`/`lastUpdate`/`isOutdated` -
// fields buildGraph() never set on any node, so these always silently
// returned an empty result. Package size/last-update/outdated tracking
// isn't part of this graph's data model today; removed rather than left
// as a filter that claims to work but never has real data behind it.
// `unused` and `broken` are now genuinely real instead of half-dead (see
// below).
export function applyGraphFilter(nodes, filter, edges) {
    switch (filter) {
        case "installed":
            return nodes.filter((n) => n.properties?.installed === true);
        case "broken":
            // `healthStatus` is only ever "healthy"/"not-installed" (never
            // "broken") - that half of the old check was dead. `valid`
            // IS real, set for workspace/plugin nodes.
            return nodes.filter((n) => n.properties?.valid === false);
        case "unused":
            if (!edges) return [];
            return computeOrphanNodes(nodes, edges).filter((n) => n.properties?.installed === true);
        case "critical":
            return nodes.filter((n) => n.type === "service" || n.type === "runtime" || n.type === "language");
        case "workspace":
            return nodes.filter((n) => n.type === NODE_TYPES.WORKSPACE);
        case "recipe":
            return nodes.filter((n) => n.type === NODE_TYPES.RECIPE);
        case "plugin":
            return nodes.filter((n) => n.type === NODE_TYPES.PLUGIN);
        case "profile":
            return nodes.filter((n) => n.type === NODE_TYPES.PROFILE);
        default:
            return nodes;
    }
}

// ─── Focus (subgraph extraction) ──────────────────────────────────────

export function focusNode(graph, nodeName) {
    const nodeId = findNodeId(graph, nodeName);
    if (!nodeId) {
        throw new DevForgeError(`Node '${nodeName}' not found in graph`);
    }

    // Collect all nodes reachable from this node (forward + reverse)
    const relevantIds = new Set([nodeId]);

    // Forward traversal
    const forwardQueue = [nodeId];
    while (forwardQueue.length > 0) {
        const current = forwardQueue.shift();
        for (const edge of graph.adjacency[current] || []) {
            if (!relevantIds.has(edge.to)) {
                relevantIds.add(edge.to);
                forwardQueue.push(edge.to);
            }
        }
    }

    // Reverse traversal
    const reverseQueue = [nodeId];
    while (reverseQueue.length > 0) {
        const current = reverseQueue.shift();
        for (const edge of graph.reverseAdjacency[current] || []) {
            if (!relevantIds.has(edge.from)) {
                relevantIds.add(edge.from);
                reverseQueue.push(edge.from);
            }
        }
    }

    const focusedNodes = graph.nodes.filter((n) => relevantIds.has(n.id));
    const focusedEdges = graph.edges.filter((e) => relevantIds.has(e.from) && relevantIds.has(e.to));

    return {
        focusNode: graph.nodes.find((n) => n.id === nodeId),
        nodes: focusedNodes,
        edges: focusedEdges,
        nodeCount: focusedNodes.length,
        edgeCount: focusedEdges.length
    };
}

// ─── Conflicts ────────────────────────────────────────────────────────

export function findConflicts(graph) {
    return computeConflictEdges(graph.edges).map((e) => ({
        from: graph.nodes.find((n) => n.id === e.from)?.name,
        to: graph.nodes.find((n) => n.id === e.to)?.name,
        message: e.properties?.message
    }));
}

// ─── Orphans ──────────────────────────────────────────────────────────

// findOrphans(graph) -> nodes with zero edges, excluding snapshot/
// benchmark record types (see NON_ORPHANABLE_TYPES above).
export function findOrphans(graph) {
    return computeOrphanNodes(graph.nodes, graph.edges);
}

// groupOrphansByType(orphans) -> { [nodeType]: node[] } (v2.1.4 Phase 6 -
// "show why they are considered orphaned"): a flat list mixing an
// orphaned CLI tool with an orphaned theme doesn't answer "orphaned
// compared to what," so `graph orphan` groups findOrphans()'s result by
// type. Kept separate from findOrphans() itself so that function keeps
// returning a plain node array (JSON-serializable as-is, and what the
// existing tests/callers already expect).
export function groupOrphansByType(orphans) {
    const byType = {};
    for (const node of orphans) {
        (byType[node.type] ||= []).push(node);
    }
    return byType;
}

// ─── Render Tree ──────────────────────────────────────────────────────

export function renderGraphTree(graph, nodeName, { maxDepth = 5 } = {}) {
    const nodeId = findNodeId(graph, nodeName);
    if (!nodeId) {
        throw new DevForgeError(`Node '${nodeName}' not found in graph`);
    }

    const lines = [];
    const visited = new Set();

    function render(id, prefix, isLast, depth) {
        if (depth > maxDepth) return;
        const node = graph.nodes.find((n) => n.id === id);
        if (!node) return;
        if (visited.has(id)) {
            lines.push(`${prefix}${isLast ? "└── " : "├── "}${node.name} (cycle)`);
            return;
        }
        visited.add(id);

        const marker = isLast ? "└── " : "├── ";
        const typeLabel = node.type !== NODE_TYPES.PACKAGE ? ` [${node.type}]` : "";
        lines.push(`${prefix}${marker}${node.name}${typeLabel}`);

        const deps = (graph.adjacency[id] || []).filter((e) => e.type === EDGE_TYPES.DEPENDS_ON);
        for (let i = 0; i < deps.length; i++) {
            const newPrefix = prefix + (isLast ? "    " : "│   ");
            render(deps[i].to, newPrefix, i === deps.length - 1, depth + 1);
        }
    }

    render(nodeId, "", true, 0);
    return lines.join("\n");
}

// ─── Export ───────────────────────────────────────────────────────────

export function exportGraph(graph, format) {
    switch (format) {
        case "json":
            return `${JSON.stringify(graph, null, 2)}\n`;
        case "markdown":
        case "md":
            return exportMarkdown(graph);
        case "html":
            return exportHTML(graph);
        case "dot":
        case "graphviz":
            return exportDot(graph);
        case "mermaid":
            return exportMermaid(graph);
        case "svg":
            return exportSVG(graph);
        case "tree":
        case "ascii":
            return exportAsciiTree(graph);
        case "plantuml":
            return exportPlantUML(graph);
        default:
            throw new DevForgeError(`Unknown export format '${format}'. Available: json, markdown, html, dot, mermaid, svg, tree, plantuml. (PNG is deliberately not supported - see docs/EnvironmentGraph.md for why.)`);
    }
}

function exportMarkdown(graph) {
    const lines = [
        `# Development Environment Graph`,
        ``,
        `**Date:** ${graph.createdAt}`,
        `**Machine:** ${graph.machine?.hostname || "unknown"}`,
        `**DevForgeKit:** ${graph.devforgekitVersion}`,
        ``,
        `## Statistics`,
        ``,
        `- Total nodes: ${graph.stats.totalNodes}`,
        `- Total edges: ${graph.stats.totalEdges}`,
        `- Average depth: ${graph.stats.averageDepth}`,
        `- Max depth: ${graph.stats.maxDepth}`,
        `- Orphans: ${graph.stats.orphanCount}`,
        `- Conflicts: ${graph.stats.conflictCount}`,
        `- Cycles: ${graph.stats.cycleCount}`,
        ``,
        `## Nodes by Type`,
        ``,
        `| Type | Count |`,
        `|------|-------|`
    ];

    for (const [type, count] of Object.entries(graph.stats.nodesByType)) {
        lines.push(`| ${type} | ${count} |`);
    }

    lines.push(``, `## Edges by Type`, ``, `| Type | Count |`, `|------|-------|`);
    for (const [type, count] of Object.entries(graph.stats.edgesByType)) {
        lines.push(`| ${type} | ${count} |`);
    }

    if (graph.cycles.length > 0) {
        lines.push(``, `## Circular Dependencies`, ``);
        for (const cycle of graph.cycles) {
            lines.push(`- ${cycle.join(" → ")}`);
        }
    }

    return lines.join("\n") + "\n";
}

function exportHTML(graph) {
    const nodeRows = graph.nodes.map((n) => `<tr><td>${n.name}</td><td>${n.type}</td><td>${n.properties?.installed ? "✓" : ""}</td></tr>`).join("\n");
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>DEV Graph</title>
<style>
body { font-family: -apple-system, sans-serif; margin: 40px; color: #333; }
table { border-collapse: collapse; width: 100%; margin: 20px 0; }
th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
th { background: #f5f5f5; }
</style></head>
<body>
<h1>Development Environment Graph</h1>
<p><strong>Date:</strong> ${graph.createdAt}<br>
<strong>Nodes:</strong> ${graph.stats.totalNodes} | <strong>Edges:</strong> ${graph.stats.totalEdges}</p>
<h2>Nodes</h2>
<table><tr><th>Name</th><th>Type</th><th>Installed</th></tr>
${nodeRows}
</table>
</body></html>
`;
}

function exportDot(graph) {
    const lines = ["digraph devgraph {", "  rankdir=LR;"];
    for (const edge of graph.edges) {
        const fromName = graph.nodes.find((n) => n.id === edge.from)?.name || edge.from;
        const toName = graph.nodes.find((n) => n.id === edge.to)?.name || edge.to;
        lines.push(`  "${fromName}" -> "${toName}" [label="${edge.type}"];`);
    }
    lines.push("}");
    return lines.join("\n") + "\n";
}

function exportMermaid(graph) {
    const lines = ["graph LR"];
    for (const edge of graph.edges) {
        const fromName = graph.nodes.find((n) => n.id === edge.from)?.name || edge.from;
        const toName = graph.nodes.find((n) => n.id === edge.to)?.name || edge.to;
        lines.push(`  ${fromName} -->|${edge.type}| ${toName}`);
    }
    return lines.join("\n") + "\n";
}

function exportAsciiTree(graph) {
    // Render trees for all top-level package nodes (no incoming DEPENDS_ON)
    const hasIncomingDep = new Set();
    for (const edge of graph.edges) {
        if (edge.type === EDGE_TYPES.DEPENDS_ON) {
            hasIncomingDep.add(edge.to);
        }
    }

    const topLevel = graph.nodes.filter((n) =>
        (n.type === NODE_TYPES.PACKAGE || n.type === NODE_TYPES.RUNTIME || n.type === NODE_TYPES.FRAMEWORK || n.type === NODE_TYPES.SDK) &&
        !hasIncomingDep.has(n.id) &&
        n.properties?.installed
    );

    const lines = [];
    for (let i = 0; i < topLevel.length; i++) {
        if (i > 0) lines.push("");
        try {
            lines.push(renderGraphTree(graph, topLevel[i].name, { maxDepth: 3 }));
        } catch {
            // Skip if tree rendering fails
        }
    }
    return lines.join("\n") + "\n";
}

function exportPlantUML(graph) {
    const lines = ["@startuml", "graph LR"];
    for (const edge of graph.edges) {
        const fromName = graph.nodes.find((n) => n.id === edge.from)?.name || edge.from;
        const toName = graph.nodes.find((n) => n.id === edge.to)?.name || edge.to;
        lines.push(`  [${fromName}] --> [${toName}] : ${edge.type}`);
    }
    lines.push("@enduml");
    return lines.join("\n") + "\n";
}

const SVG_NODE_COLORS = {
    package: "#4A90D9", framework: "#50C878", runtime: "#E67E22", language: "#9B59B6",
    sdk: "#E74C3C", cli: "#1ABC9C", plugin: "#F39C12", recipe: "#2ECC71", profile: "#3498DB",
    workspace: "#8E44AD", collection: "#16A085", database: "#C0392B", service: "#D35400",
    "package-manager": "#7F8C8D", theme: "#BDC3C7", configuration: "#95A5A6",
    benchmark: "#F1C40F", snapshot: "#2980B9", repair: "#C0392B",
    "compatibility-rule": "#34495E", "ai-provider": "#8E44AD", generator: "#27AE60"
};

function escapeXml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// exportSVG(graph) -> a real, valid, hand-rolled SVG (v2.1.4) - no new
// dependency (no canvas/image library) and no shelling out to an
// external tool (Graphviz's `dot -Tsvg` isn't guaranteed to be
// installed). Honestly scoped: this is a deterministic grid layout, not
// a force-directed one, so it stays readable for a focused subgraph
// (`graph focus <name> --format svg`) but gets visually dense for the
// full ~365-node graph - a real limitation, not hidden. PNG rendering is
// deliberately NOT implemented for the same reason: rasterizing would
// need either a new heavy dependency or an external binary this codebase
// can't assume is present.
function exportSVG(graph) {
    const nodes = graph.nodes;
    if (nodes.length === 0) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><text x="10" y="30" font-family="monospace" font-size="12" fill="#888">Empty graph</text></svg>\n`;
    }

    const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    const cellW = 160;
    const cellH = 90;
    const padding = 24;
    const positions = new Map();
    nodes.forEach((node, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        positions.set(node.id, { x: padding + col * cellW + cellW / 2, y: padding + row * cellH + cellH / 2 });
    });
    const rows = Math.ceil(nodes.length / cols);
    const width = padding * 2 + cols * cellW;
    const height = padding * 2 + rows * cellH;

    const lines = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="monospace" font-size="10">`,
        `<rect width="100%" height="100%" fill="#1e1e1e"/>`,
        `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#888888"/></marker></defs>`
    ];

    for (const edge of graph.edges) {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) continue;
        lines.push(`<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#666666" stroke-width="1" marker-end="url(#arrow)"/>`);
    }

    for (const node of nodes) {
        const pos = positions.get(node.id);
        const color = SVG_NODE_COLORS[node.type] || "#4A90D9";
        lines.push(`<rect x="${pos.x - 55}" y="${pos.y - 16}" width="110" height="32" rx="6" fill="${color}" stroke="#000000" stroke-width="0.5" opacity="0.9"/>`);
        lines.push(`<text x="${pos.x}" y="${pos.y + 4}" text-anchor="middle" fill="#ffffff">${escapeXml(node.name.slice(0, 16))}</text>`);
    }

    lines.push(`</svg>`);
    return lines.join("\n") + "\n";
}

// ─── Verify ───────────────────────────────────────────────────────────

export function verifyGraph(graph) {
    const results = [];

    // Check for missing dependency targets
    for (const edge of graph.edges) {
        if (!graph.nodes.find((n) => n.id === edge.to)) {
            results.push({ check: "missing-target", status: "WARNING", edge: `${edge.from} -> ${edge.to}` });
        }
        if (!graph.nodes.find((n) => n.id === edge.from)) {
            results.push({ check: "missing-source", status: "WARNING", edge: `${edge.from} -> ${edge.to}` });
        }
    }

    // Check for cycles
    if (graph.cycles.length > 0) {
        results.push({ check: "cycles", status: "WARNING", count: graph.cycles.length });
    } else {
        results.push({ check: "cycles", status: "PASS", count: 0 });
    }

    // Check for conflicts
    if (graph.stats.conflictCount > 0) {
        results.push({ check: "conflicts", status: "WARNING", count: graph.stats.conflictCount });
    } else {
        results.push({ check: "conflicts", status: "PASS", count: 0 });
    }

    // Check for orphans
    results.push({ check: "orphans", status: graph.stats.orphanCount > 0 ? "WARNING" : "PASS", count: graph.stats.orphanCount });

    // Overall health
    const warnings = results.filter((r) => r.status === "WARNING").length;
    const health = warnings === 0 ? "healthy" : warnings < 3 ? "warning" : "critical";

    return { results, health, warningCount: warnings };
}

// ─── Compare Graphs ───────────────────────────────────────────────────

export function compareGraphs(oldGraph, newGraph) {
    const oldNodes = new Map(oldGraph.nodes.map((n) => [n.id, n]));
    const newNodes = new Map(newGraph.nodes.map((n) => [n.id, n]));

    const added = [];
    const removed = [];
    const unchanged = [];

    for (const [id, node] of newNodes) {
        if (!oldNodes.has(id)) {
            added.push({ name: node.name, type: node.type });
        } else {
            unchanged.push({ name: node.name, type: node.type });
        }
    }

    for (const [id, node] of oldNodes) {
        if (!newNodes.has(id)) {
            removed.push({ name: node.name, type: node.type });
        }
    }

    // Edge changes
    const oldEdges = new Set(oldGraph.edges.map((e) => `${e.from}|${e.to}|${e.type}`));
    const newEdges = new Set(newGraph.edges.map((e) => `${e.from}|${e.to}|${e.type}`));

    const addedEdges = [...newEdges].filter((e) => !oldEdges.has(e)).length;
    const removedEdges = [...oldEdges].filter((e) => !newEdges.has(e)).length;

    return {
        nodesAdded: added,
        nodesRemoved: removed,
        nodesUnchanged: unchanged.length,
        edgesAdded: addedEdges,
        edgesRemoved: removedEdges,
        summary: {
            addedCount: added.length,
            removedCount: removed.length,
            unchangedCount: unchanged.length,
            addedEdges,
            removedEdges
        }
    };
}

// ─── AI Explain ───────────────────────────────────────────────────────

export async function explainNode(graph, nodeName, { provider, model, endpoint, surface } = {}) {
    const { getProvider, resolveApiKey } = await import("./ai/providers/index.js");
    const { getActiveWorkspace } = await import("./workspace/store.js");
    const { buildPrompt } = await import("./ai/prompts/library.js");

    const config = loadConfig();
    const providerId = provider || (config.aiProvider && config.aiProvider !== "none" ? config.aiProvider : null);

    if (!providerId) {
        return {
            ok: false,
            error: "No AI provider configured. Run 'devforgekit config set aiProvider <provider>' or pass --provider."
        };
    }

    const impact = analyzeImpact(graph, nodeName);
    const workspace = getActiveWorkspace();
    const opts = {
        apiKey: resolveApiKey(providerId, { workspace }),
        model: model || config.aiModel || undefined,
        endpoint: endpoint || config.aiEndpoint || undefined,
        workspace
    };

    const aiProvider = getProvider(providerId, opts);

    const context = {
        node: { name: nodeName, type: impact.node?.type, properties: impact.node?.properties },
        impact: {
            totalAffected: impact.totalAffected,
            directDependents: impact.directDependents,
            byType: impact.byType
        },
        graphStats: graph.stats
    };

    // A dedicated prompt kind (v2.1.4), not the generic "explain" template
    // stuffed with a full paragraph as its "topic" - that produced an
    // awkward doubled "Explain ... Explain this node..." phrasing, the
    // same pattern several other AI integrations across this codebase
    // (repair/packageIntel/snapshot/benchmark) share; this is the first
    // one broken out into its own instruction.
    const prompt = buildPrompt("graph-explain", context, nodeName, { surface });

    const response = await aiProvider.chat(prompt);
    return { ok: true, explanation: response.content };
}

// ─── History ──────────────────────────────────────────────────────────

export function saveGraph(graph) {
    const dir = graphDir();
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `graph-${graph.createdAt.replace(/[:.]/g, "-")}.json`);
    writeFileSync(filePath, `${JSON.stringify(graph, null, 2)}\n`);
    return filePath;
}

export function listHistory() {
    const dir = graphDir();
    if (!existsSync(dir)) return [];

    const records = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.startsWith("graph-") || !entry.name.endsWith(".json")) continue;
        const filePath = path.join(dir, entry.name);
        try {
            const data = JSON.parse(readFileSync(filePath, "utf8"));
            records.push({
                createdAt: data.createdAt,
                nodes: data.stats?.totalNodes || 0,
                edges: data.stats?.totalEdges || 0,
                orphans: data.stats?.orphanCount || 0,
                conflicts: data.stats?.conflictCount || 0,
                cycles: data.stats?.cycleCount || 0,
                path: filePath
            });
        } catch {
            // Corrupt file
        }
    }

    return records.sort((a, b) => {
        const aKey = a.createdAt || "";
        const bKey = b.createdAt || "";
        return aKey < bKey ? 1 : aKey > bKey ? -1 : 0;
    });
}

export function loadGraph(filePath) {
    if (!existsSync(filePath)) {
        throw new DevForgeError(`Graph file '${filePath}' not found`);
    }
    return JSON.parse(readFileSync(filePath, "utf8"));
}

// ─── Utilities ────────────────────────────────────────────────────────

function findNodeId(graph, name) {
    // Try exact match first
    const exact = graph.nodes.find((n) => n.name === name);
    if (exact) return exact.id;

    // Try case-insensitive
    const ci = graph.nodes.find((n) => n.name.toLowerCase() === name.toLowerCase());
    if (ci) return ci.id;

    // Try as alias (check if any node has this as a tag or in properties)
    const alias = graph.nodes.find((n) => n.properties?.tags?.includes(name));
    if (alias) return alias.id;

    return null;
}
