// Registry Completion (v3.0): deterministic YAML formatting for every
// hand-authored registry/{categories,packages,collections,profiles,
// recipes}/*.yaml file - `devforgekit registry format` normalizes key
// order, indentation, and array style so the registry always
// regenerates byte-identically (a formatting-only diff never shows up
// alongside a real content change, and CI can fail a PR that
// reformatted by hand instead of running the formatter).
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { load as yamlLoad, dump as yamlDump } from "js-yaml";
import { repoRoot } from "./paths.js";

// Field order mirrors the convention already dominant across the 261
// hand-authored package files (verified by sampling, not invented) -
// formatting canonicalizes the existing convention rather than
// replacing it with an arbitrary new one. New v3.0 fields (`binary`,
// `conflicts`) are placed next to the fields they're most related to.
const PACKAGE_FIELD_ORDER = [
    "schemaVersion", "name", "description", "category", "platforms", "architectures",
    "variants", "install", "binary", "dependencies", "conflicts",
    "validate", "versionCommand", "repair", "update", "uninstall", "post_install",
    "recommendedAlternatives",
    "homepage", "repository", "license", "documentation", "maintainer",
    "tags", "aliases", "stability", "lastVerified", "ciVerified",
    "platformInstall", "environment"
];

const CATEGORY_FIELD_ORDER = ["id", "label", "description"];

const COLLECTION_FIELD_ORDER = ["schemaVersion", "name", "description", "components"];

const PROFILE_FIELD_ORDER = ["schemaVersion", "name", "description", "collections", "components", "settings"];

const RECIPE_FIELD_ORDER = [
    "schemaVersion", "name", "description", "icon", "tags",
    "collections", "components", "configure", "verify", "settings"
];

const REGISTRY_KINDS = [
    { dir: "categories", order: CATEGORY_FIELD_ORDER },
    { dir: "packages", order: PACKAGE_FIELD_ORDER },
    { dir: "collections", order: COLLECTION_FIELD_ORDER },
    { dir: "profiles", order: PROFILE_FIELD_ORDER },
    { dir: "recipes", order: RECIPE_FIELD_ORDER }
];

// reorderKeys(doc, order) -> a new plain object with `doc`'s own keys
// reordered to match `order`; any key not listed (shouldn't happen once
// `order` is exhaustive against the schema, but never silently drops
// data if it does) is appended afterward, alphabetically, so nothing is
// ever lost even if the canonical list falls behind a schema change.
export function reorderKeys(doc, order) {
    const result = {};
    for (const key of order) {
        if (Object.prototype.hasOwnProperty.call(doc, key)) result[key] = doc[key];
    }
    const remaining = Object.keys(doc).filter((k) => !order.includes(k)).sort();
    for (const key of remaining) result[key] = doc[key];
    return result;
}

// FLOW_ARRAY_KEYS - short scalar-array fields that read better as one
// flow-style line ([macos, linux, windows]) than a block list, matching
// the existing hand-authored convention for these specific fields.
const FLOW_ARRAY_KEYS = new Set(["platforms", "architectures", "tags", "aliases", "components", "collections", "configure"]);

function dumpYaml(doc) {
    return yamlDump(doc, {
        lineWidth: -1,
        noRefs: true,
        flowLevel: -1,
        styles: { "!!seq": "block" },
        sortKeys: false,
        replacer: undefined
    });
}

// formatYamlDoc(doc, order) -> canonical YAML text for one document.
// js-yaml's dump() has no per-key flow-style control, so short scalar
// arrays are dumped block-style then mechanically collapsed to flow
// style afterward for the specific fields where that's the established
// convention (platforms/architectures/tags/aliases/...) - regex-based
// on purpose: only touches `key:\n  - a\n  - b` blocks for those exact
// keys, never rewrites string content.
export function formatYamlDoc(rawDoc, order) {
    const ordered = reorderKeys(rawDoc, order);
    let text = dumpYaml(ordered);
    for (const key of FLOW_ARRAY_KEYS) {
        const blockPattern = new RegExp(`^${key}:\\n((?:  - .+\\n)+)`, "m");
        text = text.replace(blockPattern, (match, items) => {
            const values = items.trim().split("\n").map((l) => l.replace(/^\s*-\s*/, ""));
            if (values.length === 0) return match;
            return `${key}: [${values.join(", ")}]\n`;
        });
    }
    return text;
}

// formatRegistryFile(filePath, order) -> { changed, before, after }.
export function formatRegistryFile(filePath, order) {
    const before = readFileSync(filePath, "utf8");
    const doc = yamlLoad(before);
    if (!doc) return { changed: false, before, after: before };
    const after = formatYamlDoc(doc, order);
    return { changed: before !== after, before, after };
}

// formatRegistry({ check, root }) -> walks every registry/*/*.yaml file,
// canonicalizes it, and (unless check) writes back only the files that
// actually changed - never touching a byte of an already-canonical
// file, so a re-run after formatting is a true no-op (verified by
// cli/test/registryFormat.test.js's idempotency check).
export function formatRegistry({ check = false, root = repoRoot() } = {}) {
    const results = [];
    for (const { dir, order } of REGISTRY_KINDS) {
        const dirPath = path.join(root, "registry", dir);
        let files;
        try {
            files = readdirSync(dirPath).filter((f) => f.endsWith(".yaml"));
        } catch {
            continue;
        }
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const { changed, after } = formatRegistryFile(filePath, order);
            if (changed && !check) writeFileSync(filePath, after);
            results.push({ file: path.join("registry", dir, file), changed });
        }
    }
    return results;
}
