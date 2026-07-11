// Environment dependency graph: which tracked tools depend on which,
// straight from the registry's real `dependencies` edges - reusing
// core/compatibility/graph.js's buildDependencyGraph (the same edges
// the installer's topological sort and the compatibility engine already
// walk) rather than inventing a third dependency representation.
import { buildDependencyGraph } from "../compatibility/graph.js";
import { loadPackages } from "../registry.js";
import { trackedNames } from "./state.js";

// buildEnvironmentGraph(state) -> { nodes, edges, missing } scoped to
// the tracked packages plus everything they transitively depend on
// (an untracked dependency still matters - removing Java breaks a
// tracked Flutter whether or not Java itself was DevForgeKit-installed).
export function buildEnvironmentGraph(state, { packages = loadPackages() } = {}) {
    return buildDependencyGraph(trackedNames(state), { packages });
}

// dependentsOf(name, state) -> tracked packages that (transitively)
// depend on `name` - the "Removing Java will affect: Flutter, Android
// SDK, Gradle" warning for uninstall flows.
export function dependentsOf(name, state, { packages = loadPackages() } = {}) {
    const graph = buildEnvironmentGraph(state, { packages });
    const directDependents = new Map();
    for (const edge of graph.edges) {
        if (!directDependents.has(edge.to)) directDependents.set(edge.to, []);
        directDependents.get(edge.to).push(edge.from);
    }

    const affected = new Set();
    const queue = [name];
    while (queue.length > 0) {
        const current = queue.shift();
        for (const dependent of directDependents.get(current) || []) {
            if (!affected.has(dependent)) {
                affected.add(dependent);
                queue.push(dependent);
            }
        }
    }
    affected.delete(name);
    return [...affected].sort();
}

// renderEnvironmentTree(state) -> string[] - one tree per tracked root
// (a tracked package nothing else tracked depends on), children being
// its registry dependencies:
//   flutter
//    ├── dart
//    └── java
export function renderEnvironmentTree(state, { packages = loadPackages() } = {}) {
    const graph = buildEnvironmentGraph(state, { packages });
    const dependencies = new Map();
    for (const edge of graph.edges) {
        if (!dependencies.has(edge.from)) dependencies.set(edge.from, []);
        dependencies.get(edge.from).push(edge.to);
    }
    const dependedUpon = new Set(graph.edges.map((e) => e.to));
    const tracked = trackedNames(state);
    const roots = tracked.filter((name) => !dependedUpon.has(name));

    const lines = [];
    const renderNode = (name, prefix, isLast, seen) => {
        const connector = prefix === "" ? "" : isLast ? "└── " : "├── ";
        lines.push(`${prefix}${connector}${name}${seen.has(name) ? " (…)" : ""}`);
        if (seen.has(name)) return;
        seen.add(name);
        const children = (dependencies.get(name) || []).sort();
        const childPrefix = prefix === "" ? " " : prefix + (isLast ? "    " : "│   ");
        children.forEach((child, i) => renderNode(child, childPrefix, i === children.length - 1, seen));
    };
    for (const root of roots.length > 0 ? roots : tracked) {
        renderNode(root, "", true, new Set());
    }
    return lines;
}
