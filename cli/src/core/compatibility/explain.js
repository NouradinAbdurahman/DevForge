// The Explain Engine: a per-component breakdown ("Flutter 3.44 requires:
// Dart 3.8 (found 3.9, OK)...") rather than scanCompatibility()'s flat issue
// list - the worked example in the PRD. Reuses the exact same rules/version
// lookups engine.js does, structured for direct display instead of prose.
import { loadPackages } from "../registry.js";
import { DevForgeError } from "../errors.js";
import { loadCompatibilityRules, getRulesForPackage } from "./rules.js";
import { detectInstalledVersion } from "./versions.js";
import { matchesVersion, findVersionRule } from "./versionMatch.js";

async function collectRequirements(byName, source, tier, out) {
    for (const [depName, range] of Object.entries(source || {})) {
        const depPkg = byName.get(depName);
        const installedVersion = depPkg ? await detectInstalledVersion(depPkg) : null;
        const satisfied = depPkg ? matchesVersion(installedVersion, range) : null;
        out.push({ name: depName, range, tier, installedVersion, satisfied, knownPackage: Boolean(depPkg) });
    }
}

// explainComponent(name, [opts]) -> {
//   name, installedVersion, matchedVersionKey, deprecated, experimental,
//   unsupported, requirements: [{ name, range, tier, installedVersion,
//   satisfied, knownPackage }], conflicts: [name, ...], recommendations: [string, ...]
// }
export async function explainComponent(name, { packages = loadPackages(), rules = loadCompatibilityRules() } = {}) {
    const byName = new Map(packages.map((p) => [p.name, p]));
    // A local lookup against the same `packages` this call was given,
    // not core/registry.js's getPackage() (which always reads the real
    // registry) - so a caller passing a fixture/override actually gets
    // evaluated against it, matching every other function in this module.
    const pkg = byName.get(name);
    if (!pkg) {
        throw new DevForgeError(`Unknown component '${name}'. Run 'devforgekit component list' to see available components.`);
    }
    const installedVersion = await detectInstalledVersion(pkg);
    const pkgRules = getRulesForPackage(name, rules);

    let versionKey = null;
    let versionRule = null;
    if (installedVersion) {
        for (const rule of pkgRules) {
            const matched = findVersionRule(rule.versions, installedVersion);
            if (matched) {
                versionKey = matched.key;
                versionRule = matched.rule;
                break;
            }
        }
    }

    const requirements = [];
    for (const rule of pkgRules) {
        await collectRequirements(byName, rule.requires, "requires", requirements);
    }
    if (versionRule) {
        await collectRequirements(byName, versionRule.requires, "requires", requirements);
        await collectRequirements(byName, versionRule.recommends, "recommends", requirements);
    }

    const conflicts = new Set();
    for (const rule of pkgRules) {
        for (const c of rule.conflicts || []) conflicts.add(c);
    }
    if (versionRule) {
        for (const c of versionRule.conflicts || []) conflicts.add(c);
    }

    const recommendations = [];
    for (const req of requirements) {
        if (req.satisfied === true) continue;
        const depPkg = byName.get(req.name);
        if (!depPkg) continue;
        if (req.installedVersion && depPkg.update) {
            recommendations.push(`Run: ${depPkg.update}`);
        } else if (!req.installedVersion && depPkg.install) {
            recommendations.push(`devforgekit component install ${req.name}`);
        }
    }
    if (versionRule?.deprecated && pkg.update) recommendations.push(`Run: ${pkg.update}`);

    return {
        name,
        installedVersion,
        matchedVersionKey: versionKey,
        deprecated: Boolean(versionRule?.deprecated),
        experimental: Boolean(versionRule?.experimental),
        unsupported: Boolean(versionRule?.unsupported),
        requirements,
        conflicts: [...conflicts],
        recommendations
    };
}
