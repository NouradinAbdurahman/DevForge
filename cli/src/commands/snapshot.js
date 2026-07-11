// Environment Snapshot & Restore command (v1.3.2). One-command capture
// and restore of the entire development environment. See
// core/snapshot.js for the engine.
import path from "node:path";
import {
    createSnapshot,
    restoreSnapshot,
    listSnapshots,
    inspectSnapshot,
    verifySnapshot,
    diffSnapshots,
    deleteSnapshot,
    exportSnapshot,
    explainSnapshot,
    formatBytes
} from "../core/snapshot.js";
import { table, section } from "../lib/ui.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";
import chalk from "chalk";

export function registerSnapshotCommand(program) {
    const snapshot = program
        .command("snapshot")
        .description("Environment Snapshot & Restore - capture, restore, inspect, and diff portable .dfk archives")
        .alias("snap");

    // ─── create ──────────────────────────────────────────────────────
    snapshot
        .command("create")
        .description("Capture the current development environment into a portable .dfk archive")
        .option("-o, --output <dir>", "output directory (default: ~/.devforgekit/snapshots/)")
        .option("-c, --compression <level>", "compression level: fast, normal, max", "normal")
        .option("--skip-inventory", "skip copying inventory reports")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const result = await createSnapshot({
                output: opts.output ? path.resolve(opts.output) : undefined,
                compression: opts.compression,
                skipInventory: opts.skipInventory
            });
        }));

    // ─── restore ─────────────────────────────────────────────────────
    snapshot
        .command("restore <archive>")
        .description("Restore an environment from a .dfk archive")
        .option("--skip-packages", "skip installing packages")
        .option("--skip-workspaces", "skip importing workspaces")
        .option("--skip-config", "skip restoring configuration")
        .option("--skip-compatibility", "skip compatibility checks")
        .option("--force", "overwrite existing workspaces and ignore warnings")
        .action(withErrorHandling(async function (archive) {
            const opts = this.opts();
            const result = await restoreSnapshot(path.resolve(archive), {
                skipPackages: opts.skipPackages,
                skipWorkspaces: opts.skipWorkspaces,
                skipConfig: opts.skipConfig,
                skipCompatibility: opts.skipCompatibility,
                force: opts.force
            });
            if (!result.ok) {
                process.exitCode = 1;
            }
        }));

    // ─── list ────────────────────────────────────────────────────────
    snapshot
        .command("list")
        .description("List available environment snapshots")
        .action(withErrorHandling(() => {
            const snapshots = listSnapshots();
            if (snapshots.length === 0) {
                logger.info("No snapshots found. Run 'devforgekit snapshot create' to create one.");
                return;
            }

            console.log(section(`Environment Snapshots (${snapshots.length})`, [
                table(
                    snapshots.map((s) => ({
                        id: s.id,
                        machine: s.machine,
                        created: s.createdAt ? s.createdAt.slice(0, 19).replace("T", " ") : "unknown",
                        size: formatBytes(s.size)
                    })),
                    [
                        { key: "id", label: "ID", maxWidth: 32 },
                        { key: "machine", label: "MACHINE", maxWidth: 20 },
                        { key: "created", label: "CREATED" },
                        { key: "size", label: "SIZE" }
                    ]
                )
            ]));
            logger.info("Next: devforgekit snapshot inspect <archive>, or devforgekit snapshot restore <archive>");
        }));

    // ─── inspect ─────────────────────────────────────────────────────
    snapshot
        .command("inspect <archive>")
        .description("Display detailed information about a snapshot")
        .action(withErrorHandling(async (archive) => {
            const result = await inspectSnapshot(path.resolve(archive));
            const { meta, archiveSize } = result;

            logger.section("Snapshot Inspection");
            console.log(`\n  ID:                ${meta.id || "unknown"}`);
            console.log(`  Created:           ${meta.createdAt || "unknown"}`);
            console.log(`  Creator:           ${meta.creator || "unknown"}`);
            console.log(`  DevForgeKit:       ${meta.devforgekitVersion || "unknown"}`);
            console.log(`  Git commit:        ${meta.gitCommit || "unknown"}`);
            console.log(`  Archive size:      ${formatBytes(archiveSize)}`);
            console.log(`  Snapshot version:  v${meta.snapshotVersion}`);

            console.log("\n  Machine:");
            if (meta.machine) {
                console.log(`    Name:        ${meta.machine.name}`);
                console.log(`    Hostname:    ${meta.machine.hostname}`);
                console.log(`    OS:          ${meta.machine.os}`);
                console.log(`    Arch:        ${meta.machine.arch}`);
                console.log(`    CPU:         ${meta.machine.cpu}`);
                console.log(`    Memory:      ${meta.machine.memoryGb} GB`);
                console.log(`    Disk:        ${meta.machine.disk?.usedGb}/${meta.machine.disk?.totalGb} GB (${meta.machine.disk?.usedPercent}% used)`);
            }

            console.log("\n  Components:");
            console.log(`    Packages:    ${meta.components?.packages?.length || 0}`);
            if (meta.components?.packages?.length > 0) {
                console.log(`      ${meta.components.packages.join(", ")}`);
            }
            console.log(`    Collections: ${meta.components?.collections?.length || 0}`);
            console.log(`    Profiles:    ${meta.components?.profiles?.length || 0}`);
            if (meta.components?.profiles?.length > 0) {
                console.log(`      ${meta.components.profiles.join(", ")}`);
            }
            console.log(`    Recipes:     ${meta.components?.recipes?.length || 0}`);
            if (meta.components?.recipes?.length > 0) {
                console.log(`      ${meta.components.recipes.join(", ")}`);
            }
            console.log(`    Plugins:     ${meta.components?.plugins?.length || 0}`);

            console.log(`\n  Workspaces:        ${meta.workspaces?.length || 0}`);
            if (meta.workspaces?.length > 0) {
                console.log(`    ${meta.workspaces.join(", ")}`);
            }

            console.log(`\n  Themes:`);
            console.log(`    Current:     ${meta.themes?.current || "default"}`);
            console.log(`    Custom:      ${meta.themes?.custom?.length || 0}`);

            if (meta.health) {
                console.log(`\n  Health Score:      ${meta.health.score}% - ${meta.health.verdict}`);
            }
            if (meta.compatibility) {
                console.log(`  Compatibility:     ${meta.compatibility.score}% - ${meta.compatibility.verdict}`);
            }

            if (meta.missingSecrets?.length > 0) {
                console.log(`\n  Missing Secrets:   ${meta.missingSecrets.length}`);
                for (const key of meta.missingSecrets) {
                    console.log(`    ${key}`);
                }
            }
        }));

    // ─── verify ──────────────────────────────────────────────────────
    snapshot
        .command("verify <archive>")
        .description("Verify archive integrity, checksums, and compatibility")
        .action(withErrorHandling(async (archive) => {
            const result = await verifySnapshot(path.resolve(archive));
            if (result.health.score < 70) {
                process.exitCode = 1;
            }
        }));

    // ─── diff ────────────────────────────────────────────────────────
    snapshot
        .command("diff <old> <new>")
        .description("Compare two snapshots and show differences")
        .action(withErrorHandling(async (oldArchive, newArchive) => {
            const diff = await diffSnapshots(path.resolve(oldArchive), path.resolve(newArchive));

            console.log(section("Snapshot Diff", [
                `Old: ${diff.createdAt.old} (${diff.machine.old?.hostname || "unknown"})`,
                `New: ${diff.createdAt.new} (${diff.machine.new?.hostname || "unknown"})`,
                `DevForgeKit: ${diff.devforgekitVersion.old} → ${diff.devforgekitVersion.new}`
            ]));

            function printDiff(label, d) {
                if (d.added.length === 0 && d.removed.length === 0) return;
                console.log(`\n  ${chalk.bold(label)}:`);
                for (const item of d.added) console.log(`    ${chalk.green(`+ ${item}`)}`);
                for (const item of d.removed) console.log(`    ${chalk.red(`- ${item}`)}`);
            }

            printDiff("Packages", diff.packages);
            printDiff("Collections", diff.collections);
            printDiff("Profiles", diff.profiles);
            printDiff("Recipes", diff.recipes);
            printDiff("Plugins", diff.plugins);
            printDiff("Workspaces", diff.workspaces);
            printDiff("Custom Themes", diff.themes.custom);

            if (diff.themes.current) {
                console.log(`\n  Theme: ${diff.themes.current}`);
            }

            if (diff.config.changed.length > 0 || diff.config.added.length > 0 || diff.config.removed.length > 0) {
                console.log("\n  Configuration:");
                for (const c of diff.config.added) console.log(`    + ${c.key} = ${c.value}`);
                for (const c of diff.config.removed) console.log(`    - ${c.key} = ${c.value}`);
                for (const c of diff.config.changed) console.log(`    ~ ${c.key}: ${c.oldValue} → ${c.newValue}`);
            }

            if (diff.health.delta !== null) {
                const sign = diff.health.delta > 0 ? "+" : "";
                console.log(`\n  Health Score: ${diff.health.old}% → ${diff.health.new}% (${sign}${diff.health.delta})`);
            }
            if (diff.compatibility.delta !== null) {
                const sign = diff.compatibility.delta > 0 ? "+" : "";
                console.log(`  Compatibility: ${diff.compatibility.old}% → ${diff.compatibility.new}% (${sign}${diff.compatibility.delta})`);
            }
        }));

    // ─── export ──────────────────────────────────────────────────────
    snapshot
        .command("export <id> <destDir>")
        .description("Copy a snapshot to another directory")
        .action(withErrorHandling((id, destDir) => {
            const dest = exportSnapshot(id, path.resolve(destDir));
            logger.success(`Exported to ${dest}`);
        }));

    // ─── delete ──────────────────────────────────────────────────────
    snapshot
        .command("delete <id>")
        .description("Delete a snapshot")
        .action(withErrorHandling((id) => {
            const deleted = deleteSnapshot(id);
            logger.success(`Deleted ${deleted}`);
        }));

    // ─── explain ─────────────────────────────────────────────────────
    snapshot
        .command("explain <archive>")
        .description("AI-powered explanation of a snapshot (requires AI provider)")
        .option("--provider <id>", "AI provider to use")
        .option("--model <model>", "model override")
        .option("--endpoint <url>", "custom API endpoint")
        .action(withErrorHandling(async function (archive) {
            const opts = this.opts();
            const result = await explainSnapshot(path.resolve(archive), {
                provider: opts.provider,
                model: opts.model,
                endpoint: opts.endpoint
            });
            if (!result.ok) {
                logger.error(result.error);
                process.exitCode = 1;
                return;
            }
            console.log(result.explanation);
        }));
}
