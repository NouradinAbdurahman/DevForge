// Dependency graph analysis for the Compatibility Engine. Deliberately
// distinct from installer.js's resolveInstallOrder: that function only ever
// walks a package's `dependencies` edges (which the registry's own
// checkIntegrity already guarantees are acyclic and fully resolvable - see
// core/registry.js), and throws immediately on a cycle since an install
// genuinely cannot proceed with one. This module instead *reports* problems
// (missing/circular/duplicate) without throwing, since `compatibility graph`
// is a read-only diagnostic - and, unlike the installer, it's the one place
// that can ever actually observe a genuinely new failure mode: a cycle
// formed by mixing package `dependencies` edges with compatibility-rule
// `requires` edges together (the installer never looks at the latter at all).
import { loadPackages } from "../registry.js";

// buildDependencyGraph(names, [{ packages }]) -> { nodes, edges, missing }.
// Walks only the structural `dependencies` field (informational graph for
// `compatibility graph`) - a name in `missing` means a package declares a
// dependency that isn't a real registry package, which the shipped registry
// can never actually have (checkIntegrity already rejects it at load time)
// but is still worth reporting defensively for any future custom/plugin-
// extended package set.
export function buildDependencyGraph(names, { packages = loadPackages() } = {}) {
    const byName = new Map(packages.map((p) => [p.name, p]));
    const nodes = new Set();
    const edges = [];
    const missing = new Set();
    const seen = new Set();

    function visit(name) {
        if (seen.has(name)) return;
        seen.add(name);
        nodes.add(name);
        const pkg = byName.get(name);
        if (!pkg) {
            missing.add(name);
            return;
        }
        for (const dep of pkg.dependencies || []) {
            edges.push({ from: name, to: dep, type: "dependency" });
            if (!byName.has(dep)) missing.add(dep);
            visit(dep);
        }
    }

    for (const name of names) visit(name);
    return { nodes: [...nodes], edges, missing: [...missing] };
}

// detectCycles(names, [{ packages }]) -> string[][] - one array per cycle
// found, each the ordered chain of names (last entry repeats the first).
// Same visited/visiting DFS shape as installer.js's resolveInstallOrder,
// but collects every cycle instead of throwing on the first one.
export function detectCycles(names, { packages = loadPackages() } = {}) {
    const byName = new Map(packages.map((p) => [p.name, p]));
    const visiting = new Set();
    const visited = new Set();
    const cycles = [];

    function visit(name, chain) {
        if (visited.has(name)) return;
        if (visiting.has(name)) {
            const start = chain.indexOf(name);
            cycles.push([...chain.slice(start), name]);
            return;
        }
        visiting.add(name);
        const pkg = byName.get(name);
        for (const dep of pkg?.dependencies || []) {
            visit(dep, [...chain, name]);
        }
        visiting.delete(name);
        visited.add(name);
    }

    for (const name of names) visit(name, []);
    return cycles;
}

// detectDuplicateTools([packages]) -> [{ claim, owners }] - two or more
// packages claiming the same name/alias. A scoped re-check of the same
// signal core/registry.js's getRegistryStats already computes registry-wide
// (`duplicateAliases`) - kept as its own small pass here rather than
// importing that whole stats computation, since `compatibility graph`'s
// scope (a requested set of tools) and `registry stats`'s scope (the entire
// registry) are genuinely different call sites.
export function detectDuplicateTools(packages = loadPackages()) {
    const claimedBy = new Map();
    for (const pkg of packages) {
        for (const claim of [pkg.name, ...(pkg.aliases || [])]) {
            if (!claimedBy.has(claim)) claimedBy.set(claim, []);
            claimedBy.get(claim).push(pkg.name);
        }
    }
    return [...claimedBy.entries()]
        .filter(([, owners]) => new Set(owners).size > 1)
        .map(([claim, owners]) => ({ claim, owners: [...new Set(owners)] }));
}
