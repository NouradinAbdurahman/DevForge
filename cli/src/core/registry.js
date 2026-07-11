// Loads and validates registry/categories/*.yaml + registry/packages/*.yaml
// (see docs/PlatformArchitecture.md section 3). Phase 1 ships the format,
// this loader, and ten real manifests - Phase 2's job is exclusively to
// add more packages/*.yaml files, not to change this loader.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { load as yamlLoad } from "js-yaml";
import Ajv2020 from "ajv/dist/2020.js";
import { repoRoot, userConfigDir } from "./paths.js";
import { DevForgeError } from "./errors.js";
import { scoreManifest } from "./quality.js";
import { didYouMeanMessage } from "../lib/suggest.js";

// The schemas under registry/schema/ declare $schema: .../2020-12/schema,
// so they must be compiled with Ajv's draft-2020-12 build - the default
// `Ajv` export only ships the draft-07 meta-schema and throws "no schema
// with key or ref" for anything newer.
const ajv = new Ajv2020({ allErrors: true });

function loadSchema(relativePath) {
    const raw = readFileSync(path.join(repoRoot(), relativePath), "utf8");
    return JSON.parse(raw);
}

const categorySchema = ajv.compile(loadSchema("registry/schema/category.schema.json"));
const packageSchema = ajv.compile(loadSchema("registry/schema/package.schema.json"));
const collectionSchema = ajv.compile(loadSchema("registry/schema/collection.schema.json"));
const profileSchema = ajv.compile(loadSchema("registry/schema/profile.schema.json"));
const recipeSchema = ajv.compile(loadSchema("registry/schema/recipe.schema.json"));

// REGISTRY_SCHEMAS/readYamlFiles/formatAjvErrors - exported so
// core/registryLint.js can validate every file and collect per-field
// errors across every file in one pass, without loadCategories()/
// loadPackages()'s throw-on-first-invalid-manifest behavior (correct
// for normal CLI use - fail fast - but wrong for a lint pass that wants
// to report every problem in one run).
export const REGISTRY_SCHEMAS = {
    categories: categorySchema,
    packages: packageSchema,
    collections: collectionSchema,
    profiles: profileSchema,
    recipes: recipeSchema
};

export function readYamlFiles(dir) {
    let entries;
    try {
        entries = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    } catch {
        return [];
    }
    return entries.map((file) => {
        const filePath = path.join(dir, file);
        const doc = yamlLoad(readFileSync(filePath, "utf8"));
        return { file, filePath, doc };
    });
}

export function formatAjvErrors(errors) {
    return (errors || [])
        .map((e) => `  ${e.instancePath || "/"} ${e.message}`)
        .join("\n");
}

// Module-level caches: each loader reads + parses YAML from disk on every
// call, which is the #1 performance bottleneck (261 packages = 261 file reads
// + YAML parses per call). The cache is keyed by directory path so tests with
// custom fixture dirs still work correctly. Use `clearRegistryCache()` to
// invalidate (e.g. after `registry generate` writes new files).
const _cache = new Map();

export function clearRegistryCache() {
    _cache.clear();
}

// loadCategories([dir]) -> [{ id, label, description }], throws a
// DevForgeError listing every invalid file at once (not just the first)
// so a bad manifest is fast to fix. `dir` defaults to this repo's
// registry/categories - overridable so tests can point at fixtures
// without touching the real registry.
export function loadCategories(dir = path.join(repoRoot(), "registry", "categories")) {
    const cacheKey = `cat:${dir}`;
    if (_cache.has(cacheKey)) return _cache.get(cacheKey);
    const files = readYamlFiles(dir);
    const problems = [];
    const categories = [];

    for (const { file, doc } of files) {
        if (!categorySchema(doc)) {
            problems.push(`${file}:\n${formatAjvErrors(categorySchema.errors)}`);
            continue;
        }
        categories.push(doc);
    }

    if (problems.length > 0) {
        throw new DevForgeError(`Invalid category manifest(s):\n${problems.join("\n")}`);
    }

    _cache.set(cacheKey, categories);
    return categories;
}

// loadPackages([dir]) -> [package manifest, ...], same all-errors-at-once
// and overridable-dir behavior as loadCategories().
export function loadPackages(dir = path.join(repoRoot(), "registry", "packages")) {
    const cacheKey = `pkg:${dir}`;
    if (_cache.has(cacheKey)) return _cache.get(cacheKey);
    const files = readYamlFiles(dir);
    const problems = [];
    const packages = [];

    for (const { file, doc } of files) {
        if (!packageSchema(doc)) {
            problems.push(`${file}:\n${formatAjvErrors(packageSchema.errors)}`);
            continue;
        }
        packages.push(doc);
    }

    if (problems.length > 0) {
        throw new DevForgeError(`Invalid package manifest(s):\n${problems.join("\n")}`);
    }

    _cache.set(cacheKey, packages);
    return packages;
}

export function getPackage(name) {
    const packages = loadPackages();
    // Use a cached name→pkg map for O(1) lookup instead of linear find()
    const cacheKey = "pkgMap";
    let map = _cache.get(cacheKey);
    if (!map) {
        map = new Map(packages.map(p => [p.name, p]));
        _cache.set(cacheKey, map);
    }
    const pkg = map.get(name);
    if (!pkg) {
        // A declared alias (registry package.schema.json's `aliases`
        // field) that getPackage() doesn't resolve directly is a
        // different case than a typo: "jdk" IS a real, registry-declared
        // name for java, so the message should point straight at java,
        // not run edit-distance scoring against it (which could easily
        // rank an unrelated same-length name above the real answer).
        const aliasOwner = packages.find((p) => (p.aliases || []).includes(name));
        const suggestion = aliasOwner
            ? `Did you mean '${aliasOwner.name}'? ('${name}' is an alias of it.)`
            : didYouMeanMessage(name, packages.map((p) => p.name));
        throw new DevForgeError(`Unknown component '${name}'.${suggestion ? ` ${suggestion}` : ""} Run 'devforgekit component list' to see available components.`);
    }
    return pkg;
}

// loadCollections([dir]) -> [{ schemaVersion, name, description, components }],
// same all-errors-at-once and overridable-dir behavior as loadCategories().
export function loadCollections(dir = path.join(repoRoot(), "registry", "collections")) {
    const cacheKey = `col:${dir}`;
    if (_cache.has(cacheKey)) return _cache.get(cacheKey);
    const files = readYamlFiles(dir);
    const problems = [];
    const collections = [];

    for (const { file, doc } of files) {
        if (!collectionSchema(doc)) {
            problems.push(`${file}:\n${formatAjvErrors(collectionSchema.errors)}`);
            continue;
        }
        collections.push(doc);
    }

    if (problems.length > 0) {
        throw new DevForgeError(`Invalid collection manifest(s):\n${problems.join("\n")}`);
    }

    _cache.set(cacheKey, collections);
    return collections;
}

export function getCollection(name) {
    const collections = loadCollections();
    const collection = collections.find((c) => c.name === name);
    if (!collection) {
        const suggestion = didYouMeanMessage(name, collections.map((c) => c.name));
        throw new DevForgeError(`Unknown collection '${name}'.${suggestion ? ` ${suggestion}` : ""} Run 'devforgekit collection list' to see available collections.`);
    }
    return collection;
}

// Profiles are a richer layer on top of collections (see
// docs/PlatformArchitecture.md's Profiles section): a profile composes
// one or more collections plus extra ad hoc components plus optional
// suggested config `settings`. They're discovered from two roots - the
// repo's shipped `registry/profiles/` and the user's own
// `~/.config/devforgekit/profiles/` (personal, `profile create`/`export`
// output) - the same multi-root discovery pattern `core/plugins.js`
// already uses, so a user profile can be added without ever touching
// this repo.
function profileDiscoveryRoots() {
    return [
        path.join(repoRoot(), "registry", "profiles"),
        path.join(userConfigDir(), "profiles")
    ];
}

// loadProfiles([roots]) -> [{ schemaVersion, name, description,
// collections?, components?, settings? }], same all-errors-at-once
// validation as the other loaders. Reads both discovery roots by
// default; pass an explicit array (as tests do) to isolate from the
// user's real ~/.config/devforgekit/profiles.
export function loadProfiles(roots = profileDiscoveryRoots()) {
    const cacheKey = `prof:${roots.join("|")}`;
    if (_cache.has(cacheKey)) return _cache.get(cacheKey);
    const problems = [];
    const profiles = [];

    for (const root of roots) {
        for (const { file, doc } of readYamlFiles(root)) {
            if (!profileSchema(doc)) {
                problems.push(`${file}:\n${formatAjvErrors(profileSchema.errors)}`);
                continue;
            }
            if ((!doc.collections || doc.collections.length === 0) && (!doc.components || doc.components.length === 0)) {
                problems.push(`${file}:\n  must declare at least one of 'collections' or 'components'`);
                continue;
            }
            profiles.push(doc);
        }
    }

    if (problems.length > 0) {
        throw new DevForgeError(`Invalid profile manifest(s):\n${problems.join("\n")}`);
    }

    _cache.set(cacheKey, profiles);
    return profiles;
}

export function getProfile(name) {
    const profiles = loadProfiles();
    const profile = profiles.find((p) => p.name === name);
    if (!profile) {
        const suggestion = didYouMeanMessage(name, profiles.map((p) => p.name));
        throw new DevForgeError(`Unknown profile '${name}'.${suggestion ? ` ${suggestion}` : ""} Run 'devforgekit profile list' to see available profiles.`);
    }
    return profile;
}

// validateProfileDoc(doc) -> doc, throws a DevForgeError with every
// schema problem if invalid. Used by `profile import` to validate an
// arbitrary YAML file (not necessarily one of the discovered profile
// roots) before installing it.
export function validateProfileDoc(doc) {
    if (!profileSchema(doc)) {
        throw new DevForgeError(`Invalid profile:\n${formatAjvErrors(profileSchema.errors)}`);
    }
    if ((!doc.collections || doc.collections.length === 0) && (!doc.components || doc.components.length === 0)) {
        throw new DevForgeError("Invalid profile: must declare at least one of 'collections' or 'components'");
    }
    return doc;
}

// expandProfile(profile) -> deduplicated string[] of package names: every
// component of every referenced collection, plus the profile's own
// ad hoc `components`, in that order. Does not itself resolve
// dependencies - callers feed the result into
// core/installer.js's resolveInstallOrder()/installPlan() for that.
export function expandProfile(profile) {
    const seen = new Set();
    const names = [];

    const add = (name) => {
        if (seen.has(name)) return;
        seen.add(name);
        names.push(name);
    };

    for (const collectionName of profile.collections || []) {
        for (const componentName of getCollection(collectionName).components) {
            add(componentName);
        }
    }
    for (const componentName of profile.components || []) {
        add(componentName);
    }

    return names;
}

// Recipes are a lighter-weight, one-off sibling of profiles (see
// docs/PlatformArchitecture.md's Recipe system section): a recipe
// composes collections/components exactly like a profile (expandRecipe
// below reuses expandProfile - the shape is identical), but also declares
// `configure` steps (cross-cutting dotfile/environment restoration - git,
// vscode, cursor, shell, mise - the same Layer 1 functions
// scripts/restore.sh already calls, see core/recipes.js) and an optional
// `verify` pass, so `recipe install <name>` is "install + configure +
// verify" in one command instead of a manual checklist. Discovered from
// the same two-root pattern as profiles - the repo's shipped
// `registry/recipes/` and the user's own `~/.config/devforgekit/recipes/`
// (`recipe create` output).
function recipeDiscoveryRoots() {
    return [
        path.join(repoRoot(), "registry", "recipes"),
        path.join(userConfigDir(), "recipes")
    ];
}

// loadRecipes([roots]) -> [{ schemaVersion, name, description,
// collections?, components?, configure?, verify?, settings? }], same
// all-errors-at-once validation as loadProfiles. Reads both discovery
// roots by default; pass an explicit array (as tests do) to isolate from
// the user's real ~/.config/devforgekit/recipes.
export function loadRecipes(roots = recipeDiscoveryRoots()) {
    const cacheKey = `rec:${roots.join("|")}`;
    if (_cache.has(cacheKey)) return _cache.get(cacheKey);
    const problems = [];
    const recipes = [];

    for (const root of roots) {
        for (const { file, doc } of readYamlFiles(root)) {
            if (!recipeSchema(doc)) {
                problems.push(`${file}:\n${formatAjvErrors(recipeSchema.errors)}`);
                continue;
            }
            if ((!doc.collections || doc.collections.length === 0) && (!doc.components || doc.components.length === 0)) {
                problems.push(`${file}:\n  must declare at least one of 'collections' or 'components'`);
                continue;
            }
            recipes.push(doc);
        }
    }

    if (problems.length > 0) {
        throw new DevForgeError(`Invalid recipe manifest(s):\n${problems.join("\n")}`);
    }

    _cache.set(cacheKey, recipes);
    return recipes;
}

export function getRecipe(name) {
    const recipes = loadRecipes();
    const recipe = recipes.find((r) => r.name === name);
    if (!recipe) {
        const suggestion = didYouMeanMessage(name, recipes.map((r) => r.name));
        throw new DevForgeError(`Unknown recipe '${name}'.${suggestion ? ` ${suggestion}` : ""} Run 'devforgekit recipe list' to see available recipes.`);
    }
    return recipe;
}

// validateRecipeDoc(doc) -> doc, throws a DevForgeError with every schema
// problem if invalid. Mirrors validateProfileDoc, for `recipe import`'s
// arbitrary-YAML-file use case (not necessarily one of the discovered
// recipe roots).
export function validateRecipeDoc(doc) {
    if (!recipeSchema(doc)) {
        throw new DevForgeError(`Invalid recipe:\n${formatAjvErrors(recipeSchema.errors)}`);
    }
    if ((!doc.collections || doc.collections.length === 0) && (!doc.components || doc.components.length === 0)) {
        throw new DevForgeError("Invalid recipe: must declare at least one of 'collections' or 'components'");
    }
    return doc;
}

// expandRecipe(recipe) -> deduplicated string[] of package names. Recipes
// and profiles share the exact same collections-then-components shape, so
// this is an explicitly-named wrapper around expandProfile rather than a
// duplicated loop - see expandProfile's own doc comment for the
// resolution order.
export function expandRecipe(recipe) {
    return expandProfile(recipe);
}

// checkIntegrity({ categories, packages, collections }) -> string[] of
// human-readable problems (empty array = clean). Cross-file references
// (a package's `category`/`dependencies`, a collection's `components`)
// can't be checked by schema validation alone, since JSON Schema has no
// concept of "this string must be the name of some other file's `name`
// field" - this is the referential-integrity pass registry-integrity
// tests and `registry generate` both run on top of the per-file schema
// checks above.
export function checkIntegrity({ categories, packages, collections, profiles = [], recipes = [] }) {
    const problems = [];
    const categoryIds = new Set(categories.map((c) => c.id));
    const packageNames = new Set(packages.map((p) => p.name));
    const collectionNames = new Set(collections.map((c) => c.name));

    for (const pkg of packages) {
        if (!categoryIds.has(pkg.category)) {
            problems.push(`Package '${pkg.name}' references unknown category '${pkg.category}'`);
        }
        for (const dep of pkg.dependencies || []) {
            if (!packageNames.has(dep)) {
                problems.push(`Package '${pkg.name}' depends on unknown package '${dep}'`);
            }
        }
        for (const conflict of pkg.conflicts || []) {
            if (!packageNames.has(conflict)) {
                problems.push(`Package '${pkg.name}' conflicts with unknown package '${conflict}'`);
            }
        }
    }

    for (const collection of collections) {
        for (const member of collection.components) {
            if (!packageNames.has(member)) {
                problems.push(`Collection '${collection.name}' references unknown package '${member}'`);
            }
        }
    }

    for (const profile of profiles) {
        for (const collectionName of profile.collections || []) {
            if (!collectionNames.has(collectionName)) {
                problems.push(`Profile '${profile.name}' references unknown collection '${collectionName}'`);
            }
        }
        for (const componentName of profile.components || []) {
            if (!packageNames.has(componentName)) {
                problems.push(`Profile '${profile.name}' references unknown package '${componentName}'`);
            }
        }
    }

    for (const recipe of recipes) {
        for (const collectionName of recipe.collections || []) {
            if (!collectionNames.has(collectionName)) {
                problems.push(`Recipe '${recipe.name}' references unknown collection '${collectionName}'`);
            }
        }
        for (const componentName of recipe.components || []) {
            if (!packageNames.has(componentName)) {
                problems.push(`Recipe '${recipe.name}' references unknown package '${componentName}'`);
            }
        }
    }

    return problems;
}

// loadRegistry() -> { categories, packages, collections, profiles, recipes },
// throws a single DevForgeError if checkIntegrity finds any cross-file
// reference problem. The one place callers (registry generate, CI
// tests) should reach for when they need the whole, cross-validated
// picture rather than one individually-loaded piece.
export function loadRegistry() {
    const categories = loadCategories();
    const packages = loadPackages();
    const collections = loadCollections();
    const profiles = loadProfiles();
    const recipes = loadRecipes();

    const problems = checkIntegrity({ categories, packages, collections, profiles, recipes });
    if (problems.length > 0) {
        throw new DevForgeError(`Registry integrity problems:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    }

    return { categories, packages, collections, profiles, recipes };
}

// getRegistryStats({ categories, packages, collections, profiles }) -> a
// plain object of analytics for `devforgekit registry stats`: totals,
// a dependency-graph summary, the largest collection/profile, duplicate
// aliases (two packages claiming the same name/alias - a real bug to
// catch), orphaned manifests (packages no collection/profile
// references), and a metadata-completeness score (% of packages with
// homepage+license+tags+aliases all present).
export function getRegistryStats({ categories, packages, collections, profiles, recipes = [] }) {
    const dependents = new Map();
    let dependencyEdges = 0;
    for (const pkg of packages) {
        for (const dep of pkg.dependencies || []) {
            dependencyEdges++;
            dependents.set(dep, (dependents.get(dep) || 0) + 1);
        }
    }
    let mostDependedUpon = null;
    for (const [name, count] of dependents) {
        if (!mostDependedUpon || count > mostDependedUpon.count) {
            mostDependedUpon = { name, count };
        }
    }

    const bundles = [
        ...collections.map((c) => ({ kind: "collection", name: c.name, size: c.components.length })),
        ...profiles.map((p) => ({ kind: "profile", name: p.name, size: expandProfile(p).length })),
        ...recipes.map((r) => ({ kind: "recipe", name: r.name, size: expandRecipe(r).length }))
    ];
    const largestBundle = bundles.reduce((max, b) => (!max || b.size > max.size ? b : max), null);

    const claimedBy = new Map(); // alias/name -> [package names claiming it]
    for (const pkg of packages) {
        for (const claim of [pkg.name, ...(pkg.aliases || [])]) {
            if (!claimedBy.has(claim)) claimedBy.set(claim, []);
            claimedBy.get(claim).push(pkg.name);
        }
    }
    const duplicateAliases = [...claimedBy.entries()]
        .filter(([, owners]) => new Set(owners).size > 1)
        .map(([alias, owners]) => ({ alias, owners: [...new Set(owners)] }));

    const referenced = new Set();
    for (const collection of collections) {
        for (const member of collection.components) referenced.add(member);
    }
    for (const profile of profiles) {
        for (const member of expandProfile(profile)) referenced.add(member);
    }
    for (const recipe of recipes) {
        for (const member of expandRecipe(recipe)) referenced.add(member);
    }
    const orphaned = packages.filter((p) => !referenced.has(p.name)).map((p) => p.name).sort();

    const completePackages = packages.filter((p) => p.homepage && p.license && p.tags?.length).length;
    const metadataCompletenessScore = packages.length === 0 ? 100 : Math.round((completePackages / packages.length) * 100);

    // Package Quality System: qualityScore is the average per-package
    // Manifest Quality Score (scoreManifest() in core/quality.js - a
    // categorized "Metadata / Documentation / Reliability /
    // Discoverability / Compatibility / Platform Support" breakdown, see
    // that file), not a redefinition of metadataCompletenessScore above
    // (that one stays focused on homepage/license/tags, the original
    // searchability fields). Only the structural (non-live) checks feed
    // this average, so it stays synchronous and network-free - the same
    // reasoning `registry-smoke.yml` stays a narrow, deliberately-scoped
    // live check rather than testing all 261 packages on every push.
    // ciVerifiedCount is a plain count, not a percentage - CI-verifying
    // every component live is neither feasible nor the goal; it's
    // reported so the real, current coverage is visible.
    const qualityScore = packages.length === 0 ? 100 : Math.round(
        packages.reduce((sum, p) => {
            // Use cached quality score if available
            if (p._qualityScore !== undefined) return sum + p._qualityScore;
            const s = scoreManifest(p).score;
            p._qualityScore = s;
            return sum + s;
        }, 0) / packages.length
    );
    const ciVerifiedCount = packages.filter((p) => p.ciVerified).length;

    return {
        totalComponents: packages.length,
        totalCategories: categories.length,
        totalCollections: collections.length,
        totalProfiles: profiles.length,
        totalRecipes: recipes.length,
        dependencyEdges,
        mostDependedUpon,
        largestBundle,
        duplicateAliases,
        orphaned,
        metadataCompletenessScore,
        qualityScore,
        ciVerifiedCount
    };
}

// searchPackages(query, { category, tag }) -> packages ranked by match
// quality: exact name match, then name substring, then tag/alias match,
// then description substring. Case-insensitive throughout. `category`/
// `tag` are optional exact-match filters applied before ranking (e.g.
// `search database --category databases` or `search --tag networking`).
export function searchPackages(query, { category: categoryFilter, tag: tagFilter } = {}) {
    const q = query.trim().toLowerCase();
    if (!q && !categoryFilter && !tagFilter) return [];

    // Build a search index once per registry load — avoids re-lowercasing
    // 261 packages' fields on every search call.
    let index = _cache.get("searchIndex");
    if (!index) {
        index = loadPackages().map((pkg) => ({
            pkg,
            name: pkg.name.toLowerCase(),
            tags: (pkg.tags || []).map((t) => t.toLowerCase()),
            aliases: (pkg.aliases || []).map((a) => a.toLowerCase()),
            description: pkg.description.toLowerCase(),
            category: pkg.category.toLowerCase(),
        }));
        _cache.set("searchIndex", index);
    }

    const scored = [];
    for (const entry of index) {
        const { pkg, name, tags, aliases, description, category } = entry;
        if (categoryFilter && pkg.category !== categoryFilter) continue;
        if (tagFilter && !(pkg.tags || []).includes(tagFilter)) continue;

        let score = 0;
        let matchedOn = null;
        if (name === q) {
            score = 100;
            matchedOn = "name";
        } else if (name.includes(q)) {
            score = 80;
            matchedOn = "name";
        } else if (aliases.includes(q)) {
            score = 70;
            matchedOn = "alias";
        } else if (aliases.some((a) => a.includes(q))) {
            score = 60;
            matchedOn = "alias";
        } else if (tags.includes(q)) {
            score = 55;
            matchedOn = "tag";
        } else if (tags.some((t) => t.includes(q))) {
            score = 50;
            matchedOn = "tag";
        } else if (category.includes(q)) {
            score = 30;
            matchedOn = "category";
        } else if (description.includes(q)) {
            score = 20;
            matchedOn = "description";
        }

        if (score > 0) {
            scored.push({ pkg, score, matchedOn });
        }
    }

    // Sort by match score, then by quality score (higher quality first), then alphabetically
    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const qa = a.pkg._qualityScore || 0;
        const qb = b.pkg._qualityScore || 0;
        if (qb !== qa) return qb - qa;
        return a.pkg.name.localeCompare(b.pkg.name);
    });
    return scored;
}
