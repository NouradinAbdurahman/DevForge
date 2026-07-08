// Loads registry/compatibility/*.yaml (see docs/RuleSchema.md), the same
// schema-validate-everything-at-once pattern as core/registry.js's
// loadPackages/loadCollections, then layers in every valid plugin's own
// optional `rules` field (Plugin SDK - see cli/src/schemas/plugin.schema.json)
// as synthetic, name-exempt rule entries.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { load as yamlLoad } from "js-yaml";
import Ajv2020 from "ajv/dist/2020.js";
import { repoRoot } from "../paths.js";
import { DevForgeError } from "../errors.js";
import { loadPackages } from "../registry.js";
import { discoverPlugins } from "../plugins.js";

// See core/registry.js for why this needs the draft-2020-12 Ajv build.
const ajv = new Ajv2020({ allErrors: true });

function loadSchema(relativePath) {
    const raw = readFileSync(path.join(repoRoot(), relativePath), "utf8");
    return JSON.parse(raw);
}

const compatibilitySchema = ajv.compile(loadSchema("registry/schema/compatibility.schema.json"));

function readYamlFiles(dir) {
    let entries;
    try {
        entries = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    } catch {
        return [];
    }
    return entries.map((file) => {
        const filePath = path.join(dir, file);
        return { file, filePath, doc: yamlLoad(readFileSync(filePath, "utf8")) };
    });
}

function formatAjvErrors(errors) {
    return (errors || []).map((e) => `  ${e.instancePath || "/"} ${e.message}`).join("\n");
}

// loadCompatibilityRuleFiles([dir]) -> [rule doc, ...], throwing a single
// DevForgeError listing every schema problem at once (mirrors
// core/registry.js's loadPackages). `dir` is overridable so tests can point
// at fixtures instead of the real registry/compatibility/.
export function loadCompatibilityRuleFiles(dir = path.join(repoRoot(), "registry", "compatibility")) {
    const files = readYamlFiles(dir);
    const problems = [];
    const rules = [];

    for (const { file, doc } of files) {
        if (!compatibilitySchema(doc)) {
            problems.push(`${file}:\n${formatAjvErrors(compatibilitySchema.errors)}`);
            continue;
        }
        rules.push(doc);
    }

    if (problems.length > 0) {
        throw new DevForgeError(`Invalid compatibility rule manifest(s):\n${problems.join("\n")}`);
    }
    return rules;
}

// normalizeRequires(requires) -> { name: rangeString }. The PRD's plugin
// rule example shapes each requirement as `{ version: ">=29" }`; registry
// rule files use a plain string. Both are accepted and normalized to a
// plain string range here so the rest of the engine only ever deals with
// one shape.
function normalizeRequires(requires) {
    const out = {};
    for (const [name, value] of Object.entries(requires || {})) {
        out[name] = typeof value === "string" ? value : value?.version;
    }
    return out;
}

// pluginContributedRules([discovered]) -> synthetic rule docs, one per
// valid plugin that declares a `rules` field. `source: "plugin"` marks
// these as exempt from "name must be a real registry package" in
// checkRuleIntegrity - a plugin's name is its own identity, not a package.
export function pluginContributedRules(discovered = discoverPlugins()) {
    const rules = [];
    for (const plugin of discovered) {
        if (!plugin.valid || !plugin.manifest.rules) continue;
        const { requires, conflicts, recommends } = plugin.manifest.rules;
        rules.push({
            schemaVersion: 1,
            name: plugin.name,
            source: "plugin",
            requires: normalizeRequires(requires),
            conflicts: conflicts || [],
            recommends: recommends ? Object.keys(normalizeRequires(recommends)) : []
        });
    }
    return rules;
}

function checkNames(problems, ruleName, names, label, packageNames) {
    for (const n of names || []) {
        if (!packageNames.has(n)) {
            problems.push(`Compatibility rule '${ruleName}': ${label} references unknown package '${n}'`);
        }
    }
}

// checkRuleIntegrity(rules, [packages]) -> string[] of problems (empty =
// clean). Cross-checks every name a rule references - its own `name`
// (unless plugin-contributed), every `requires`/`recommends`/`compatible`/
// `conflicts` target at both the top level and inside each `versions` entry,
// and every `variantConflicts` id against the real package's declared
// variants - the same "schema validation can't check this" reasoning
// core/registry.js's checkIntegrity documents.
export function checkRuleIntegrity(rules, packages = loadPackages()) {
    const problems = [];
    const packageNames = new Set(packages.map((p) => p.name));
    const packageByName = new Map(packages.map((p) => [p.name, p]));

    for (const rule of rules) {
        if (rule.source !== "plugin" && !packageNames.has(rule.name)) {
            problems.push(`Compatibility rule '${rule.name}' does not match any registry package`);
        }
        checkNames(problems, rule.name, rule.conflicts, "conflicts", packageNames);
        checkNames(problems, rule.name, rule.recommends, "recommends", packageNames);
        checkNames(problems, rule.name, Object.keys(rule.requires || {}), "requires", packageNames);

        for (const [versionKey, versionRule] of Object.entries(rule.versions || {})) {
            checkNames(problems, rule.name, Object.keys(versionRule.requires || {}), `versions.${versionKey}.requires`, packageNames);
            checkNames(problems, rule.name, Object.keys(versionRule.recommends || {}), `versions.${versionKey}.recommends`, packageNames);
            checkNames(problems, rule.name, versionRule.compatible, `versions.${versionKey}.compatible`, packageNames);
            checkNames(problems, rule.name, versionRule.conflicts, `versions.${versionKey}.conflicts`, packageNames);
        }

        if (rule.variantConflicts) {
            const pkg = packageByName.get(rule.name);
            const variantIds = new Set((pkg?.variants || []).map((v) => v.id));
            for (const [a, b] of rule.variantConflicts) {
                if (!variantIds.has(a)) problems.push(`Compatibility rule '${rule.name}': variantConflicts references unknown variant '${a}'`);
                if (!variantIds.has(b)) problems.push(`Compatibility rule '${rule.name}': variantConflicts references unknown variant '${b}'`);
            }
        }
    }

    return problems;
}

// loadCompatibilityRules() -> every rule (registry files + plugin
// contributions), integrity-checked together. The one place callers should
// reach for the full, cross-validated picture - mirrors core/registry.js's
// loadRegistry().
export function loadCompatibilityRules() {
    const packages = loadPackages();
    const rules = [...loadCompatibilityRuleFiles(), ...pluginContributedRules()];
    const problems = checkRuleIntegrity(rules, packages);
    if (problems.length > 0) {
        throw new DevForgeError(`Compatibility rule integrity problems:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    }
    return rules;
}

// getRulesForPackage(name, [rules]) -> every rule entry targeting `name`
// (normally one registry file, plus zero or more plugin contributions -
// engine.js merges them rather than picking just one).
export function getRulesForPackage(name, rules = loadCompatibilityRules()) {
    return rules.filter((r) => r.name === name);
}
