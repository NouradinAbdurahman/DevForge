// The Plugin SDK command surface (see docs/PlatformArchitecture.md's
// Plugin API section). `list`/`info`/`run` inspect discovered plugins;
// `create`/`test`/`build`/`package`/`publish`/`install`/`trust`/`keygen`
// are the full local lifecycle - the sequence a plugin author actually
// runs, matching the product brief's example verbatim.
import path from "node:path";
import { discoverPlugins } from "../core/plugins.js";
import { runShellCommand } from "../core/shell.js";
import {
    createPlugin, testPlugin, buildPlugin, packagePlugin,
    publishPlugin, installPlugin
} from "../core/pluginSdk.js";
import { ensureSigningKey, trustKey } from "../core/signing.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";

export function registerPluginCommand(program) {
    const plugin = program
        .command("plugin")
        .description("The Plugin SDK - discover, run, and build DevForgeKit plugins");

    plugin
        .command("list")
        .description("List every discovered plugin, including invalid/incompatible ones")
        .action(withErrorHandling(async () => {
            const plugins = discoverPlugins();
            if (plugins.length === 0) {
                logger.info("No plugins found.");
                return;
            }
            logger.section("DevForgeKit Plugins");
            for (const p of plugins) {
                if (p.valid) {
                    const commands = (p.manifest.commands || []).map((c) => c.name).join(", ") || "none";
                    console.log(`  ${p.name}@${p.manifest.version} - ${p.manifest.description} (commands: ${commands})`);
                } else {
                    console.log(`  ${p.name} - INVALID (${p.reason})`);
                }
            }
        }));

    plugin
        .command("info <name>")
        .description("Show the full manifest for one plugin")
        .action(withErrorHandling(async (name) => {
            const found = discoverPlugins().find((p) => p.name === name);
            if (!found) {
                throw usageError(`Unknown plugin '${name}'. Run 'devforgekit plugin list' to see available plugins.`);
            }
            console.log(JSON.stringify(found.manifest, null, 2));
            if (!found.valid) {
                logger.warn(found.reason);
            }
        }));

    plugin
        .command("run <name> [command]")
        .description("Run one of a plugin's registered commands directly")
        .action(withErrorHandling(async (name, commandName) => {
            const found = discoverPlugins().find((p) => p.name === name);
            if (!found) {
                throw usageError(`Unknown plugin '${name}'. Run 'devforgekit plugin list' to see available plugins.`);
            }
            if (!found.valid) {
                throw usageError(`Plugin '${name}' cannot run: ${found.reason}`);
            }
            const commands = found.manifest.commands || [];
            let hook;
            if (commandName) {
                hook = commands.find((c) => c.name === commandName);
                if (!hook) {
                    throw usageError(`Plugin '${name}' has no command '${commandName}'. Available: ${commands.map((c) => c.name).join(", ") || "none"}`);
                }
            } else if (commands.length === 1) {
                hook = commands[0];
            } else if (commands.length === 0) {
                throw usageError(`Plugin '${name}' has no commands to run.`);
            } else {
                throw usageError(`Plugin '${name}' has multiple commands - specify one: ${commands.map((c) => c.name).join(", ")}`);
            }
            const code = await runShellCommand(path.join(found.dir, hook.run), { timeoutMs: hook.timeoutMs || 30000 });
            process.exitCode = code;
        }));

    plugin
        .command("create <name> [dir]")
        .description("Scaffold a new plugin project (plugin.yml, commands/, hooks/, tests/, README.md)")
        .action(withErrorHandling(async (name, dir) => {
            const pluginDir = createPlugin(name, dir || process.cwd());
            logger.success(`Created plugin '${name}' at ${pluginDir}`);
            logger.info(`Next: cd ${path.relative(process.cwd(), pluginDir) || "."} && devforgekit plugin test .`);
        }));

    plugin
        .command("test [dir]")
        .description("Validate a plugin's manifest and run its tests/*.sh")
        .action(withErrorHandling(async (dir) => {
            const { results, score, verdict } = await testPlugin(dir || process.cwd());
            logger.section("Plugin Test Results");
            for (const r of results) {
                if (r.status === "PASS") logger.success(r.description);
                else logger.error(r.description);
            }
            logger.info(`Score: ${score}% - ${verdict}`);
            if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
        }));

    plugin
        .command("build [dir]")
        .description("Validate, regenerate README.md, and write plugin.lock.json")
        .action(withErrorHandling(async (dir) => {
            const { manifest, lock } = await buildPlugin(dir || process.cwd());
            logger.success(`Built ${manifest.name}@${manifest.version} - ${Object.keys(lock.files).length} files locked`);
        }));

    plugin
        .command("package [dir]")
        .description("Package a plugin into a signed, checksummed .tar.gz")
        .option("--out <dir>", "output directory (default: the plugin directory's parent)")
        .action(withErrorHandling(async function (dir) {
            const opts = this.opts();
            const pluginDir = dir || process.cwd();
            // Must not default --out to pluginDir itself: packagePlugin tars
            // the plugin directory, and writing the archive inside the very
            // directory being archived makes tar fail (or, worse, race and
            // sometimes succeed writing the archive into itself) - see
            // packagePlugin's own doc comment in core/pluginSdk.js.
            const { archivePath, checksum } = await packagePlugin(pluginDir, opts.out);
            logger.success(`Packaged ${archivePath}`);
            logger.info(`SHA-256: ${checksum}`);
        }));

    plugin
        .command("publish <archive>")
        .description("Stage a packaged plugin (+ checksum/signature) to a local or shared directory")
        .option("--to <dir>", "destination directory (default: ~/.devforgekit/published-plugins)")
        .action(withErrorHandling(async function (archive) {
            const opts = this.opts();
            const { destArchive, indexPath } = publishPlugin(archive, opts.to);
            logger.success(`Published to ${destArchive}`);
            logger.info(`Index updated: ${indexPath}`);
            logger.info("Note: this stages the artifact locally - there is no hosted marketplace yet (see docs/PlatformArchitecture.md).");
        }));

    plugin
        .command("install <pathOrUrl>")
        .description("Install a plugin from a local .tar.gz or an http(s) URL")
        .option("-y, --yes", "skip the unsigned/untrusted-signature confirmation prompt")
        .action(withErrorHandling(async function (pathOrUrl) {
            const opts = this.opts();
            const { installedDir, manifest } = await installPlugin(pathOrUrl, { assumeYes: opts.yes });
            logger.success(`Installed ${manifest.name}@${manifest.version} to ${installedDir}`);
        }));

    plugin
        .command("trust <pubkey>")
        .description("Add a third-party public key to this machine's trusted-signers set")
        .action(withErrorHandling(async (pubkey) => {
            const dest = trustKey(pubkey);
            logger.success(`Trusted key added: ${dest}`);
        }));

    plugin
        .command("keygen")
        .description("(Re-)generate this machine's local plugin-signing keypair")
        .action(withErrorHandling(async () => {
            const { publicKeyPem } = ensureSigningKey();
            logger.success("Signing key ready at ~/.config/devforgekit/plugin-signing-key{,.pub}");
            console.log(publicKeyPem);
        }));
}
