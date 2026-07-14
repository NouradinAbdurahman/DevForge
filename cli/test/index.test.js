import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, symlinkSync, rmSync, mkdirSync, cpSync, chmodSync, writeFileSync, readdirSync } from "node:fs";
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

// Regression coverage for the root cause documented in
// docs/NpmGlobalInstallRootCause.md: `sudo npm install -g devforgekit`
// leaves the installed cli/ directory root-owned (real repro: a clean
// Ubuntu 22.04 + npm 11.18 container). Combined with npm 11.16+'s
// allow-scripts gate silently skipping the postinstall script that
// would normally populate cli/node_modules, the *unprivileged* user who
// then runs `devforgekit` has no write access to install cli/'s
// dependencies in place. self_heal_cli_deps()'s fallback mirror
// (CLI_FALLBACK_ROOT, in the `devforgekit` dispatcher) exists
// specifically to survive this. These tests simulate the unwritable
// directory with a plain chmod (no sudo/root needed - the OS enforces
// the same EACCES either way) and a fake `npm` on PATH that symlinks in
// this repo's own already-installed cli/node_modules instead of hitting
// the real network, so the test stays fast and deterministic while
// still exercising the real chmod/dispatch/exec logic end to end.
function buildUnwritableCliFixture() {
    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
    const tmpDir = mkdtempSync(join(tmpdir(), "devforgekit-sudo-fixture-"));

    for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
        if (["cli", ".git", "node_modules"].includes(entry.name)) continue;
        cpSync(join(repoRoot, entry.name), join(tmpDir, entry.name), { recursive: true });
    }
    mkdirSync(join(tmpDir, "cli"));
    cpSync(join(repoRoot, "cli", "bin"), join(tmpDir, "cli", "bin"), { recursive: true });
    cpSync(join(repoRoot, "cli", "src"), join(tmpDir, "cli", "src"), { recursive: true });
    cpSync(join(repoRoot, "cli", "package.json"), join(tmpDir, "cli", "package.json"));
    cpSync(join(repoRoot, "cli", "package-lock.json"), join(tmpDir, "cli", "package-lock.json"));

    // Simulate `sudo npm install -g` leaving cli/ unwritable to the
    // current (unprivileged) user - a plain chmod produces the exact
    // same `[[ -w "$SCRIPT_DIR/cli" ]]` failure and EACCES-on-mkdir a
    // real root-owned directory does, without needing actual root/sudo
    // in a test environment.
    chmodSync(join(tmpDir, "cli"), 0o555);

    const fakeBin = join(tmpDir, "fake-bin");
    mkdirSync(fakeBin);
    const fakeNpmPath = join(fakeBin, "npm");
    writeFileSync(
        fakeNpmPath,
        `#!/usr/bin/env bash\n# Fake npm for tests: "install" links in this repo's own already-\n# installed cli/node_modules instead of touching the real network.\nif [[ "$1" == "install" ]]; then\n    ln -s "${join(repoRoot, "cli", "node_modules")}" node_modules\n    exit 0\nfi\nexit 0\n`
    );
    chmodSync(fakeNpmPath, 0o755);

    return { tmpDir, fakeBin };
}

test("devforgekit falls back to a user-writable mirror and still delegates to the Node CLI when cli/ is not writable (sudo-installed npm package simulation)", () => {
    const { tmpDir, fakeBin } = buildUnwritableCliFixture();
    const fakeHome = mkdtempSync(join(tmpdir(), "devforgekit-sudo-fixture-home-"));

    try {
        const result = spawnSync(join(tmpDir, "devforgekit"), ["--version"], {
            encoding: "utf8",
            env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}:${process.env.PATH}`, DEVFORGEKIT_NO_TUI: "1" }
        });

        const output = result.stdout + result.stderr;
        assert.ok(
            !output.includes("Automatic setup failed"),
            `expected the fallback mirror to succeed, but self-heal reported failure:\n${output}`
        );
        assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/, `expected a real version number, got:\n${output}`);
    } finally {
        // Undo the chmod from buildUnwritableCliFixture() first - removing
        // cli/'s own children requires write permission on cli/ itself,
        // which was deliberately revoked above.
        chmodSync(join(tmpDir, "cli"), 0o755);
        rmSync(tmpDir, { recursive: true, force: true });
        rmSync(fakeHome, { recursive: true, force: true });
    }
});

test("the fallback mirror correctly resolves repoRoot()-relative lookups (registry/) through symlinks, not just cli/", () => {
    const { tmpDir, fakeBin } = buildUnwritableCliFixture();
    const fakeHome = mkdtempSync(join(tmpdir(), "devforgekit-sudo-fixture-home-"));

    try {
        const result = spawnSync(join(tmpDir, "devforgekit"), ["component", "list"], {
            encoding: "utf8",
            env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}:${process.env.PATH}`, DEVFORGEKIT_NO_TUI: "1" }
        });

        const output = result.stdout + result.stderr;
        assert.ok(!output.includes("Automatic setup failed"), `expected self-heal to succeed:\n${output}`);
        assert.match(output, /DevForgeKit Components \(\d+\)/, `expected the real registry to load through the mirror:\n${output}`);
    } finally {
        // Undo the chmod from buildUnwritableCliFixture() first - removing
        // cli/'s own children requires write permission on cli/ itself,
        // which was deliberately revoked above.
        chmodSync(join(tmpDir, "cli"), 0o755);
        rmSync(tmpDir, { recursive: true, force: true });
        rmSync(fakeHome, { recursive: true, force: true });
    }
});

test("a second invocation reuses the fallback mirror without re-running the setup message", () => {
    const { tmpDir, fakeBin } = buildUnwritableCliFixture();
    const fakeHome = mkdtempSync(join(tmpdir(), "devforgekit-sudo-fixture-home-"));
    const env = { ...process.env, HOME: fakeHome, PATH: `${fakeBin}:${process.env.PATH}`, DEVFORGEKIT_NO_TUI: "1" };

    try {
        const first = spawnSync(join(tmpDir, "devforgekit"), ["--version"], { encoding: "utf8", env });
        assert.match(first.stdout.trim(), /^\d+\.\d+\.\d+/, `first run should succeed:\n${first.stdout}${first.stderr}`);

        const second = spawnSync(join(tmpDir, "devforgekit"), ["--version"], { encoding: "utf8", env });
        assert.ok(
            !second.stderr.includes("Setting up the DevForgeKit CLI"),
            `second run should reuse the already-mirrored cache, not re-run setup:\n${second.stdout}${second.stderr}`
        );
        assert.match(second.stdout.trim(), /^\d+\.\d+\.\d+/);
    } finally {
        // Undo the chmod from buildUnwritableCliFixture() first - removing
        // cli/'s own children requires write permission on cli/ itself,
        // which was deliberately revoked above.
        chmodSync(join(tmpDir, "cli"), 0o755);
        rmSync(tmpDir, { recursive: true, force: true });
        rmSync(fakeHome, { recursive: true, force: true });
    }
});

test("bumping VERSION invalidates the fallback mirror instead of silently running stale code", () => {
    const { tmpDir, fakeBin } = buildUnwritableCliFixture();
    const fakeHome = mkdtempSync(join(tmpdir(), "devforgekit-sudo-fixture-home-"));
    const env = { ...process.env, HOME: fakeHome, PATH: `${fakeBin}:${process.env.PATH}`, DEVFORGEKIT_NO_TUI: "1" };

    try {
        const first = spawnSync(join(tmpDir, "devforgekit"), ["--version"], { encoding: "utf8", env });
        assert.match(first.stdout.trim(), /^\d+\.\d+\.\d+/, `first run should succeed:\n${first.stdout}${first.stderr}`);

        // Simulate `npm update -g devforgekit` bumping VERSION in place
        // (the one file left writable to the invoking user's ownership
        // model - only cli/ itself was chmod'd read-only above).
        writeFileSync(join(tmpDir, "VERSION"), "999.0.0\n");

        const second = spawnSync(join(tmpDir, "devforgekit"), ["--version"], { encoding: "utf8", env });
        assert.ok(
            second.stderr.includes("Setting up the DevForgeKit CLI"),
            `expected the stale mirror to be rebuilt after a VERSION bump:\n${second.stdout}${second.stderr}`
        );
    } finally {
        // Undo the chmod from buildUnwritableCliFixture() first - removing
        // cli/'s own children requires write permission on cli/ itself,
        // which was deliberately revoked above.
        chmodSync(join(tmpDir, "cli"), 0o755);
        rmSync(tmpDir, { recursive: true, force: true });
        rmSync(fakeHome, { recursive: true, force: true });
    }
});
