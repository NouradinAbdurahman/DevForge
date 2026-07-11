// The Plugin SDK command surface (see docs/PlatformArchitecture.md's
// Plugin API section). `list`/`info`/`run` inspect discovered plugins;
// `create`/`test`/`build`/`package`/`publish`/`install`/`trust`/`keygen`
// are the full local lifecycle - the sequence a plugin author actually
// runs, matching the product brief's example verbatim.
import path from "node:path";
import { existsSync } from "node:fs";
import { discoverPlugins } from "../core/plugins.js";
import { runShellCommand } from "../core/shell.js";
import {
    createPlugin, testPlugin, buildPlugin, packagePlugin,
    publishPlugin, installPlugin
} from "../core/pluginSdk.js";
import {
    validatePluginDir, validateAllPlugins, formatValidationResult,
    scorePlugin, formatQualityScore,
    diagnosePlugins, formatDiagnostics
} from "../core/pluginValidation.js";
import { ensureSigningKey, trustKey } from "../core/signing.js";
import { table, section } from "../lib/ui.js";
import { didYouMeanMessage } from "../lib/suggest.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";
import chalk from "chalk";

function unknownPluginError(name) {
    const suggestion = didYouMeanMessage(name, discoverPlugins().map((p) => p.name));
    return usageError(`Unknown plugin '${name}'.${suggestion ? ` ${suggestion}` : ""} Run 'devforgekit plugin list' to see available plugins.`);
}

export function registerPluginCommand(program) {
    const plugin = program
        .command("plugin")
        .description("The Plugin SDK - discover, run, and build DevForgeKit plugins");

    plugin
        .command("list")
        .description("List every discovered plugin, including invalid/incompatible ones")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const plugins = discoverPlugins();
            if (this.opts().json) {
                console.log(JSON.stringify(plugins, null, 2));
                return;
            }
            if (plugins.length === 0) {
                logger.info("No plugins found.");
                return;
            }
            const rows = plugins.map((p) => p.valid
                ? {
                    name: p.name,
                    version: p.manifest.version,
                    status: chalk.green("valid"),
                    commands: (p.manifest.commands || []).map((c) => c.name).join(", ") || "none"
                }
                : {
                    name: p.name,
                    version: "-",
                    status: chalk.red(`invalid (${p.reason})`),
                    commands: "-"
                });
            console.log(section(`DevForgeKit Plugins (${plugins.length})`, [
                table(rows, [
                    { key: "name", label: "NAME" },
                    { key: "version", label: "VERSION" },
                    { key: "status", label: "STATUS", maxWidth: 45 },
                    { key: "commands", label: "COMMANDS", maxWidth: 30 }
                ])
            ]));
            logger.info("Next: devforgekit plugin info <name>, or devforgekit plugin run <name>");
        }));

    plugin
        .command("info <name>")
        .description("Show the full manifest for one plugin")
        .action(withErrorHandling(async (name) => {
            const found = discoverPlugins().find((p) => p.name === name);
            if (!found) {
                throw unknownPluginError(name);
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
                throw unknownPluginError(name);
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
        .option("-t, --template <template>", "template to use (simple-command, tui-page, generator, benchmark, repair, graph-extension, ai-provider, compatibility-rule)", "simple-command")
        .action(withErrorHandling(async function (name, dir) {
            const opts = this.opts();
            const pluginDir = createPlugin(name, dir || process.cwd(), { template: opts.template });
            logger.success(`Created plugin '${name}' at ${pluginDir} (template: ${opts.template})`);
            logger.info(`Next: cd ${path.relative(process.cwd(), pluginDir) || "."} && devforgekit plugin test .`);
        }));

    plugin
        .command("test [dir]")
        .description("Validate a plugin's manifest and run its tests/*.sh")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (dir) {
            const result = await testPlugin(dir || process.cwd());
            if (this.opts().json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            logger.section("Plugin Test Results");
            for (const r of result.results) {
                if (r.status === "PASS") logger.success(r.description);
                else logger.error(r.description);
            }
            logger.info(`Score: ${result.score}% - ${result.verdict}`);
            if (result.results.some((r) => r.status === "FAIL")) process.exitCode = 1;
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
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (dir) {
            const opts = this.opts();
            const pluginDir = dir || process.cwd();
            const { archivePath, checksum, signaturePath, manifest, lock } = await packagePlugin(pluginDir, opts.out);
            if (opts.json) {
                const statSync = (await import("node:fs")).statSync;
                const sizeBytes = statSync(archivePath).size;
                console.log(JSON.stringify({
                    archivePath, checksum, signaturePath,
                    name: manifest.name, version: manifest.version,
                    sizeBytes, fileCount: Object.keys(lock.files).length,
                    engine: manifest.engine,
                }, null, 2));
                return;
            }
            logger.success(`Packaged ${archivePath}`);
            const statSync = (await import("node:fs")).statSync;
            const sizeKB = Math.round(statSync(archivePath).size / 1024 * 10) / 10;
            logger.info(`SHA-256: ${checksum}`);
            logger.info(`Size: ${sizeKB} KB (${Object.keys(lock.files).length} files)`);
            logger.info(`Signature: ${signaturePath}`);
            logger.info(`Engine: ${manifest.engine}`);
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
        .command("validate [dir]")
        .description("Validate a plugin's manifest, scripts, and structure")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (dir) {
            const result = validatePluginDir(dir || process.cwd());
            if (this.opts().json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            for (const line of formatValidationResult(result)) console.log(line);
            if (!result.valid) process.exitCode = 1;
        }));

    plugin
        .command("quality [name|dir]")
        .description("Score a plugin's quality across multiple categories")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (nameOrDir) {
            const arg = nameOrDir || process.cwd();
            let dir = arg;
            // If it's a plugin name, resolve to its directory
            if (!existsSync(arg)) {
                const found = discoverPlugins().find((p) => p.name === arg);
                if (!found) {
                    const suggestion = didYouMeanMessage(arg, discoverPlugins().map((p) => p.name));
                    throw usageError(`Unknown plugin '${arg}' or directory not found.${suggestion ? ` ${suggestion}` : ""}`);
                }
                dir = found.dir;
            }
            const result = scorePlugin(dir);
            if (this.opts().json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            for (const line of formatQualityScore(result)) console.log(line);
        }));

    plugin
        .command("doctor")
        .description("Diagnose all discovered plugins for common issues")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const result = diagnosePlugins();
            if (this.opts().json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            for (const line of formatDiagnostics(result)) console.log(line);
            if (result.summary.errors > 0) process.exitCode = 1;
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
