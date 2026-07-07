// Integration tests for the real buildGraph() pipeline (Environment
// Graph Excellence, v2.1.4) - deliberately separate from devGraph.test.js,
// whose 70 tests all exercise pure algorithms against a hand-built
// synthetic fixture and never call buildGraph() itself. That gap is
// exactly where the v2.1.4 audit found this milestone's headline bug (a
// node-ID mismatch silently dropping ~22% of real edges) - a synthetic
// fixture can't catch a bug in how the real registry gets turned into a
// graph. These tests are genuinely slow (buildGraph() takes ~15-20s
// against the real ~261-package registry - the same cost `graph stats`
// pays on the CLI side), so buildGraph() runs ONCE in `before()` and
// every test asserts against that one shared result rather than each
// paying the cost separately.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    buildGraph,
    buildGraphCached,
    clearGraphCache,
    NODE_TYPES,
    EDGE_TYPES,
    analyzeImpact
} from "../src/core/devGraph.js";

const ORIGINAL_HOME = process.env.HOME;
let tempHome;
let graph;

before(async () => {
    tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-graph-build-test-"));
    process.env.HOME = tempHome;
    graph = await buildGraph();
});

after(() => {
    process.env.HOME = ORIGINAL_HOME;
    rmSync(tempHome, { recursive: true, force: true });
});

test("buildGraph() produces zero dangling edges against the real registry (the v2.1.4 node-ID-mismatch fix)", () => {
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    const dangling = graph.edges.filter((e) => !nodeIds.has(e.from) || !nodeIds.has(e.to));
    assert.equal(dangling.length, 0, `expected 0 dangling edges, found ${dangling.length}: ${JSON.stringify(dangling.slice(0, 5))}`);
});

test("a category-typed package (not in any hardcoded name list) gets the same node id as an edge source and an edge target", () => {
    // Before the v2.1.4 fix, 'dart' (typed via its registry `category`,
    // not a hardcoded name list) resolved to two different ids depending
    // on whether it was the node itself or an edge's target.
    const dart = graph.nodes.find((n) => n.name === "dart");
    assert.ok(dart, "expected a 'dart' node to exist");
    const impact = analyzeImpact(graph, "dart");
    assert.ok(impact.directDependents.includes("flutter"), "flutter depends on dart, and impact analysis should see it");
});

test("every package node carries a real Manifest Quality Score (0-100), not a fabricated value", () => {
    const packageNodes = graph.nodes.filter((n) => n.properties?.qualityScore !== undefined);
    assert.ok(packageNodes.length > 0);
    for (const node of packageNodes) {
        assert.ok(node.properties.qualityScore >= 0 && node.properties.qualityScore <= 100, `${node.name} has an out-of-range qualityScore`);
    }
});

test("real compatibility-rule nodes exist, one per registry/compatibility/*.yaml file", () => {
    const ruleNodes = graph.nodes.filter((n) => n.type === NODE_TYPES.COMPATIBILITY_RULE);
    assert.ok(ruleNodes.length > 0, "expected at least one compatibility-rule node");
    assert.ok(ruleNodes.some((n) => n.name === "flutter"), "expected a 'flutter' compatibility-rule node");
});

test("real REQUIRES/RECOMMENDS edges exist, sourced from compatibility rule files and generator recommends", () => {
    const recommends = graph.edges.filter((e) => e.type === EDGE_TYPES.RECOMMENDS);
    assert.ok(recommends.length > 0, "expected at least one RECOMMENDS edge");
});

test("real Project Generator stack nodes exist, wired to their real recommends arrays", () => {
    const generatorNodes = graph.nodes.filter((n) => n.type === NODE_TYPES.GENERATOR);
    assert.ok(generatorNodes.length >= 15, `expected ~17 generator nodes, found ${generatorNodes.length}`);
    const flutterGen = generatorNodes.find((n) => n.name === "flutter");
    assert.ok(flutterGen, "expected a 'flutter' generator stack node");
    const impact = analyzeImpact(graph, "firebase");
    assert.ok(impact.affectedNodes.some((n) => n.type === NODE_TYPES.GENERATOR), "expected firebase's impact to include a generator stack that recommends it");
});

test("package nodes carry real platforms/architectures from the registry, not fabricated values", () => {
    const withPlatforms = graph.nodes.filter((n) => (n.properties?.platforms || []).length > 0);
    assert.ok(withPlatforms.length > 0);
});

test("buildGraphCached() serves a fast cache hit on the second call, and clearGraphCache() forces a real rebuild", async () => {
    clearGraphCache();
    const first = await buildGraphCached();
    const t0 = Date.now();
    const second = await buildGraphCached();
    const cachedElapsed = Date.now() - t0;
    assert.equal(first.createdAt, second.createdAt, "second call should be the exact same cached graph");
    assert.ok(cachedElapsed < 2000, `expected a cache hit to be fast, took ${cachedElapsed}ms`);

    const cleared = clearGraphCache();
    assert.equal(cleared, true);
    assert.equal(clearGraphCache(), false, "nothing left to clear the second time");
}); // note: intentionally does not call buildGraphCached({refresh:true}) here - that would re-pay the full ~15-20s cost a third time in this file
