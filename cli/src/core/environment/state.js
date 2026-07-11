// Persisted state for the Environment Configuration Engine:
// ~/.config/devforgekit/environment.json tracks every package DevForgeKit
// has installed/registered, with per-package *observed facts* (where its
// binary really is, what version answered, which provider installed it,
// when that was last verified) - never the computed PATH/variables/shell
// lines themselves. Those are always rebuilt fresh from the registry by
// model.js at generation time, so there is exactly one source of truth
// for what a package's environment metadata says right now (the registry
// manifest) - storing a computed copy here would let it drift from the
// manifest after a `registry generate` update, which is exactly the kind
// of drift this whole subsystem exists to prevent.
//
// Schema v2 (packages became an object keyed by name; v1 was a plain
// string array). loadEnvironmentState migrates v1 documents on read -
// the names survive, the metadata fields start null until the next
// discovery pass fills them in honestly.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { userConfigDir } from "../paths.js";

const SCHEMA_VERSION = 2;

// The observed-fact fields every tracked package carries. `declared`
// means "has an `environment` field in its registry manifest" (i.e.
// contributes lines to the generated shell file); a package can be
// tracked purely for discovery/version bookkeeping without one.
const EMPTY_ENTRY = {
    provider: null,
    binary: null,
    location: null,
    version: null,
    declared: false,
    verified: false,
    lastVerified: null
};

export function environmentStateFile() {
    return path.join(userConfigDir(), "environment.json");
}

function migrateV1(parsed) {
    const packages = {};
    for (const name of parsed.packages || []) {
        if (typeof name === "string") packages[name] = { ...EMPTY_ENTRY };
    }
    return { packages, generatedAt: parsed.generatedAt || null, files: {}, version: SCHEMA_VERSION };
}

// loadEnvironmentState() -> {
//   packages: { [name]: { provider, binary, location, version, declared, verified, lastVerified } },
//   files:    { [shell]: { hash } },   // last-generated content hash, for manual-edit detection
//   generatedAt, version
// }
// A missing or corrupt file is a normal, expected state (nothing has
// registered environment config yet) - never thrown, mirroring
// workspace/store.js's own missing-pointer-file handling.
export function loadEnvironmentState() {
    const file = environmentStateFile();
    if (!existsSync(file)) {
        return { packages: {}, files: {}, generatedAt: null, version: SCHEMA_VERSION };
    }
    try {
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        if (Array.isArray(parsed.packages)) return migrateV1(parsed);
        const packages = {};
        for (const [name, entry] of Object.entries(parsed.packages || {})) {
            packages[name] = { ...EMPTY_ENTRY, ...entry };
        }
        return {
            packages,
            files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
            generatedAt: parsed.generatedAt || null,
            version: SCHEMA_VERSION
        };
    } catch {
        return { packages: {}, files: {}, generatedAt: null, version: SCHEMA_VERSION };
    }
}

// trackedNames(state) -> sorted string[] - the canonical iteration order
// everywhere (model building AND persistence use this same order, so
// regeneration is deterministic; see index.js's ordering-drift note).
export function trackedNames(state) {
    return Object.keys(state.packages).sort();
}

export function saveEnvironmentState(state) {
    const file = environmentStateFile();
    mkdirSync(path.dirname(file), { recursive: true });
    const packages = {};
    for (const name of trackedNames(state)) {
        packages[name] = { ...EMPTY_ENTRY, ...state.packages[name] };
    }
    const doc = {
        version: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        packages,
        files: state.files || {}
    };
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    return doc;
}

// upsertPackage(state, name, meta) -> a new state with `name` tracked
// and `meta` merged over any existing entry, or the exact same reference
// back when nothing would change (pure - does not write to disk), so
// callers can cheaply skip a regenerate with `result === state`.
export function upsertPackage(state, name, meta = {}) {
    const existing = state.packages[name];
    const merged = { ...EMPTY_ENTRY, ...existing, ...meta };
    if (existing && JSON.stringify(existing) === JSON.stringify(merged)) return state;
    return { ...state, packages: { ...state.packages, [name]: merged } };
}

export function removePackage(state, name) {
    if (!(name in state.packages)) return state;
    const packages = { ...state.packages };
    delete packages[name];
    return { ...state, packages };
}
