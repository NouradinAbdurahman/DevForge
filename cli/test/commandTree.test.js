import { test } from "node:test";
import assert from "node:assert/strict";
import { Command } from "commander";
import {
    getCommandTree,
    searchCommandTree,
    findRelatedCommands,
    getAvailableDocs
} from "../src/core/commandTree.js";

// Helper: build a fake program with a few commands for testing
function makeFakeProgram() {
    const program = new Command();
    program.name("devforgekit").description("DevForgeKit CLI");

    // Simple command with no options
    program
        .command("check")
        .description("Fast PASS/WARNING/FAIL health check");

    // Command with aliases and options
    program
        .command("doctor")
        .description("Deep diagnostics and repair")
        .alias("fix")
        .alias("heal")
        .option("--fix", "automatically fix issues")
        .option("--verbose", "print extra detail");

    // Command with subcommands
    const snapshot = program
        .command("snapshot")
        .description("Environment Snapshot & Restore")
        .alias("snap");
    snapshot
        .command("create")
        .description("Create a new snapshot");
    snapshot
        .command("restore")
        .description("Restore from a snapshot")
        .option("-f, --force", "force restore");

    // Command with arguments
    program
        .command("install [name]")
        .description("Full provision or install a single component")
        .option("--profile <name>", "install a named profile")
        .option("--minimal", "minimal installation");

    // Plugin command (no aliases, no options)
    program
        .command("plugin")
        .description("Manage DevForgeKit plugins");

    return program;
}

// ─── getCommandTree ───────────────────────────────────────────────────

test("getCommandTree returns all commands from the program", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);

    assert.equal(tree.total, 5);
    const names = tree.commands.map((c) => c.name);
    assert.ok(names.includes("check"));
    assert.ok(names.includes("doctor"));
    assert.ok(names.includes("snapshot"));
    assert.ok(names.includes("install"));
    assert.ok(names.includes("plugin"));
});

test("getCommandTree groups commands by category", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);

    assert.ok(tree.categories["Core"]);
    assert.ok(tree.categories["Workspace"]);
    assert.ok(tree.categories["Plugins"]);
});

test("getCommandTree extracts aliases correctly", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);

    const doctor = tree.commands.find((c) => c.name === "doctor");
    assert.deepEqual(doctor.aliases, ["fix", "heal"]);
});

test("getCommandTree extracts options correctly", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);

    const doctor = tree.commands.find((c) => c.name === "doctor");
    assert.equal(doctor.options.length, 2);
    assert.ok(doctor.options.some((o) => o.long === "--fix"));
    assert.ok(doctor.options.some((o) => o.long === "--verbose"));
});

test("getCommandTree filters out --help option", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);

    for (const cmd of tree.commands) {
        assert.ok(!cmd.options.some((o) => o.long === "--help"));
    }
});

test("getCommandTree extracts subcommands correctly", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);

    const snapshot = tree.commands.find((c) => c.name === "snapshot");
    assert.equal(snapshot.subcommands.length, 2);
    assert.ok(snapshot.subcommands.some((s) => s.name === "create"));
    assert.ok(snapshot.subcommands.some((s) => s.name === "restore"));
});

test("getCommandTree filters out implicit help subcommand", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);

    const snapshot = tree.commands.find((c) => c.name === "snapshot");
    assert.ok(!snapshot.subcommands.some((s) => s.name === "help"));
});

test("getCommandTree builds usage string with arguments", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);

    const install = tree.commands.find((c) => c.name === "install");
    assert.ok(install.usage.includes("install"));
    assert.ok(install.usage.includes("[options]"));
});

test("getCommandTree builds syntax string from options", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);

    const install = tree.commands.find((c) => c.name === "install");
    assert.ok(install.syntax.includes("--profile"));
    assert.ok(install.syntax.includes("--minimal"));
});

test("getCommandTree handles commands with no aliases", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);

    const plugin = tree.commands.find((c) => c.name === "plugin");
    assert.deepEqual(plugin.aliases, []);
});

test("getCommandTree handles commands with no options", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);

    const check = tree.commands.find((c) => c.name === "check");
    assert.equal(check.options.length, 0);
});

test("getCommandTree handles commands with no subcommands", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);

    const check = tree.commands.find((c) => c.name === "check");
    assert.equal(check.subcommands.length, 0);
});

test("getCommandTree sorts commands by category then name", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);

    // Core category should come before Workspace
    const coreIdx = tree.commands.findIndex((c) => c.category === "Core");
    const wsIdx = tree.commands.findIndex((c) => c.category === "Workspace");
    assert.ok(coreIdx < wsIdx);
});

test("getCommandTree returns empty for program with no commands", () => {
    const program = new Command();
    const tree = getCommandTree(program);
    assert.equal(tree.total, 0);
    assert.deepEqual(tree.commands, []);
});

test("getCommandTree assigns 'Other' category to unknown commands", () => {
    const program = new Command();
    program.command("unknown-cmd").description("An unknown command");
    const tree = getCommandTree(program);

    const cmd = tree.commands.find((c) => c.name === "unknown-cmd");
    assert.equal(cmd.category, "Other");
});

test("getCommandTree with real createProgram finds all registered commands", async () => {
    const { createProgram } = await import("../src/index.js");
    const tree = getCommandTree(createProgram());

    // Should find a substantial number of commands
    assert.ok(tree.total > 20, `Expected >20 commands, got ${tree.total}`);

    // Should include known commands
    const names = tree.commands.map((c) => c.name);
    assert.ok(names.includes("install"));
    assert.ok(names.includes("doctor"));
    assert.ok(names.includes("graph"));
    assert.ok(names.includes("package"));
    assert.ok(names.includes("repair"));
    assert.ok(names.includes("benchmark"));
    assert.ok(names.includes("snapshot"));
});

test("adding a fake command during tests automatically appears in tree", () => {
    const program = makeFakeProgram();
    const tree1 = getCommandTree(program);
    assert.equal(tree1.total, 5);

    // Add a new command
    program.command("new-feature").description("A newly added command");
    const tree2 = getCommandTree(program);
    assert.equal(tree2.total, 6);
    assert.ok(tree2.commands.some((c) => c.name === "new-feature"));
});

// ─── searchCommandTree ────────────────────────────────────────────────

test("searchCommandTree finds by name", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);
    const results = searchCommandTree(tree, "doctor");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "doctor");
});

test("searchCommandTree finds by alias", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);
    const results = searchCommandTree(tree, "fix");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "doctor");
});

test("searchCommandTree finds by description", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);
    const results = searchCommandTree(tree, "health");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "check");
});

test("searchCommandTree finds by option flags", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);
    const results = searchCommandTree(tree, "verbose");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "doctor");
});

test("searchCommandTree finds by option description", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);
    const results = searchCommandTree(tree, "automatically");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "doctor");
});

test("searchCommandTree finds by subcommand name", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);
    const results = searchCommandTree(tree, "restore");
    // Should find snapshot (which has a restore subcommand)
    assert.ok(results.some((r) => r.name === "snapshot"));
});

test("searchCommandTree finds by subcommand description", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);
    const results = searchCommandTree(tree, "Create a new");
    assert.ok(results.some((r) => r.name === "snapshot"));
});

test("searchCommandTree finds by category", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);
    const results = searchCommandTree(tree, "Core");
    assert.ok(results.length > 0);
    assert.ok(results.every((r) => r.category === "Core"));
});

test("searchCommandTree returns all for empty query", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);
    const results = searchCommandTree(tree, "");
    assert.equal(results.length, tree.total);
});

test("searchCommandTree returns empty for no matches", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);
    const results = searchCommandTree(tree, "nonexistent-xyz");
    assert.equal(results.length, 0);
});

test("searchCommandTree is case-insensitive", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);
    const results = searchCommandTree(tree, "DOCTOR");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "doctor");
});

// ─── findRelatedCommands ──────────────────────────────────────────────

test("findRelatedCommands returns same-category commands", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);

    const doctor = tree.commands.find((c) => c.name === "doctor");
    const related = findRelatedCommands(tree, doctor);
    assert.ok(related.length > 0);
    assert.ok(related.every((r) => r.category === doctor.category));
    assert.ok(!related.some((r) => r.name === "doctor"));
});

test("findRelatedCommands excludes the input command", () => {
    const program = makeFakeProgram();
    const tree = getCommandTree(program);

    const check = tree.commands.find((c) => c.name === "check");
    const related = findRelatedCommands(tree, check);
    assert.ok(!related.some((r) => r.name === "check"));
});

test("findRelatedCommands limits to 5 results", () => {
    const program = new Command();
    // Add 7 commands in the same category (Core)
    for (let i = 0; i < 7; i++) {
        program.command(`core-cmd-${i}`).description(`Core command ${i}`);
    }
    const tree = getCommandTree(program);
    const first = tree.commands[0];
    const related = findRelatedCommands(tree, first);
    assert.ok(related.length <= 5);
});

// ─── getAvailableDocs ─────────────────────────────────────────────────

test("getAvailableDocs returns documentation mappings", () => {
    const docs = getAvailableDocs();
    assert.ok(Array.isArray(docs));
    // Each entry should have command and docFile
    for (const doc of docs) {
        assert.ok(doc.command);
        assert.ok(doc.docFile);
    }
});

// ─── Integration: real program ────────────────────────────────────────

test("real program: graph command has subcommands", async () => {
    const { createProgram } = await import("../src/index.js");
    const tree = getCommandTree(createProgram());
    const graph = tree.commands.find((c) => c.name === "graph");
    assert.ok(graph);
    assert.ok(graph.subcommands.length > 0);
    assert.ok(graph.subcommands.some((s) => s.name === "open"));
    assert.ok(graph.subcommands.some((s) => s.name === "impact"));
});

test("real program: snapshot command has aliases", async () => {
    const { createProgram } = await import("../src/index.js");
    const tree = getCommandTree(createProgram());
    const snapshot = tree.commands.find((c) => c.name === "snapshot");
    assert.ok(snapshot);
    assert.ok(snapshot.aliases.length > 0);
});

test("real program: repair command has subcommands", async () => {
    const { createProgram } = await import("../src/index.js");
    const tree = getCommandTree(createProgram());
    const repair = tree.commands.find((c) => c.name === "repair");
    assert.ok(repair);
    assert.ok(repair.subcommands.length > 0);
    assert.ok(repair.subcommands.some((s) => s.name === "scan"));
    assert.ok(repair.subcommands.some((s) => s.name === "run"));
});

test("real program: search finds commands by alias", async () => {
    const { createProgram } = await import("../src/index.js");
    const tree = getCommandTree(createProgram());
    // 'fix' is an alias for repair
    const results = searchCommandTree(tree, "fix");
    assert.ok(results.some((r) => r.name === "repair"));
});

test("real program: all commands have descriptions", async () => {
    const { createProgram } = await import("../src/index.js");
    const tree = getCommandTree(createProgram());
    for (const cmd of tree.commands) {
        assert.ok(cmd.description, `Command '${cmd.name}' has no description`);
    }
});

test("real program: all commands have a category", async () => {
    const { createProgram } = await import("../src/index.js");
    const tree = getCommandTree(createProgram());
    for (const cmd of tree.commands) {
        assert.ok(cmd.category, `Command '${cmd.name}' has no category`);
    }
});
