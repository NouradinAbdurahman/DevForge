// Registry Completion (v3.0): `devforgekit registry lint` - fast,
// deterministic structural checks distinct from `registry doctor`
// (completeness/quality scoring) and `registry audit` (cross-platform
// coverage scorecard). Every finding names the exact file/package and
// field so a fix is a one-line YAML edit, never a guess.
import path from "node:path";
import { repoRoot } from "./paths.js";
import { readYamlFiles, REGISTRY_SCHEMAS, formatAjvErrors, loadPackages, loadCollections, loadProfiles, loadRecipes } from "./registry.js";
import { detectCycles, detectDuplicateTools } from "./compatibility/graph.js";
import { binaryNameFor } from "./environment/discovery.js";

const REGISTRY_DIRS = {
    categories: "categories",
    packages: "packages",
    collections: "collections",
    profiles: "profiles",
    recipes: "recipes"
};

// schemaViolations() -> [{ file, kind, message }] across every registry
// YAML file, independent of loadCategories()/loadPackages()'s
// throw-on-first-invalid behavior - every invalid file is reported, not
// just the first one found.
function schemaViolations({ root = repoRoot() } = {}) {
    const findings = [];
    for (const [kind, dir] of Object.entries(REGISTRY_DIRS)) {
        const schema = REGISTRY_SCHEMAS[kind];
        const files = readYamlFiles(path.join(root, "registry", dir));
        for (const { file, doc } of files) {
            if (!doc) {
                findings.push({ file: path.join(dir, file), kind, message: "empty or unparseable YAML document" });
                continue;
            }
            if (!schema(doc)) {
                findings.push({ file: path.join(dir, file), kind, message: formatAjvErrors(schema.errors).trim() });
            }
        }
    }
    return findings;
}

// duplicateIds() -> package `name` fields that don't match their own
// filename (a copy-paste-new-file mistake) or collide with another
// file's declared name.
function duplicateIds({ root = repoRoot() } = {}) {
    const findings = [];
    const files = readYamlFiles(path.join(root, "registry", "packages"));
    const byName = new Map();
    for (const { file, doc } of files) {
        if (!doc?.name) continue;
        const expectedFile = `${doc.name}.yaml`;
        if (file !== expectedFile) {
            findings.push({ file: path.join("packages", file), field: "name", message: `declares name '${doc.name}' but the filename is '${file}' (expected '${expectedFile}')` });
        }
        if (byName.has(doc.name)) {
            findings.push({ file: path.join("packages", file), field: "name", message: `duplicate package name '${doc.name}', also declared in ${byName.get(doc.name)}` });
        } else {
            byName.set(doc.name, file);
        }
    }
    return findings;
}

// duplicateBinaries() -> packages whose probed binary (binaryNameFor(),
// the same function the Environment Configuration Engine uses to decide
// what to `command -v`) collides with another package's - each would
// shadow the other's install-verification, so this is worth flagging
// even though it's sometimes intentional (kubectx/kubens share one
// install; docker/docker-compose both resolve to the `docker` CLI in
// Compose v2 - both excluded below as known-legitimate).
const KNOWN_SHARED_BINARIES = new Set(["docker"]);

function duplicateBinaries(packages = loadPackages()) {
    const byBinary = new Map();
    for (const pkg of packages) {
        if (pkg.variants) continue; // variant packages resolve their binary per-variant, not statically
        const bin = binaryNameFor(pkg);
        if (!byBinary.has(bin)) byBinary.set(bin, []);
        byBinary.get(bin).push(pkg.name);
    }
    const findings = [];
    for (const [bin, names] of byBinary) {
        if (names.length > 1 && !KNOWN_SHARED_BINARIES.has(bin)) {
            findings.push({ file: null, field: "binary", message: `binary '${bin}' is probed by ${names.length} packages: ${names.join(", ")} - add an explicit 'binary' field to disambiguate` });
        }
    }
    return findings;
}

// cyclicDependencies() -> reuses compatibility/graph.js's detectCycles()
// over the whole registry's `dependencies` edges.
function cyclicDependencies(packages = loadPackages()) {
    const cycles = detectCycles(packages.map((p) => p.name), { packages });
    return cycles.map((chain) => ({ file: null, field: "dependencies", message: `circular dependency: ${chain.join(" -> ")}` }));
}

// orphanPackages({ packages, collections, profiles, recipes }) -> entries
// not referenced by any collection/profile/recipe (a package only
// reachable via `component install <name>` directly - not necessarily
// wrong, but worth surfacing). Collections' `components` are read
// directly rather than through expandProfile()/expandRecipe() (which
// internally call the real, unscoped getCollection()) so this stays
// correct against a custom fixture root, not just the real registry.
function orphanPackages({ packages, collections, profiles, recipes }) {
    const collectionByName = new Map(collections.map((c) => [c.name, c]));
    const referenced = new Set();
    for (const collection of collections) {
        for (const name of collection.components || []) referenced.add(name);
    }
    const addFromBundle = (doc) => {
        for (const collectionName of doc.collections || []) {
            const collection = collectionByName.get(collectionName);
            for (const name of collection?.components || []) referenced.add(name);
        }
        for (const name of doc.components || []) referenced.add(name);
    };
    for (const profile of profiles) addFromBundle(profile);
    for (const recipe of recipes) addFromBundle(recipe);

    return packages
        .filter((p) => !referenced.has(p.name))
        .map((p) => ({ file: path.join("packages", `${p.name}.yaml`), field: null, message: `'${p.name}' is not referenced by any collection, profile, or recipe` }));
}

// lintRegistry() -> { errors, warnings } - errors are schema violations/
// duplicate IDs/cycles (a broken registry); warnings are duplicate
// binaries/orphans (worth reviewing, never block a build).
export function lintRegistry({ root = repoRoot() } = {}) {
    const errors = [];
    const warnings = [];

    errors.push(...schemaViolations({ root }).map((f) => ({ ...f, type: "schema_violation" })));
    errors.push(...duplicateIds({ root }).map((f) => ({ ...f, type: "duplicate_id" })));

    // The checks below need a fully loadable registry - skip them (schema
    // violations above already explain why) rather than throwing past
    // the point where loadPackages() would itself throw.
    if (errors.some((e) => e.type === "schema_violation")) {
        return { errors, warnings };
    }

    const registryDir = path.join(root, "registry");
    const packages = loadPackages(path.join(registryDir, "packages"));
    const collections = loadCollections(path.join(registryDir, "collections"));
    const profiles = loadProfiles([path.join(registryDir, "profiles")]);
    const recipes = loadRecipes([path.join(registryDir, "recipes")]);

    errors.push(...cyclicDependencies(packages).map((f) => ({ ...f, type: "cyclic_dependency" })));

    const dupTools = detectDuplicateTools(packages);
    for (const { claim, owners } of dupTools) {
        warnings.push({ file: null, field: "aliases", type: "duplicate_alias", message: `'${claim}' is claimed by ${owners.length} packages: ${owners.join(", ")}` });
    }

    warnings.push(...duplicateBinaries(packages).map((f) => ({ ...f, type: "duplicate_binary" })));
    warnings.push(...orphanPackages({ packages, collections, profiles, recipes }).map((f) => ({ ...f, type: "orphan_package" })));

    return { errors, warnings };
}
