// Public API for the Environment Configuration Engine - the only module
// other subsystems (installer events, the `env` command, bootstrap.sh
// via the CLI) should import from. Internal modules (state/model/
// discovery/writers/hook/validator/snapshot) are implementation details.
//
// The engine is the single source of truth for every tool DevForgeKit
// installs - not only packages that declare `environment` metadata.
// Every successful install is tracked with observed facts (binary
// location, version, provider - see discovery.js); packages that DO
// declare environment metadata additionally contribute lines to the
// generated shell files.
import { getPackage } from "../registry.js";
import { pluginEvents } from "../events.js";
import { getPlatform } from "../platform/index.js";
import { logger } from "../logger.js";
import { loadEnvironmentState, saveEnvironmentState, upsertPackage, removePackage, trackedNames } from "./state.js";
import { buildEnvironmentModel } from "./model.js";
import { writeShellFile } from "./shellFile.js";
import { installEnvironmentHook } from "./hook.js";
import { validateEnvironment } from "./validator.js";
import { discoverPackage } from "./discovery.js";
import { isShellImplemented } from "./writers/index.js";
import { createEnvironmentSnapshot, listEnvironmentSnapshots, getEnvironmentSnapshot, restoreEnvironmentSnapshot } from "./snapshot.js";
import { diffModels, recordTransaction } from "./changelog.js";
import { homeDir } from "../paths.js";

export { SUPPORTED_SHELLS, ALL_SHELLS, EnvironmentUnsupportedShellError, shellCapabilities } from "./writers/index.js";
export { trackedNames } from "./state.js";
export { createEnvironmentSnapshot, listEnvironmentSnapshots, getEnvironmentSnapshot };
export { diffEnvironment } from "./diff.js";
export { buildEnvironmentGraph, dependentsOf, renderEnvironmentTree } from "./graph.js";
export { detectRunningEditors, editorReloadGuidance } from "./editors.js";
export { listTransactionDays, readTransactions } from "./changelog.js";
// env watch lives in ./watch.js and is imported by the command directly,
// NOT re-exported here: watch.js imports registerPackageEnvironment from
// this module, so re-exporting it back would create an import cycle.

// The EnvironmentEngine -> Platform -> Shell -> Writer chain: the
// platform adapter names the shells that matter on this OS; any shell
// whose writer isn't implemented yet is skipped with a warning (the
// Windows adapter names powershell so the contract is complete, but no
// PowerShell writer exists - see writers/index.js) rather than throwing
// away the whole generation or emitting guessed syntax.
function shellsToGenerate({ warn = true } = {}) {
    const shells = [];
    for (const shell of getPlatform().shells()) {
        if (isShellImplemented(shell)) {
            shells.push(shell);
        } else if (warn) {
            logger.warn(`Environment Configuration Engine: no '${shell}' writer yet - skipping (see docs/EnvironmentEngine.md)`);
        }
    }
    return shells;
}

function applyState(state, { action = "regenerate" } = {}) {
    const beforeState = loadEnvironmentState();
    const before = buildEnvironmentModel(beforeState);
    const model = buildEnvironmentModel(state);
    const fileHashes = { ...(state.files || {}) };
    const files = [];
    for (const shell of shellsToGenerate()) {
        const written = writeShellFile(shell, model, { lastHash: fileHashes[shell]?.hash });
        const hook = installEnvironmentHook(shell);
        fileHashes[shell] = { hash: written.hash };
        files.push({
            shell,
            file: written.file,
            rcFile: hook.rcFile,
            manualEditBackup: written.manualEditBackup || hook.manualEditBackup || null
        });
    }
    saveEnvironmentState({ ...state, files: fileHashes });

    // Transaction log: record what observably changed (see changelog.js)
    // - a no-op regeneration writes nothing, so the log stays a change
    // history rather than a heartbeat. Tracked-set changes are logged
    // even for packages with no environment metadata (tracking IS a
    // change worth answering for later). Best-effort: a log-write
    // failure must never fail the generation that triggered it.
    const beforeTracked = trackedNames(beforeState);
    const afterTracked = trackedNames(state);
    const trackedAdded = afterTracked.filter((n) => !beforeTracked.includes(n));
    const trackedRemoved = beforeTracked.filter((n) => !afterTracked.includes(n));
    const modelChanges = diffModels(before, model);
    const changes = modelChanges || trackedAdded.length > 0 || trackedRemoved.length > 0
        ? { ...(modelChanges || { packagesAdded: [], packagesRemoved: [], pathAdded: [], pathRemoved: [], variablesAdded: [], variablesRemoved: [], variablesChanged: [], pathOrderChanged: false }), trackedAdded, trackedRemoved }
        : null;
    if (changes) {
        try {
            recordTransaction(changes, { action });
        } catch (err) {
            logger.warn(`Environment Configuration Engine: could not write transaction log: ${err.message}`);
        }
    }

    return { state: loadEnvironmentState(), model, files, changes };
}

// regenerateEnvironment() -> rebuilds every supported shell's generated
// file from the CURRENT registry + tracked-package state, and
// (re)installs the shell hook. Always a full overwrite - never a
// partial edit - so there is never drift between what's on disk and
// what the registry says right now. A manually-edited generated file or
// hook block is backed up first and reported via files[].manualEditBackup,
// never silently destroyed.
export function regenerateEnvironment() {
    return applyState(loadEnvironmentState());
}

// registerPackageEnvironment(name, { discover }) -> tracks ANY
// successfully-installed registry package with observed facts (binary
// location/version/provider - the registry gives hints, discovery
// verifies reality), regenerating the shell files when its metadata
// contributes to them. Null only for a name the registry doesn't know.
// Idempotent per observed state: re-registering with nothing newly
// observed is a no-op.
export async function registerPackageEnvironment(name, { discover = discoverPackage } = {}) {
    let pkg;
    try {
        pkg = getPackage(name);
    } catch {
        return null;
    }

    const facts = await discover(pkg);
    const state = loadEnvironmentState();
    const updated = upsertPackage(state, name, facts);
    if (updated === state) return null;

    return applyState(updated, { action: `register:${name}` });
}

// unregisterPackageEnvironment(name) -> stops tracking a package (the
// uninstall path) and regenerates so its contributed lines disappear.
export function unregisterPackageEnvironment(name) {
    const state = loadEnvironmentState();
    const updated = removePackage(state, name);
    if (updated === state) return null;
    return applyState(updated, { action: `unregister:${name}` });
}

// reloadGuidance(model) -> honest post-regeneration advice. A child
// process (this CLI) cannot mutate an already-running parent shell's
// environment - no CLI can (the same documented constraint as
// core/workspace/shellIntegration.js) - so this DETECTS whether the
// current shell already has the generated PATH entries and says exactly
// what to run, rather than pretending to reload anything.
export function reloadGuidance(model, { envPath = process.env.PATH || "", home = homeDir() } = {}) {
    const literalEntries = model.path
        .filter((entry) => !entry.includes("$("))
        .map((entry) => entry.replace(/\$\{?HOME\}?/g, home));
    if (literalEntries.length === 0) return null;

    const current = envPath.split(":");
    const missing = literalEntries.filter((entry) => !current.includes(entry));
    if (missing.length === 0) return null;

    return {
        missing,
        message: "Your current shell hasn't loaded the latest environment. Run 'exec $SHELL' or open a new terminal."
    };
}

// getEnvironmentReport({ shell }) -> the full picture `env doctor`/
// `env list` render: tracked state (with per-package observed facts),
// the merged model, and validation results (PASS/WARNING/FAIL per
// check) against the real filesystem/shell state.
export async function getEnvironmentReport({ shell = getPlatform().defaultShell(), verify = true } = {}) {
    const state = loadEnvironmentState();
    const model = buildEnvironmentModel(state);
    const results = await validateEnvironment(model, { shell, state: verify ? state : undefined });
    return { state, model, results, shell };
}

// restoreEnvironment(id) -> restores a snapshot's tracked state and
// regenerates from it against the CURRENT registry (see snapshot.js on
// why stored bytes are never written back verbatim).
export function restoreEnvironment(id) {
    const { safetySnapshotId } = restoreEnvironmentSnapshot(id);
    const applied = regenerateEnvironment();
    return { ...applied, safetySnapshotId };
}

// registerEnvironmentEventHooks() - subscribes to the same plugin event
// bus (core/events.js) a third-party plugin would use, exactly the
// "Plugin Support: the environment engine handles everything
// automatically" requirement - this subsystem is just the bus's first,
// built-in subscriber, not a special case. Called once at CLI startup
// (cli/src/index.js), mirroring registerPluginEventHooks()'s exact
// pattern. A failure here is logged, never thrown - one broken
// environment merge must not fail the install that triggered it.
export function registerEnvironmentEventHooks() {
    pluginEvents.on("install.afterInstall", ({ name, status }) => {
        if (status !== "installed") return;
        registerPackageEnvironment(name).catch((err) => {
            logger.warn(`Environment Configuration Engine: failed to register environment for '${name}': ${err.message}`);
        });
    });
}

// Re-exported for the `env` command's version-aware listing.
export function describeTrackedPackages(state) {
    return trackedNames(state).map((name) => ({ name, ...state.packages[name] }));
}
