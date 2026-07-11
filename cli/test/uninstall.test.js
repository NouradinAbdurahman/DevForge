import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Real incident this file exists to prevent: testing scripts/uninstall.sh
// by piping "n" into it (assuming that would decline) instead actually
// uninstalled a real package on a real dev machine, because confirm()
// (scripts/common.sh) intentionally auto-confirms whenever stdin isn't a
// real tty - correct for unattended install/backup/update in CI, wrong
// for anything this destructive. The fix has two independent layers,
// and these tests prove both:
//   1. uninstall.sh refuses to run at all in a non-interactive context
//      unless --force is passed - checked before any category selection.
//   2. Every actual destructive command goes through
//      dfk_run_destructive/dfk_remove_file (scripts/common.sh), so
//      DEVFORGEKIT_TEST_MODE=1 lets these tests exercise the script's
//      real logic (flag parsing, package/extension/config/service
//      handling) with a real, disposable $HOME, and zero risk of
//      touching whatever machine actually runs this suite - even if (1)
//      above had a bug, defense in depth.
//
// Real-tty interactive behavior (the checklist, a genuine y/N read) is
// verified manually, same convention as this repo's TUI tests
// (cli/test/tui.test.js) - node:child_process can't allocate a real PTY,
// and a `script`/pty-dependent test here would be flaky in a headless CI
// container with no controlling terminal at all.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const uninstallScript = join(repoRoot, "scripts", "uninstall.sh");

function withScratchHome(fn) {
    const home = mkdtempSync(join(tmpdir(), "devforgekit-uninstall-test-home-"));
    const testLog = join(mkdtempSync(join(tmpdir(), "devforgekit-uninstall-test-log-")), "log.txt");
    try {
        return fn(home, testLog);
    } finally {
        rmSync(home, { recursive: true, force: true });
        rmSync(join(testLog, ".."), { recursive: true, force: true });
    }
}

function seedInstallState(home, state) {
    const configDir = join(home, ".config", "devforgekit");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "install-state.json"), JSON.stringify(state, null, 2));
}

function runUninstall(args, { home, testLog, stdin = "", env = {} } = {}) {
    return spawnSync("bash", [uninstallScript, ...args], {
        cwd: repoRoot,
        encoding: "utf8",
        input: stdin,
        env: {
            ...process.env,
            HOME: home,
            DEVFORGEKIT_TEST_MODE: "1",
            DEVFORGEKIT_TEST_LOG: testLog,
            ...env
        }
    });
}

test("piping input (non-tty stdin) without --force never performs a real uninstall, even answering as if confirming", () => {
    withScratchHome((home, testLog) => {
        seedInstallState(home, { jq: "installed:brew" });

        // The exact shape of the real incident: stdin is a pipe (not a
        // tty), no --force given. Even piping "y" (as if enthusiastically
        // confirming) must not matter - the script must refuse before it
        // ever reaches a confirmation prompt at all.
        const result = runUninstall(["--all"], { home, testLog, stdin: "y\n" });

        assert.notEqual(result.status, 0, "expected a non-zero exit when refusing to run non-interactively without --force");
        assert.match(result.stderr, /refusing to run non-interactively without --force/i);
        assert.ok(!existsSync(testLog) || readFileSync(testLog, "utf8").trim() === "",
            "no destructive action should have been logged - the script must exit before reaching any of them");
    });
});

test("non-interactive execution with no flags at all exits safely without touching anything", () => {
    withScratchHome((home, testLog) => {
        const result = runUninstall([], { home, testLog, stdin: "" });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /refusing to run non-interactively without --force/i);
        assert.ok(!existsSync(testLog) || readFileSync(testLog, "utf8").trim() === "");
    });
});

test("--force with no category flags in a non-interactive context still refuses, rather than silently doing nothing or guessing", () => {
    withScratchHome((home, testLog) => {
        const result = runUninstall(["--force"], { home, testLog });

        assert.notEqual(result.status, 0);
        assert.match(result.stdout + result.stderr, /No category selected/);
        assert.ok(!existsSync(testLog) || readFileSync(testLog, "utf8").trim() === "");
    });
});

test("--force performs the uninstall intentionally: runs every selected category's real logic (mocked), skips the confirm prompt", () => {
    withScratchHome((home, testLog) => {
        seedInstallState(home, { jq: "installed:brew", docker: "installed:cask" });

        const result = runUninstall(["--all", "--force"], { home, testLog });

        assert.equal(result.status, 0, `expected success, got:\n${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, /Skipping confirmation \(--force\)/);
        assert.match(result.stdout, /Uninstall complete/);

        const log = readFileSync(testLog, "utf8");
        assert.match(log, /Uninstall jq: brew uninstall jq/);
        assert.match(log, /Uninstall docker: brew uninstall --cask docker/);
        assert.match(log, /Stop postgresql@17: brew services stop postgresql@17/);
        assert.match(log, /Stop mysql: brew services stop mysql/);
        assert.match(log, /Stop redis: brew services stop redis/);

        // install-state.json must be cleared after a --packages/--all run -
        // those packages are no longer installed.
        const state = JSON.parse(readFileSync(join(home, ".config", "devforgekit", "install-state.json"), "utf8"));
        assert.deepEqual(state, {});
    });
});

test("--force --packages only removes packages, not extensions/config/services", () => {
    withScratchHome((home, testLog) => {
        seedInstallState(home, { jq: "installed:brew" });

        const result = runUninstall(["--packages", "--force"], { home, testLog });

        assert.equal(result.status, 0);
        const log = existsSync(testLog) ? readFileSync(testLog, "utf8") : "";
        assert.match(log, /Uninstall jq: brew uninstall jq/);
        assert.ok(!log.includes("Stop "), "services should not have been touched when only --packages was requested");
        assert.ok(!log.includes("--uninstall-extension"), "extensions should not have been touched when only --packages was requested");
    });
});
