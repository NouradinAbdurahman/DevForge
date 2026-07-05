// A plain registry of local actions the assistant's own code (chat,
// doctor, planner) calls directly - normal function calls, not an
// autonomous LLM function-calling loop that decides on its own what to
// execute. Nothing here is destructive; installing/repairing/uninstalling
// always stays behind the same explicit, confirmed commands the
// Compatibility Engine and installer already require - see the plan's
// "No autonomous execution" scope decision.
import { gatherContext, installedComponentNames } from "../context/gather.js";
import { scanCompatibility } from "../../compatibility/engine.js";
import { loadPackages, getPackage, searchPackages } from "../../registry.js";

export const tools = {
    gatherContext: (opts) => gatherContext(opts),
    listInstalledComponents: () => installedComponentNames(),
    scanCompatibility: (names) => scanCompatibility(names),
    listComponents: () => loadPackages().map((p) => p.name),
    getComponent: (name) => getPackage(name),
    searchComponents: (query) => searchPackages(query).map((r) => r.pkg.name)
};

export function listTools() {
    return Object.keys(tools);
}

// callTool(name, ...args) - the one indirection point, so a future
// tool-calling integration (if ever added) has a single place to route
// through rather than reaching into every module directly.
export async function callTool(name, ...args) {
    const fn = tools[name];
    if (!fn) {
        throw new Error(`Unknown AI tool '${name}'. Known tools: ${listTools().join(", ")}`);
    }
    return fn(...args);
}
