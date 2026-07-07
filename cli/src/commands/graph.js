// Development Environment Graph command (v1.3.6, overhauled for
// Environment Graph Excellence in v2.1.4). See core/devGraph.js and
// docs/EnvironmentGraph.md.
import { writeFileSync } from "node:fs";
import {
    buildGraphCached,
    analyzeImpact,
    findPath,
    searchGraph,
    focusNode,
    findConflicts,
    findOrphans,
    groupOrphansByType,
    renderGraphTree,
    exportGraph,
    verifyGraph,
    compareGraphs,
    explainNode,
    saveGraph,
    listHistory,
    loadGraph,
    clearGraphCache
} from "../core/devGraph.js";
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";

// addRefreshOption(cmd) - every subcommand reads the graph via
// buildGraphCached() (a 30-minute TTL cache - see devGraph.js), so this
// one flag is the escape hatch when a user just installed/removed
// something and wants the graph to reflect it immediately.
function addRefreshOption(cmd) {
    return cmd.option("--refresh", "bypass the 30-minute graph cache and rebuild from scratch");
}

export function registerGraphCommand(program) {
    const graph = program
        .command("graph")
        .description("Development Environment Graph - visualize and analyze your entire dev ecosystem")
        .alias("env")
        .alias("deps");

    // ─── open (default = build + display) ────────────────────────────
    addRefreshOption(graph
        .command("open", { isDefault: true })
        .description("Build and display the environment graph")
        .option("--json", "output graph as JSON")
        .option("--save", "save graph to history")
        .option("--format <format>", "export format: tree, json, dot, mermaid, svg", "tree"))
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const g = await buildGraphCached({ refresh: opts.refresh });

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

    // ─── cache ───────────────────────────────────────────────────────
    graph
        .command("cache")
        .description("Show or clear the graph's 30-minute build cache")
        .option("--clear", "clear the cache now")
        .action(withErrorHandling(function () {
            const opts = this.opts();
            if (opts.clear) {
                const cleared = clearGraphCache();
                logger.success(cleared ? "Graph cache cleared." : "No graph cache to clear.");
                return;
            }
            logger.info("Every 'graph' subcommand caches its build for 30 minutes. Use --refresh on any command to bypass it, or 'graph cache --clear' to clear it now.");
        }));

    // ─── search ──────────────────────────────────────────────────────
    addRefreshOption(graph
        .command("search [query]")
        .description("Search graph nodes by name, type, description, tag, or category")
        .option("-f, --filter <filter>", "filter: installed, broken, unused, critical, workspace, recipe, plugin, profile")
        .option("--json", "output as JSON"))
        .action(withErrorHandling(async function (query) {
            const opts = this.opts();
            const g = await buildGraphCached({ refresh: opts.refresh });
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
    addRefreshOption(graph
        .command("explain <name>")
        .description("AI-powered explanation of a node in the graph (requires AI provider)")
        .option("--provider <id>", "AI provider to use")
        .option("--model <model>", "model override")
        .option("--endpoint <url>", "custom API endpoint"))
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const g = await buildGraphCached({ refresh: opts.refresh });
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
    addRefreshOption(graph
        .command("export [format]")
        .description("Export graph (json, markdown, html, dot, mermaid, svg, tree, plantuml)")
        .option("-f, --format <format>", "output format", "markdown")
        .option("-o, --output <file>", "output file (default: stdout)")
        .option("--save", "save graph to history before exporting"))
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const g = await buildGraphCached({ refresh: opts.refresh });

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
    addRefreshOption(graph
        .command("verify")
        .description("Verify graph integrity (missing nodes, cycles, conflicts, orphans)"))
        .action(withErrorHandling(async function () {
            const g = await buildGraphCached({ refresh: this.opts().refresh });
            const result = verifyGraph(g);

            logger.section("Graph Verification");
            for (const r of result.results) {
                const symbol = r.status === "PASS" ? "✓" : "!";
                console.log(`\n  ${symbol} ${r.check}: ${r.status}${r.count !== undefined ? ` (${r.count})` : ""}${r.edge ? ` - ${r.edge}` : ""}`);
            }
            console.log(`\n  Overall: ${result.health} (${result.warningCount} warning(s))`);
        }));

    // ─── stats ───────────────────────────────────────────────────────
    addRefreshOption(graph
        .command("stats")
        .description("Show graph statistics")
        .option("--json", "output as JSON"))
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const g = await buildGraphCached({ refresh: opts.refresh });

            if (opts.json) {
                console.log(JSON.stringify(g.stats, null, 2));
                return;
            }

            logger.section("Graph Statistics");
            console.log(`\n  Total nodes: ${g.stats.totalNodes}`);
            console.log(`  Total edges: ${g.stats.totalEdges}`);
            console.log(`  Installed: ${g.stats.installedCount}`);
            console.log(`  Missing: ${g.stats.missingCount}`);
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

            if (Object.keys(g.stats.byCategory).length > 0) {
                console.log(`\n  Category distribution:`);
                for (const [category, count] of Object.entries(g.stats.byCategory)) {
                    console.log(`    ${category}: ${count}`);
                }
            }

            if (Object.keys(g.stats.byPlatform).length > 0) {
                console.log(`\n  Platform distribution:`);
                for (const [platform, count] of Object.entries(g.stats.byPlatform)) {
                    console.log(`    ${platform}: ${count}`);
                }
            }

            if (Object.keys(g.stats.byArchitecture).length > 0) {
                console.log(`\n  Architecture distribution:`);
                for (const [arch, count] of Object.entries(g.stats.byArchitecture)) {
                    console.log(`    ${arch}: ${count}`);
                }
            }

            if (g.stats.mostDependedNode) {
                const node = g.nodes.find((n) => n.id === g.stats.mostDependedNode);
                console.log(`\n  Most depended-upon: ${node?.name || g.stats.mostDependedNode} (${g.stats.mostDependedCount} dependents)`);
            }
        }));

    // ─── path ────────────────────────────────────────────────────────
    addRefreshOption(graph
        .command("path <from> <to>")
        .description("Find the shortest path between two nodes in the graph"))
        .action(withErrorHandling(async function (from, to) {
            const g = await buildGraphCached({ refresh: this.opts().refresh });
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
    addRefreshOption(graph
        .command("impact <name>")
        .description("Show what would be affected if a node were removed")
        .option("--json", "output as JSON"))
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const g = await buildGraphCached({ refresh: opts.refresh });
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
    addRefreshOption(graph
        .command("conflicts")
        .description("Show all conflict edges in the graph")
        .option("--json", "output as JSON"))
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const g = await buildGraphCached({ refresh: opts.refresh });
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
    addRefreshOption(graph
        .command("orphan")
        .description("Show orphan nodes (no connections in the graph), grouped by type")
        .option("--json", "output as JSON"))
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const g = await buildGraphCached({ refresh: opts.refresh });
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

            // Grouped by type (v2.1.4 Phase 6) - "why is this an orphan"
            // reads a lot clearer as "5 unused CLIs" than one flat list
            // mixing CLI tools, themes, and package managers together.
            // Snapshot/benchmark records are excluded from this list
            // entirely (see devGraph.js's NON_ORPHANABLE_TYPES) - they're
            // point-in-time records, not tools with a "used by" concept.
            const byType = groupOrphansByType(orphans);
            for (const [type, nodes] of Object.entries(byType)) {
                console.log(`\n  ${type} (${nodes.length}):`);
                for (const node of nodes) {
                    console.log(`    - ${node.name}${node.properties?.description ? ` - ${node.properties.description}` : ""}`);
                }
            }
            console.log(`\n  ${orphans.length} orphan node(s)`);
        }));

    // ─── focus ───────────────────────────────────────────────────────
    addRefreshOption(graph
        .command("focus <name>")
        .description("Extract a subgraph focused on a single node and its connections")
        .option("--format <format>", "output format: tree, json, dot, mermaid, svg", "tree"))
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const g = await buildGraphCached({ refresh: opts.refresh });
            const subgraph = focusNode(g, name);

            logger.section(`Focused Graph: ${name}`);
            console.log(`\n  Nodes: ${subgraph.nodeCount}`);
            console.log(`  Edges: ${subgraph.edgeCount}`);
            console.log();

            if (opts.format === "json") {
                console.log(JSON.stringify(subgraph, null, 2));
            } else if (opts.format === "tree") {
                console.log(renderGraphTree(g, name, { maxDepth: 5 }));
            } else {
                // dot/mermaid/svg: `subgraph` already has the `{nodes,
                // edges}` shape exportGraph() needs (v2.1.4 - this used to
                // reimplement dot/mermaid formatting inline here, byte-
                // for-byte duplicating exportDot()/exportMermaid() in
                // devGraph.js).
                console.log(exportGraph(subgraph, opts.format));
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
