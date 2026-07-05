import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    DEV_GRAPH_VERSION,
    DEV_GRAPH_DIR,
    NODE_TYPES,
    EDGE_TYPES,
    computeStats,
    analyzeImpact,
    findPath,
    searchGraph,
    applyGraphFilter,
    focusNode,
    findConflicts,
    findOrphans,
    renderGraphTree,
    exportGraph,
    verifyGraph,
    compareGraphs,
    saveGraph,
    listHistory,
    loadGraph
} from "../src/core/devGraph.js";

// Point HOME at a scratch directory to isolate from the developer's real
// ~/.devforgekit (same pattern as all other test files).
function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-graph-test-"));
    process.env.HOME = tempHome;
    try {
        return fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

// Helper: build a minimal synthetic graph for unit tests
function makeTestGraph() {
    const nodes = [
        { id: "package:flutter", type: "framework", name: "flutter", label: "flutter", properties: { installed: true, category: "mobile", tags: ["mobile", "ui"] } },
        { id: "package:dart", type: "language", name: "dart", label: "dart", properties: { installed: true, category: "languages" } },
        { id: "package:node", type: "runtime", name: "node", label: "node", properties: { installed: true, category: "languages", tags: ["javascript"] } },
        { id: "package:npm", type: "package-manager", name: "npm", label: "npm", properties: { installed: true } },
        { id: "package:docker", type: "service", name: "docker", label: "docker", properties: { installed: true } },
        { id: "package:redis", type: "database", name: "redis", label: "redis", properties: { installed: true } },
        { id: "package:unused-pkg", type: "package", name: "unused-pkg", label: "unused-pkg", properties: { installed: true } },
        { id: "workspace:my-app", type: "workspace", name: "my-app", label: "my-app", properties: {} },
        { id: "profile:full", type: "profile", name: "full", label: "full", properties: {} },
        { id: "plugin:my-plugin", type: "plugin", name: "my-plugin", label: "my-plugin", properties: { valid: true } }
    ];

    const edges = [
        { from: "package:flutter", to: "package:dart", type: "depends-on" },
        { from: "package:npm", to: "package:node", type: "depends-on" },
        { from: "package:docker", to: "package:redis", type: "depends-on" },
        { from: "workspace:my-app", to: "package:flutter", type: "uses" },
        { from: "profile:full", to: "package:flutter", type: "uses" },
        { from: "profile:full", to: "package:node", type: "uses" },
        { from: "plugin:my-plugin", to: "package:node", type: "depends-on" },
        { from: "package:flutter", to: "package:docker", type: "conflicts-with", properties: { message: "test conflict" } }
    ];

    const adjacency = {};
    const reverseAdjacency = {};
    const depthMap = {};

    for (const node of nodes) {
        adjacency[node.id] = [];
        reverseAdjacency[node.id] = [];
    }

    for (const edge of edges) {
        if (adjacency[edge.from]) adjacency[edge.from].push({ to: edge.to, type: edge.type });
        if (reverseAdjacency[edge.to]) reverseAdjacency[edge.to].push({ from: edge.from, type: edge.type });
    }

    // Simple depth: flutter=1, dart=0, npm=1, node=0, docker=1, redis=0
    depthMap["package:flutter"] = 1;
    depthMap["package:dart"] = 0;
    depthMap["package:npm"] = 1;
    depthMap["package:node"] = 0;
    depthMap["package:docker"] = 1;
    depthMap["package:redis"] = 0;
    depthMap["package:unused-pkg"] = 0;
    depthMap["workspace:my-app"] = 0;
    depthMap["profile:full"] = 0;
    depthMap["plugin:my-plugin"] = 1;

    const cycles = [];
    const stats = computeStats(nodes, edges, depthMap, cycles);

    return {
        devGraphVersion: DEV_GRAPH_VERSION,
        createdAt: "2025-01-01T00:00:00.000Z",
        devforgekitVersion: "1.3.6",
        machine: { hostname: "test" },
        nodes,
        edges,
        adjacency,
        reverseAdjacency,
        depthMap,
        cycles,
        stats
    };
}

// ─── Constants ────────────────────────────────────────────────────────

test("DEV_GRAPH_VERSION is 1", () => {
    assert.equal(DEV_GRAPH_VERSION, 1);
});

test("DEV_GRAPH_DIR is 'dev-graph'", () => {
    assert.equal(DEV_GRAPH_DIR, "dev-graph");
});

test("NODE_TYPES has all required types", () => {
    assert.ok(NODE_TYPES.PACKAGE);
    assert.ok(NODE_TYPES.FRAMEWORK);
    assert.ok(NODE_TYPES.RUNTIME);
    assert.ok(NODE_TYPES.LANGUAGE);
    assert.ok(NODE_TYPES.SDK);
    assert.ok(NODE_TYPES.CLI);
    assert.ok(NODE_TYPES.PLUGIN);
    assert.ok(NODE_TYPES.RECIPE);
    assert.ok(NODE_TYPES.PROFILE);
    assert.ok(NODE_TYPES.WORKSPACE);
    assert.ok(NODE_TYPES.COLLECTION);
    assert.ok(NODE_TYPES.DATABASE);
    assert.ok(NODE_TYPES.SERVICE);
    assert.ok(NODE_TYPES.PACKAGE_MANAGER);
    assert.ok(NODE_TYPES.THEME);
    assert.ok(NODE_TYPES.CONFIGURATION);
    assert.ok(NODE_TYPES.BENCHMARK);
    assert.ok(NODE_TYPES.SNAPSHOT);
    assert.ok(NODE_TYPES.REPAIR);
    assert.ok(NODE_TYPES.COMPATIBILITY_RULE);
    assert.ok(NODE_TYPES.AI_PROVIDER);
});

test("EDGE_TYPES has all required types", () => {
    assert.ok(EDGE_TYPES.INSTALLED_BY);
    assert.ok(EDGE_TYPES.DEPENDS_ON);
    assert.ok(EDGE_TYPES.REQUIRED_BY);
    assert.ok(EDGE_TYPES.USES);
    assert.ok(EDGE_TYPES.PROVIDES);
    assert.ok(EDGE_TYPES.CONFLICTS_WITH);
    assert.ok(EDGE_TYPES.UPDATES);
    assert.ok(EDGE_TYPES.REPAIRS);
    assert.ok(EDGE_TYPES.BENCHMARKS);
    assert.ok(EDGE_TYPES.CONFIGURED_BY);
    assert.ok(EDGE_TYPES.CREATED_BY);
    assert.ok(EDGE_TYPES.BELONGS_TO);
    assert.ok(EDGE_TYPES.EXPORTS);
    assert.ok(EDGE_TYPES.IMPORTS);
    assert.ok(EDGE_TYPES.COMPATIBLE_WITH);
    assert.ok(EDGE_TYPES.INCOMPATIBLE_WITH);
});

// ─── computeStats ─────────────────────────────────────────────────────

test("computeStats returns correct counts", () => {
    const graph = makeTestGraph();
    assert.equal(graph.stats.totalNodes, 10);
    assert.equal(graph.stats.totalEdges, 8);
    assert.equal(graph.stats.orphanCount, 1); // unused-pkg
    assert.equal(graph.stats.conflictCount, 1); // flutter ↔ docker
    assert.equal(graph.stats.cycleCount, 0);
});

test("computeStats groups nodes by type", () => {
    const graph = makeTestGraph();
    assert.ok(graph.stats.nodesByType["framework"] >= 1);
    assert.ok(graph.stats.nodesByType["runtime"] >= 1);
    assert.ok(graph.stats.nodesByType["workspace"] >= 1);
    assert.ok(graph.stats.nodesByType["profile"] >= 1);
});

test("computeStats groups edges by type", () => {
    const graph = makeTestGraph();
    assert.ok(graph.stats.edgesByType["depends-on"] >= 3);
    assert.ok(graph.stats.edgesByType["uses"] >= 3);
    assert.ok(graph.stats.edgesByType["conflicts-with"] >= 1);
});

test("computeStats finds most depended-upon node", () => {
    const graph = makeTestGraph();
    assert.ok(graph.stats.mostDependedCount > 0);
    // node and flutter both have 2 incoming dependency/required edges
    assert.ok(graph.stats.mostDependedNode);
});

// ─── analyzeImpact ────────────────────────────────────────────────────

test("analyzeImpact finds all nodes affected by removing a package", () => {
    const graph = makeTestGraph();
    const impact = analyzeImpact(graph, "flutter");

    assert.ok(impact.node);
    assert.equal(impact.node.name, "flutter");
    assert.ok(impact.totalAffected > 0);
    // workspace:my-app and profile:full both use flutter
    assert.ok(impact.directDependents.includes("my-app") || impact.directDependents.includes("full"));
});

test("analyzeImpact returns zero for an orphan node", () => {
    const graph = makeTestGraph();
    const impact = analyzeImpact(graph, "unused-pkg");
    assert.equal(impact.totalAffected, 0);
});

test("analyzeImpact throws for non-existent node", () => {
    const graph = makeTestGraph();
    assert.throws(
        () => analyzeImpact(graph, "nonexistent"),
        /not found/
    );
});

test("analyzeImpact categorizes affected nodes by type", () => {
    const graph = makeTestGraph();
    const impact = analyzeImpact(graph, "node");
    // npm and plugin:my-plugin depend on node, profile:full uses node
    assert.ok(impact.byType["package-manager"] >= 1 || impact.byType["plugin"] >= 1 || impact.byType["profile"] >= 1);
});

// ─── findPath ─────────────────────────────────────────────────────────

test("findPath finds shortest path between connected nodes", () => {
    const graph = makeTestGraph();
    const result = findPath(graph, "npm", "node");
    assert.ok(result);
    assert.ok(result.includes("npm"));
    assert.ok(result.includes("node"));
});

test("findPath returns null for disconnected nodes", () => {
    const graph = makeTestGraph();
    const result = findPath(graph, "unused-pkg", "flutter");
    // unused-pkg has no edges, so no path
    assert.equal(result, null);
});

test("findPath throws for non-existent source", () => {
    const graph = makeTestGraph();
    assert.throws(
        () => findPath(graph, "nonexistent", "node"),
        /not found/
    );
});

test("findPath throws for non-existent target", () => {
    const graph = makeTestGraph();
    assert.throws(
        () => findPath(graph, "node", "nonexistent"),
        /not found/
    );
});

test("findPath returns single node for self-path", () => {
    const graph = makeTestGraph();
    const result = findPath(graph, "node", "node");
    assert.ok(result);
    assert.equal(result.length, 1);
    assert.equal(result[0], "node");
});

// ─── searchGraph ──────────────────────────────────────────────────────

test("searchGraph finds by name", () => {
    const graph = makeTestGraph();
    const results = searchGraph(graph, "flutter");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "flutter");
});

test("searchGraph finds by type", () => {
    const graph = makeTestGraph();
    const results = searchGraph(graph, "workspace");
    assert.ok(results.length >= 1);
    assert.ok(results.every((r) => r.type.includes("workspace") || r.name.includes("workspace")));
});

test("searchGraph finds by tag", () => {
    const graph = makeTestGraph();
    const results = searchGraph(graph, "javascript");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "node");
});

test("searchGraph finds by description", () => {
    const graph = makeTestGraph();
    // Add a description to test
    graph.nodes[0].properties.description = "Cross-platform UI toolkit";
    const results = searchGraph(graph, "toolkit");
    assert.ok(results.length >= 1);
    assert.ok(results.some((r) => r.name === "flutter"));
});

test("searchGraph returns all for empty query", () => {
    const graph = makeTestGraph();
    const results = searchGraph(graph, "");
    assert.equal(results.length, graph.nodes.length);
});

test("searchGraph with filter 'installed' returns only installed nodes", () => {
    const graph = makeTestGraph();
    const results = searchGraph(graph, "", { filter: "installed" });
    assert.ok(results.every((r) => r.properties?.installed === true));
});

test("searchGraph with filter 'workspace' returns only workspace nodes", () => {
    const graph = makeTestGraph();
    const results = searchGraph(graph, "", { filter: "workspace" });
    assert.ok(results.every((r) => r.type === "workspace"));
});

// ─── applyGraphFilter ─────────────────────────────────────────────────

test("applyGraphFilter 'installed' returns installed nodes", () => {
    const graph = makeTestGraph();
    const results = applyGraphFilter(graph.nodes, "installed");
    assert.ok(results.every((r) => r.properties?.installed === true));
});

test("applyGraphFilter 'broken' returns broken/invalid nodes", () => {
    const graph = makeTestGraph();
    graph.nodes[0].properties.healthStatus = "broken";
    const results = applyGraphFilter(graph.nodes, "broken");
    assert.ok(results.some((r) => r.properties?.healthStatus === "broken"));
});

test("applyGraphFilter 'workspace' returns workspace type nodes", () => {
    const graph = makeTestGraph();
    const results = applyGraphFilter(graph.nodes, "workspace");
    assert.ok(results.every((r) => r.type === "workspace"));
});

test("applyGraphFilter 'recipe' returns recipe type nodes", () => {
    const graph = makeTestGraph();
    const results = applyGraphFilter(graph.nodes, "recipe");
    assert.ok(results.every((r) => r.type === "recipe"));
});

test("applyGraphFilter 'plugin' returns plugin type nodes", () => {
    const graph = makeTestGraph();
    const results = applyGraphFilter(graph.nodes, "plugin");
    assert.ok(results.every((r) => r.type === "plugin"));
});

test("applyGraphFilter 'profile' returns profile type nodes", () => {
    const graph = makeTestGraph();
    const results = applyGraphFilter(graph.nodes, "profile");
    assert.ok(results.every((r) => r.type === "profile"));
});

test("applyGraphFilter with unknown filter returns all", () => {
    const graph = makeTestGraph();
    const results = applyGraphFilter(graph.nodes, "nonexistent");
    assert.equal(results.length, graph.nodes.length);
});

// ─── focusNode ────────────────────────────────────────────────────────

test("focusNode extracts a subgraph around a node", () => {
    const graph = makeTestGraph();
    const sub = focusNode(graph, "flutter");

    assert.ok(sub.focusNode);
    assert.equal(sub.focusNode.name, "flutter");
    // Should include flutter, dart (dependency), workspace:my-app (uses), profile:full (uses), docker (conflict)
    assert.ok(sub.nodeCount > 1);
    assert.ok(sub.nodes.some((n) => n.name === "dart"));
    assert.ok(sub.nodes.some((n) => n.name === "my-app"));
});

test("focusNode throws for non-existent node", () => {
    const graph = makeTestGraph();
    assert.throws(
        () => focusNode(graph, "nonexistent"),
        /not found/
    );
});

test("focusNode on orphan returns just that node", () => {
    const graph = makeTestGraph();
    const sub = focusNode(graph, "unused-pkg");
    assert.equal(sub.nodeCount, 1);
    assert.equal(sub.nodes[0].name, "unused-pkg");
});

// ─── findConflicts ────────────────────────────────────────────────────

test("findConflicts returns all conflict edges", () => {
    const graph = makeTestGraph();
    const conflicts = findConflicts(graph);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].from, "flutter");
    assert.equal(conflicts[0].to, "docker");
    assert.equal(conflicts[0].message, "test conflict");
});

test("findConflicts returns empty for no conflicts", () => {
    const graph = makeTestGraph();
    graph.edges = graph.edges.filter((e) => e.type !== "conflicts-with");
    const conflicts = findConflicts(graph);
    assert.equal(conflicts.length, 0);
});

// ─── findOrphans ──────────────────────────────────────────────────────

test("findOrphans returns nodes with no connections", () => {
    const graph = makeTestGraph();
    const orphans = findOrphans(graph);
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].name, "unused-pkg");
});

test("findOrphans returns empty when all nodes are connected", () => {
    const graph = makeTestGraph();
    // Remove the orphan node
    graph.nodes = graph.nodes.filter((n) => n.name !== "unused-pkg");
    const orphans = findOrphans(graph);
    assert.equal(orphans.length, 0);
});

// ─── renderGraphTree ──────────────────────────────────────────────────

test("renderGraphTree produces a tree for a node with dependencies", () => {
    const graph = makeTestGraph();
    const tree = renderGraphTree(graph, "flutter");
    assert.ok(tree.includes("flutter"));
    assert.ok(tree.includes("dart"));
    assert.ok(tree.includes("└──") || tree.includes("├──"));
});

test("renderGraphTree handles node with no dependencies", () => {
    const graph = makeTestGraph();
    const tree = renderGraphTree(graph, "dart");
    assert.ok(tree.includes("dart"));
});

test("renderGraphTree throws for non-existent node", () => {
    const graph = makeTestGraph();
    assert.throws(
        () => renderGraphTree(graph, "nonexistent"),
        /not found/
    );
});

// ─── exportGraph ──────────────────────────────────────────────────────

test("exportGraph produces valid JSON", () => {
    const graph = makeTestGraph();
    const json = exportGraph(graph, "json");
    const parsed = JSON.parse(json);
    assert.equal(parsed.devGraphVersion, DEV_GRAPH_VERSION);
    assert.ok(parsed.nodes);
    assert.ok(parsed.edges);
});

test("exportGraph produces valid Markdown", () => {
    const graph = makeTestGraph();
    const md = exportGraph(graph, "markdown");
    assert.ok(md.includes("# Development Environment Graph"));
    assert.ok(md.includes("## Statistics"));
    assert.ok(md.includes("## Nodes by Type"));
    assert.ok(md.includes("## Edges by Type"));
});

test("exportGraph produces valid HTML", () => {
    const graph = makeTestGraph();
    const html = exportGraph(graph, "html");
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("DEV Graph"));
});

test("exportGraph produces valid DOT", () => {
    const graph = makeTestGraph();
    const dot = exportGraph(graph, "dot");
    assert.ok(dot.includes("digraph devgraph {"));
    assert.ok(dot.includes("->"));
    assert.ok(dot.includes("}"));
});

test("exportGraph produces valid Mermaid", () => {
    const graph = makeTestGraph();
    const mermaid = exportGraph(graph, "mermaid");
    assert.ok(mermaid.includes("graph LR"));
    assert.ok(mermaid.includes("-->"));
});

test("exportGraph produces valid ASCII tree", () => {
    const graph = makeTestGraph();
    const tree = exportGraph(graph, "tree");
    assert.ok(typeof tree === "string");
    assert.ok(tree.length > 0);
});

test("exportGraph produces valid PlantUML", () => {
    const graph = makeTestGraph();
    const puml = exportGraph(graph, "plantuml");
    assert.ok(puml.includes("@startuml"));
    assert.ok(puml.includes("@enduml"));
});

test("exportGraph throws for unknown format", () => {
    const graph = makeTestGraph();
    assert.throws(
        () => exportGraph(graph, "xml"),
        /Unknown export format/
    );
});

// ─── verifyGraph ──────────────────────────────────────────────────────

test("verifyGraph returns PASS for a clean graph", () => {
    const graph = makeTestGraph();
    // Remove conflicts and orphans for clean graph
    graph.edges = graph.edges.filter((e) => e.type !== "conflicts-with");
    graph.nodes = graph.nodes.filter((n) => n.name !== "unused-pkg");
    graph.stats = computeStats(graph.nodes, graph.edges, graph.depthMap, graph.cycles);

    const result = verifyGraph(graph);
    assert.ok(result.results.some((r) => r.check === "cycles" && r.status === "PASS"));
    assert.ok(result.results.some((r) => r.check === "conflicts" && r.status === "PASS"));
});

test("verifyGraph detects conflicts", () => {
    const graph = makeTestGraph();
    const result = verifyGraph(graph);
    assert.ok(result.results.some((r) => r.check === "conflicts" && r.status === "WARNING"));
});

test("verifyGraph detects orphans", () => {
    const graph = makeTestGraph();
    const result = verifyGraph(graph);
    assert.ok(result.results.some((r) => r.check === "orphans" && r.status === "WARNING"));
});

// ─── compareGraphs ────────────────────────────────────────────────────

test("compareGraphs identifies added and removed nodes", () => {
    const oldGraph = makeTestGraph();
    const newGraph = makeTestGraph();

    // Add a node to new graph
    newGraph.nodes.push({ id: "package:new-pkg", type: "package", name: "new-pkg", label: "new-pkg", properties: {} });

    // Remove a node from new graph
    newGraph.nodes = newGraph.nodes.filter((n) => n.name !== "unused-pkg");

    const comparison = compareGraphs(oldGraph, newGraph);

    assert.equal(comparison.summary.addedCount, 1);
    assert.equal(comparison.summary.removedCount, 1);
    assert.equal(comparison.nodesAdded[0].name, "new-pkg");
    assert.equal(comparison.nodesRemoved[0].name, "unused-pkg");
});

test("compareGraphs identifies edge changes", () => {
    const oldGraph = makeTestGraph();
    const newGraph = makeTestGraph();

    // Add an edge to new graph
    newGraph.edges.push({ from: "package:unused-pkg", to: "package:node", type: "depends-on" });

    // Remove an edge from new graph
    newGraph.edges = newGraph.edges.filter((e) => !(e.from === "package:flutter" && e.to === "package:docker"));

    const comparison = compareGraphs(oldGraph, newGraph);

    assert.ok(comparison.summary.addedEdges >= 1);
    assert.ok(comparison.summary.removedEdges >= 1);
});

test("compareGraphs with identical graphs shows no changes", () => {
    const graph = makeTestGraph();
    const comparison = compareGraphs(graph, graph);
    assert.equal(comparison.summary.addedCount, 0);
    assert.equal(comparison.summary.removedCount, 0);
    assert.equal(comparison.summary.addedEdges, 0);
    assert.equal(comparison.summary.removedEdges, 0);
});

// ─── saveGraph / listHistory / loadGraph ─────────────────────────────

test("saveGraph writes a JSON file to ~/.devforgekit/dev-graph/", () => {
    withTempHome(() => {
        const graph = makeTestGraph();
        const filePath = saveGraph(graph);
        assert.ok(existsSync(filePath));
        assert.ok(filePath.endsWith(".json"));
    });
});

test("listHistory returns empty when no directory exists", () => {
    withTempHome(() => {
        const history = listHistory();
        assert.deepEqual(history, []);
    });
});

test("listHistory returns saved graphs sorted by date", () => {
    withTempHome(() => {
        const g1 = makeTestGraph();
        g1.createdAt = "2025-01-01T00:00:00.000Z";
        saveGraph(g1);

        const g2 = makeTestGraph();
        g2.createdAt = "2025-06-01T00:00:00.000Z";
        saveGraph(g2);

        const history = listHistory();
        assert.equal(history.length, 2);
        assert.equal(history[0].createdAt, "2025-06-01T00:00:00.000Z");
        assert.equal(history[1].createdAt, "2025-01-01T00:00:00.000Z");
    });
});

test("loadGraph reads a saved graph file", () => {
    withTempHome(() => {
        const graph = makeTestGraph();
        const filePath = saveGraph(graph);
        const loaded = loadGraph(filePath);
        assert.equal(loaded.devGraphVersion, DEV_GRAPH_VERSION);
        assert.ok(loaded.nodes);
    });
});

test("loadGraph throws for non-existent file", () => {
    withTempHome(() => {
        assert.throws(
            () => loadGraph("/nonexistent/file.json"),
            /not found/
        );
    });
});
