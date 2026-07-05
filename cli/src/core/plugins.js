// Discovers plugins/*/plugin.yml, validates each against
// cli/src/schemas/plugin.schema.json, checks `engine` compatibility
// against the repo's VERSION, and registers any declared command/event
// hook (see docs/PlatformArchitecture.md section 4 - the Plugin SDK).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import Ajv2020 from "ajv/dist/2020.js";
import semver from "semver";
import { fileURLToPath } from "node:url";
import { repoRoot, userStateDir } from "./paths.js";
import { runShellCommand } from "./shell.js";
import { pluginEvents } from "./events.js";
import { getVersion } from "../version.js";
import { logger } from "./logger.js";

// See core/registry.js for why this needs the draft-2020-12 Ajv build.
const ajv = new Ajv2020({ allErrors: true });
const schemaPath = fileURLToPath(new URL("../schemas/plugin.schema.json", import.meta.url));
const compiledPluginSchema = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")));

// validatePluginManifest(manifest) -> { valid, reason? } - the one place
// that runs ajv + the "must declare at least one of commands/events"
// semantic check (mirroring registry/profiles' "at least one of
// collections/components" pattern). Shared by discoverPlugins() below
// and core/pluginSdk.js's testPlugin()/installPlugin(), so there is
// exactly one definition of "valid plugin manifest."
export function validatePluginManifest(manifest) {
    if (!compiledPluginSchema(manifest)) {
        const reason = (compiledPluginSchema.errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
        return { valid: false, reason: `Invalid manifest: ${reason}` };
    }
    if ((!manifest.commands || manifest.commands.length === 0) && (!manifest.events || manifest.events.length === 0) && !manifest.rules) {
        return { valid: false, reason: "must declare at least one of 'commands', 'events', or 'rules'" };
    }
    return { valid: true };
}

// Discovery roots, in order: this repo's bundled examples, then
// ~/.devforgekit/plugins (core/pluginSdk.js's installPlugin() destination
// - the same multi-root pattern core/registry.js's loadProfiles() already
// uses for user-created profiles).
function discoveryRoots() {
    return [
        path.join(repoRoot(), "plugins"),
        path.join(userStateDir(), "plugins")
    ];
}

// discoverPlugins([roots]) -> [{ name, dir, manifest, valid, reason? }]
// Never throws: an invalid or incompatible plugin is reported per-plugin
// (valid: false, reason) rather than aborting discovery for every plugin.
// `roots` defaults to this repo's plugins/ directory - overridable so
// tests can point at fixtures without touching the real plugins/ dir.
export function discoverPlugins(roots = discoveryRoots()) {
    const results = [];
    const version = getVersion();

    for (const root of roots) {
        let entries;
        try {
            entries = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
        } catch {
            continue;
        }

        for (const entry of entries) {
            const dir = path.join(root, entry.name);
            const manifestPath = path.join(dir, "plugin.yml");
            if (!existsSync(manifestPath)) continue;

            let manifest;
            try {
                manifest = yaml.load(readFileSync(manifestPath, "utf8"));
            } catch (err) {
                results.push({ name: entry.name, dir, manifest: null, valid: false, reason: `Failed to parse plugin.yml: ${err.message}` });
                continue;
            }

            const validation = validatePluginManifest(manifest);
            if (!validation.valid) {
                results.push({ name: entry.name, dir, manifest, valid: false, reason: validation.reason });
                continue;
            }

            if (!semver.satisfies(version, manifest.engine, { includePrerelease: true })) {
                results.push({ name: manifest.name, dir, manifest, valid: false, reason: `Requires DevForgeKit ${manifest.engine}, but this is ${version}` });
                continue;
            }

            results.push({ name: manifest.name, dir, manifest, valid: true });
        }
    }

    return results;
}

const DEFAULT_HOOK_TIMEOUT_MS = 30000;

// registerPluginCommands(program) - adds one commander subcommand per
// valid plugin's `commands[]` entries, running the referenced script
// with inherited stdio under a timeout (the "sandbox" - real resource/
// time isolation, not a security boundary; see core/shell.js). Invalid/
// incompatible plugins are skipped with a warning, never a crash.
// Two plugins (or a plugin and a built-in command) can legitimately
// declare the same command name - commander throws on a duplicate
// `.command()` registration, which would otherwise crash the entire CLI
// at startup over one plugin's naming choice. Checked and skipped (with
// a warning) instead, same "one bad plugin never takes down the CLI"
// policy already applied to invalid manifests and event hooks below.
// `plugin run <name> <command>` still reaches every command directly by
// plugin name, so a shadowed command is never truly unreachable.
export function registerPluginCommands(program) {
    for (const plugin of discoverPlugins()) {
        if (!plugin.valid) {
            logger.debug(`Skipping plugin '${plugin.name}': ${plugin.reason}`);
            continue;
        }
        for (const hook of plugin.manifest.commands || []) {
            if (program.commands.some((c) => c.name() === hook.name)) {
                logger.warn(`Plugin '${plugin.name}': command '${hook.name}' is already registered - skipping (run it directly with 'plugin run ${plugin.name} ${hook.name}')`);
                continue;
            }
            program
                .command(hook.name)
                .description(hook.description || `${plugin.manifest.description} (plugin: ${plugin.name})`)
                .action(async () => {
                    const runPath = path.join(plugin.dir, hook.run);
                    const code = await runShellCommand(runPath, { timeoutMs: hook.timeoutMs || DEFAULT_HOOK_TIMEOUT_MS });
                    process.exitCode = code;
                });
        }
    }
}

// registerPluginEventHooks() - subscribes every valid plugin's `events[]`
// entries to the shared pluginEvents bus (core/events.js). A hook
// script's failure is logged as a warning, never thrown - one broken
// plugin hook must not take down whatever core operation triggered the
// event.
export function registerPluginEventHooks() {
    for (const plugin of discoverPlugins()) {
        if (!plugin.valid) continue;
        for (const hook of plugin.manifest.events || []) {
            pluginEvents.on(hook.event, async (payload) => {
                const runPath = path.join(plugin.dir, hook.run);
                try {
                    const code = await runShellCommand(runPath, {
                        silent: true,
                        timeoutMs: hook.timeoutMs || DEFAULT_HOOK_TIMEOUT_MS,
                        env: { DEVFORGEKIT_EVENT_PAYLOAD: JSON.stringify(payload || {}) }
                    });
                    if (code !== 0) {
                        logger.warn(`Plugin '${plugin.name}' event hook for '${hook.event}' exited ${code}`);
                    }
                } catch (err) {
                    logger.warn(`Plugin '${plugin.name}' event hook for '${hook.event}' failed: ${err.message}`);
                }
            });
        }
    }
}
