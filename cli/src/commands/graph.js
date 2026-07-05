// Development Environment Graph command (v1.3.6). See core/devGraph.js.
import { writeFileSync } from "node:fs";
import {
    buildGraph,
    analyzeImpact,
    findPath,
    searchGraph,
    applyGraphFilter,
    focusNode,
    findConflicts,
    findOrphans,
    renderGraphTree,
    computeStats,
    exportGraph,
    verifyGraph,
    compareGraphs,
    explainNode,
    saveGraph,
    listHistory,
    loadGraph,
    NODE_TYPES,
    EDGE_TYPES
} from "../core/devGraph.js";
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";

export function registerGraphCommand(program) {
    const graph = program
        .command("graph")
        .description("Development Environment Graph - visualize and analyze your entire dev ecosystem")
        .alias("env")
        .alias("deps");

    // ─── open (default = build + display) ────────────────────────────
    graph
        .command("open", { isDefault: true })
        .description("Build and display the environment graph")
        .option("--json", "output graph as JSON")
        .option("--save", "save graph to history")
        .option("--format <format>", "export format: tree, json, dot, mermaid", "tree")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const g = await buildGraph();

            if (opts.save) {
                const filePath = saveGraph(g);
                logger.success(`Saved to ${filePath}`);
            }

            if (opts.json) {
                console.log(JSON.stringify(g, null, 2));
            } else if (opts.format === "tree") {
                const tree = exportGraph(g, "tree");
                console.log(tree);
            } else {
                console.log(exportGraph(g, opts.format));
            }
        }));

    // ─── search ──────────────────────────────────────────────────────
    graph
        .command("search [query]")
        .description("Search graph nodes by name, type, description, tag, or category")
        .option("-f, --filter <filter>", "filter: installed, broken, unused, duplicate, large, recent, critical, outdated, workspace, recipe, plugin, profile")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (query) {
            const opts = this.opts();
            const g = await buildGraph();
            const results = searchGraph(g, query, { filter: opts.filter });

            if (opts.json) {
                console.log(JSON.stringify(results, null, 2));
                return;
            }

            logger.section("Graph Search Results");
            if (results.length === 0) {
                logger.info("No nodes found");
                return;
            }

            for (const node of results) {
                const installed = node.properties?.installed ? "✓" : " ";
                console.log(`\n  [${installed}] ${node.name} (${node.type})`);
                if (node.properties?.description) console.log(`      ${node.properties.description}`);
            }
            console.log(`\n  ${results.length} node(s)`);
        }));

    // ─── explain ─────────────────────────────────────────────────────
    graph
        .command("explain <name>")
        .description("AI-powered explanation of a node in the graph (requires AI provider)")
        .option("--provider <id>", "AI provider to use")
        .option("--model <model>", "model override")
        .option("--endpoint <url>", "custom API endpoint")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const g = await buildGraph();
            const result = await explainNode(g, name, {
                provider: opts.provider,
                model: opts.model,
                endpoint: opts.endpoint
            });
            if (!result.ok) {
                logger.error(result.error);
                process.exitCode = 1;
                return;
            }
            console.log(result.explanation);
        }));

    // ─── export ──────────────────────────────────────────────────────
    graph
        .command("export [format]")
        .description("Export graph (json, markdown, html, dot, mermaid, tree, plantuml)")
        .option("-f, --format <format>", "output format", "markdown")
        .option("-o, --output <file>", "output file (default: stdout)")
        .option("--save", "save graph to history before exporting")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const g = await buildGraph();

            if (opts.save) {
                saveGraph(g);
            }

            const format = opts.format || "markdown";
            const content = exportGraph(g, format);

            if (opts.output) {
                writeFileSync(opts.output, content);
                logger.success(`Exported to ${opts.output}`);
            } else {
                console.log(content);
            }
        }));

    // ─── verify ──────────────────────────────────────────────────────
    graph
        .command("verify")
        .description("Verify graph integrity (missing nodes, cycles, conflicts, orphans)")
        .action(withErrorHandling(async () => {
            const g = await buildGraph();
            const result = verifyGraph(g);

            logger.section("Graph Verification");
            for (const r of result.results) {
                const symbol = r.status === "PASS" ? "✓" : "!";
                console.log(`\n  ${symbol} ${r.check}: ${r.status}${r.count !== undefined ? ` (${r.count})` : ""}${r.edge ? ` - ${r.edge}` : ""}`);
            }
            console.log(`\n  Overall: ${result.health} (${result.warningCount} warning(s))`);
        }));

    // ─── stats ───────────────────────────────────────────────────────
    graph
        .command("stats")
        .description("Show graph statistics")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const g = await buildGraph();

            if (opts.json) {
                console.log(JSON.stringify(g.stats, null, 2));
                return;
            }

            logger.section("Graph Statistics");
            console.log(`\n  Total nodes: ${g.stats.totalNodes}`);
            console.log(`  Total edges: ${g.stats.totalEdges}`);
            console.log(`  Average depth: ${g.stats.averageDepth}`);
            console.log(`  Max depth: ${g.stats.maxDepth}`);
            console.log(`  Orphans: ${g.stats.orphanCount}`);
            console.log(`  Conflicts: ${g.stats.conflictCount}`);
            console.log(`  Cycles: ${g.stats.cycleCount}`);

            console.log(`\n  Nodes by type:`);
            for (const [type, count] of Object.entries(g.stats.nodesByType)) {
                console.log(`    ${type}: ${count}`);
            }

            console.log(`\n  Edges by type:`);
            for (const [type, count] of Object.entries(g.stats.edgesByType)) {
                console.log(`    ${type}: ${count}`);
            }

            if (g.stats.mostDependedNode) {
                const node = g.nodes.find((n) => n.id === g.stats.mostDependedNode);
                console.log(`\n  Most depended-upon: ${node?.name || g.stats.mostDependedNode} (${g.stats.mostDependedCount} dependents)`);
            }
        }));

    // ─── path ────────────────────────────────────────────────────────
    graph
        .command("path <from> <to>")
        .description("Find the shortest path between two nodes in the graph")
        .action(withErrorHandling(async (from, to) => {
            const g = await buildGraph();
            const result = findPath(g, from, to);

            if (!result) {
                logger.info(`No path found from '${from}' to '${to}'`);
                return;
            }

            logger.section(`Path: ${from} → ${to}`);
            console.log();
            for (let i = 0; i < result.length; i++) {
                const arrow = i < result.length - 1 ? " →" : "";
                console.log(`  ${result[i]}${arrow}`);
            }
            console.log(`\n  ${result.length} node(s), ${result.length - 1} hop(s)`);
        }));

    // ─── impact ──────────────────────────────────────────────────────
    graph
        .command("impact <name>")
        .description("Show what would be affected if a node were removed")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const g = await buildGraph();
            const impact = analyzeImpact(g, name);

            if (opts.json) {
                console.log(JSON.stringify(impact, null, 2));
                return;
            }

            logger.section(`Impact: ${name}`);
            console.log(`\n  Total affected: ${impact.totalAffected}`);

            if (impact.directDependents.length > 0) {
                console.log(`\n  Direct dependents:`);
                for (const dep of impact.directDependents) {
                    console.log(`    - ${dep}`);
                }
            }

            if (Object.keys(impact.byType).length > 0) {
                console.log(`\n  Affected by type:`);
                for (const [type, count] of Object.entries(impact.byType)) {
                    console.log(`    ${type}: ${count}`);
                }
            }

            if (impact.affectedNodes.length > 0) {
                console.log(`\n  All affected nodes:`);
                for (const node of impact.affectedNodes) {
                    console.log(`    - ${node.name} (${node.type})`);
                }
            }
        }));

    // ─── conflicts ───────────────────────────────────────────────────
    graph
        .command("conflicts")
        .description("Show all conflict edges in the graph")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const g = await buildGraph();
            const conflicts = findConflicts(g);

            if (opts.json) {
                console.log(JSON.stringify(conflicts, null, 2));
                return;
            }

            logger.section("Graph Conflicts");
            if (conflicts.length === 0) {
                logger.success("No conflicts detected");
                return;
            }

            for (const c of conflicts) {
                console.log(`\n  ${c.from} ↔ ${c.to}`);
                if (c.message) console.log(`    ${c.message}`);
            }
            console.log(`\n  ${conflicts.length} conflict(s)`);
        }));

    // ─── orphan ──────────────────────────────────────────────────────
    graph
        .command("orphan")
        .description("Show orphan nodes (no connections in the graph)")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const g = await buildGraph();
            const orphans = findOrphans(g);

            if (opts.json) {
                console.log(JSON.stringify(orphans, null, 2));
                return;
            }

            logger.section("Orphan Nodes");
            if (orphans.length === 0) {
                logger.success("No orphan nodes detected");
                return;
            }

            for (const node of orphans) {
                console.log(`\n  ${node.name} (${node.type})`);
                if (node.properties?.description) console.log(`    ${node.properties.description}`);
            }
            console.log(`\n  ${orphans.length} orphan node(s)`);
        }));

    // ─── focus ───────────────────────────────────────────────────────
    graph
        .command("focus <name>")
        .description("Extract a subgraph focused on a single node and its connections")
        .option("--format <format>", "output format: tree, json, dot, mermaid", "tree")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const g = await buildGraph();
            const subgraph = focusNode(g, name);

            logger.section(`Focused Graph: ${name}`);
            console.log(`\n  Nodes: ${subgraph.nodeCount}`);
            console.log(`  Edges: ${subgraph.edgeCount}`);

            if (opts.format === "json") {
                console.log(JSON.stringify(subgraph, null, 2));
            } else if (opts.format === "tree") {
                console.log();
                console.log(renderGraphTree(g, name, { maxDepth: 5 }));
            } else if (opts.format === "dot") {
                console.log("digraph focus {");
                for (const edge of subgraph.edges) {
                    const fromName = subgraph.nodes.find((n) => n.id === edge.from)?.name || edge.from;
                    const toName = subgraph.nodes.find((n) => n.id === edge.to)?.name || edge.to;
                    console.log(`  "${fromName}" -> "${toName}" [label="${edge.type}"];`);
                }
                console.log("}");
            } else if (opts.format === "mermaid") {
                console.log("graph LR");
                for (const edge of subgraph.edges) {
                    const fromName = subgraph.nodes.find((n) => n.id === edge.from)?.name || edge.from;
                    const toName = subgraph.nodes.find((n) => n.id === edge.to)?.name || edge.to;
                    console.log(`  ${fromName} -->|${edge.type}| ${toName}`);
                }
            }
        }));

    // ─── history ─────────────────────────────────────────────────────
    graph
        .command("history")
        .description("List past graph snapshots")
        .option("--compare <newFile>", "compare with a specific graph file")
        .action(withErrorHandling(function () {
            const opts = this.opts();
            const history = listHistory();

            if (opts.compare) {
                if (history.length === 0) {
                    logger.info("No historical graphs to compare with");
                    return;
                }
                const oldGraph = loadGraph(history[0].path);
                const newGraph = loadGraph(opts.compare);
                const comparison = compareGraphs(oldGraph, newGraph);

                logger.section("Graph Comparison");
                console.log(`\n  Nodes added: ${comparison.summary.addedCount}`);
                for (const n of comparison.nodesAdded) {
                    console.log(`    + ${n.name} (${n.type})`);
                }
                console.log(`\n  Nodes removed: ${comparison.summary.removedCount}`);
                for (const n of comparison.nodesRemoved) {
                    console.log(`    - ${n.name} (${n.type})`);
                }
                console.log(`\n  Nodes unchanged: ${comparison.summary.unchangedCount}`);
                console.log(`  Edges added: ${comparison.summary.addedEdges}`);
                console.log(`  Edges removed: ${comparison.summary.removedEdges}`);
                return;
            }

            if (history.length === 0) {
                logger.info("No graph history found. Run 'devforgekit graph open --save' to create one.");
                return;
            }

            logger.section("Graph History");
            console.log("\n  Date                          Nodes  Edges  Orphans  Conflicts  Cycles");
            console.log("  " + "-".repeat(85));
            for (const h of history) {
                const date = h.createdAt ? h.createdAt.slice(0, 19).replace("T", " ") : "unknown";
                const nodes = String(h.nodes).padStart(5);
                const edges = String(h.edges).padStart(6);
                const orphans = String(h.orphans).padStart(8);
                const conflicts = String(h.conflicts).padStart(10);
                const cycles = String(h.cycles).padStart(7);
                console.log(`  ${date}  ${nodes}  ${edges}  ${orphans}  ${conflicts}  ${cycles}`);
            }
            console.log(`\n  ${history.length} record(s)`);
        }));
}
