import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createProgram } from "../src/index.js";

// The root bash dispatcher (repo-root `devforgekit`) advertises a fixed
// list of commands as "Node CLI only" in its usage() text and falls back
// to a plain "Unknown command" error for them when cli/node_modules isn't
// installed yet. That list must always match what createProgram() actually
// registers - otherwise a command can silently stop existing in the Node
// CLI while the bash wrapper still claims it works (or vice versa).
const NODE_ONLY_COMMANDS = ["config", "component", "plugin", "recipe", "new", "dashboard", "ui", "completion", "completions"];

function commandNames(program) {
    const names = new Set();
    for (const cmd of program.commands) {
        names.add(cmd.name());
        for (const alias of cmd.aliases()) names.add(alias);
    }
    return names;
}

test("createProgram registers every command the root dispatcher advertises as Node-only", () => {
    const program = createProgram();
    const names = commandNames(program);
    for (const name of NODE_ONLY_COMMANDS) {
        assert.ok(names.has(name), `expected "${name}" to be registered on the commander program`);
    }
});

test("dashboard command is registered with a ui alias", () => {
    const program = createProgram();
    const dashboard = program.commands.find((c) => c.name() === "dashboard");
    assert.ok(dashboard, "dashboard command not registered");
    assert.ok(dashboard.aliases().includes("ui"), "dashboard command missing \"ui\" alias");
});

test("root dispatcher's Node-only fallback case lists exactly the commands createProgram registers for them", () => {
    const dispatcherPath = fileURLToPath(new URL("../../devforgekit", import.meta.url));
    const dispatcher = readFileSync(dispatcherPath, "utf8");

    // Pull the case arm added for "Node CLI not set up yet" out of the
    // dispatcher source, e.g. `config|component|plugin|recipe|new|dashboard|ui)`
    const match = dispatcher.match(/\n {4}([\w-]+(?:\|[\w-]+)+)\)\s*\n\s*echo "'\$SELF \$cmd' requires the Node CLI/);
    assert.ok(match, "could not find the Node-only fallback case arm in the root dispatcher");

    const dispatcherCommands = match[1].split("|").sort();
    assert.deepEqual(dispatcherCommands, [...NODE_ONLY_COMMANDS].sort());
});

// The dashboard/TUI itself needs a real TTY (isTuiCapable() in
// tui/index.js checks process.stdout.isTTY/process.stdin.isTTY), which
// node:child_process can't allocate - real-PTY behavior for this repo is
// verified manually (see cli/test/tui.test.js's own comment on this).
// What *is* deterministic and worth pinning here: given a working Node
// CLI, the root bash dispatcher must delegate a no-args invocation to
// `node cli/bin/devforgekit.js` rather than silently handling it itself.
// The two code paths produce distinguishable output - the bash
// dispatcher's own hand-written usage() says "Usage: $SELF <command>
// [args...]", while commander's generated help (which bin/devforgekit.js
// falls back to on a non-TTY stdout/stdin) says "Usage: devforgekit
// [options] [command]" - so asserting on which one appears catches a
// regression where cli_available() wrongly evaluates false (or symlink
// resolution breaks SCRIPT_DIR) just as reliably as watching the TUI
// launch would, without requiring a PTY.
test("root dispatcher delegates a no-args invocation to the Node CLI, even through a symlink, when the Node CLI is available", () => {
    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
    const realDispatcher = join(repoRoot, "devforgekit");

    // Simulate the global-install symlink (install_global_command in
    // scripts/common.sh symlinks a Homebrew-prefix bin/devforgekit to
    // this file) to prove SCRIPT_DIR resolution survives it.
    const tmpDir = mkdtempSync(join(tmpdir(), "devforgekit-symlink-test-"));
    const symlinkPath = join(tmpDir, "devforgekit");
    symlinkSync(realDispatcher, symlinkPath);

    try {
        const result = spawnSync(symlinkPath, [], {
            cwd: tmpDir,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, DEVFORGEKIT_NO_TUI: "1" }
        });

        const output = result.stdout + result.stderr;
        assert.ok(
            !output.includes("Run with no arguments to open the interactive terminal dashboard"),
            `expected the Node CLI to handle the no-args invocation, but got the bash dispatcher's own usage() text:\n${output}`
        );
        assert.match(output, /Usage: devforgekit \[options\] \[command\]/);
    } finally {
        rmSync(tmpDir, { recursive: true, force: true });
    }
});
