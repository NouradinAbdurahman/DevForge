// Builds the normalized generation model: reads every tracked package's
// registry `environment` field fresh (never a stored copy - see
// state.js) and merges them into one deduplicated, canonically-ordered
// PATH list, one variables map, and one flat shell-lines list.
import { getPackage } from "../registry.js";
import { trackedNames } from "./state.js";

// Canonical PATH ordering - one fixed tier ranking so every regeneration
// produces the same result regardless of install order:
//   0  DevForgeKit-owned paths
//   1  mise shims (runtime activators must shadow package managers)
//   2  Homebrew / package-manager prefixes
//   3  package-specific bins (the default tier)
//   4  system paths (never allowed to shadow managed tools)
// Classification works on the RAW shell expression (values expand at
// shell-startup time, not generation time), so it's substring/prefix
// based and documented as such - an exotic expression lands in tier 3.
const SYSTEM_DIRS = new Set(["/usr/bin", "/bin", "/usr/sbin", "/sbin"]);

export function pathTier(entry) {
    const value = entry.toLowerCase();
    if (value.includes("devforgekit")) return 0;
    if (value.includes("mise")) return 1;
    if (value.includes("brew") || value.startsWith("/opt/homebrew") || value.startsWith("/usr/local")) return 2;
    if (SYSTEM_DIRS.has(entry)) return 4;
    return 3;
}

// normalizePathEntry(entry) -> the canonical form used for dedup: no
// trailing slash (the one normalization that's safe on an unexpanded
// shell expression - "$HOME/go/bin/" and "$HOME/go/bin" are always the
// same directory, whatever $HOME is).
export function normalizePathEntry(entry) {
    return entry.length > 1 ? entry.replace(/\/+$/, "") : entry;
}

// buildEnvironmentModel(state, { resolvePackage }) -> {
//   path: string[],                 deduplicated, canonical tier order (stable within a tier)
//   pathOwners: { entry: string[] },  which package(s) contributed each entry
//   variables: { KEY: { value?, command?, sourcePackage } },  last-write-wins
//   shell: [{ packageName, line }],
//   sourcePackages: string[],       tracked packages that actually contributed something
//   missingPackages: string[],      tracked names no longer in the registry (renamed/removed)
//   collisions: [{ key, packages: [firstOwner, latestOwner] }]  same variable key claimed by >1 package
// }
export function buildEnvironmentModel(state, { resolvePackage = getPackage } = {}) {
    const pathEntries = [];
    const pathOwners = {};
    const variables = {};
    const shell = [];
    const collisions = [];
    const sourcePackages = [];
    const missingPackages = [];

    for (const name of trackedNames(state)) {
        let pkg;
        try {
            pkg = resolvePackage(name);
        } catch {
            missingPackages.push(name);
            continue;
        }

        const env = pkg.environment;
        if (!env) continue;
        sourcePackages.push(name);

        for (const rawEntry of env.path || []) {
            const entry = normalizePathEntry(rawEntry);
            if (!pathOwners[entry]) {
                pathOwners[entry] = [];
                pathEntries.push(entry);
            }
            if (!pathOwners[entry].includes(name)) pathOwners[entry].push(name);
        }

        for (const [key, def] of Object.entries(env.variables || {})) {
            const existing = variables[key];
            if (existing && existing.sourcePackage !== name) {
                collisions.push({ key, packages: [existing.sourcePackage, name] });
            }
            variables[key] = { ...def, sourcePackage: name };
        }

        for (const line of env.shell || []) {
            shell.push({ packageName: name, line });
        }
    }

    // Stable sort: tier first, first-seen order within a tier. Array
    // .prototype.sort is stable in Node, so equal-tier entries keep
    // their alphabetical-by-package arrival order.
    pathEntries.sort((a, b) => pathTier(a) - pathTier(b));

    return { path: pathEntries, pathOwners, variables, shell, sourcePackages, missingPackages, collisions };
}
