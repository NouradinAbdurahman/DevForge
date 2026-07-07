// AI Package/Project Intelligence: real facts for `ai compare` (AI
// Assistant Excellence, v2.1.3 Phase 5/7). Every field here comes
// straight from a registry package manifest or a Project Generator's
// declared object - or an existing, already-audited quality-scoring
// function (scoreManifest/scoreGenerator) - never invented, so the
// "compare" prompt kind has real, DevForgeKit-sourced facts to compare
// instead of whatever the model already "knows" about the two names.
import { loadPackages } from "../registry.js";
import { getGenerator } from "../../generators/index.js";
import { scoreManifest } from "../quality.js";
import { scoreGenerator } from "../generatorQuality.js";

// resolveComparable(name) -> a fact object for a registry package or a
// Project Generator stack, or null if neither resolves. Synchronous -
// the generator quality score (which needs an async probe of the real
// generate() output) is filled in separately by
// resolveComparableWithScore(), so a package-only comparison never pays
// for an async call it doesn't need.
export function resolveComparable(name) {
    const pkg = loadPackages().find((p) => p.name === name || p.aliases?.includes(name));
    if (pkg) {
        return {
            kind: "package", name: pkg.name, description: pkg.description, category: pkg.category,
            tags: pkg.tags || [], homepage: pkg.homepage || null, license: pkg.license || null,
            dependencies: pkg.dependencies || [], conflicts: pkg.conflicts || [],
            platforms: pkg.platforms || [], stability: pkg.stability || null,
            qualityScore: scoreManifest(pkg).score
        };
    }
    const generator = getGenerator(name);
    if (generator) {
        return {
            kind: "project-generator-stack", id: generator.id, label: generator.label,
            description: generator.description, tags: generator.tags || [],
            recommends: generator.recommends || [], requiresTool: generator.requiresTool?.command || null
        };
    }
    return null;
}

// resolveComparableWithScore(name) -> resolveComparable(name), with a
// project-generator-stack's real Generator Quality Score filled in
// (async - calls the generator's real generate()). Packages already
// carry their score synchronously from resolveComparable.
export async function resolveComparableWithScore(name) {
    const facts = resolveComparable(name);
    if (facts?.kind === "project-generator-stack") {
        facts.qualityScore = (await scoreGenerator(getGenerator(name))).score;
    }
    return facts;
}
