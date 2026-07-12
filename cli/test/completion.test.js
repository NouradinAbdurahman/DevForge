// Regression tests for core/completion.js + the generated zsh
// completion's self-registering compdef idiom (scripts/
// generate-completions.mjs) - added alongside `devforgekit completion
// install/uninstall/status/doctor`, built to close a real gap found
// during the v3.0.1-rc1 consumer audit: completions shipped in the npm
// package but nothing installed them for a user who didn't come in via
// Homebrew. Every install/uninstall/status test runs against a scratch
// $HOME (same pattern cli/test/environment.test.js already established)
// so nothing here ever touches the developer's real shell config.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    SUPPORTED_SHELLS,
    detectCurrentShell,
    detectAvailableShells,
    packagedCompletionFile,
    installedCompletionPath,
    installShellCompletion,
    uninstallShellCompletion,
    isShellCompletionInstalled,
    completionStatus,
    isCurrentInstallStale
} from "../src/core/completion.js";
import { commandExists } from "../src/core/shell.js";
import { repoRoot } from "../src/core/paths.js";

async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const originalShell = process.env.SHELL;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-completion-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        if (originalShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = originalShell;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

// ─── detectCurrentShell ──────────────────────────────────────────────

test("detectCurrentShell() reads $SHELL when it names a supported shell", () => {
    process.env.SHELL = "/usr/bin/fish";
    assert.equal(detectCurrentShell(), "fish");
});

test("detectCurrentShell() falls back to a supported default when $SHELL is unset", () => {
    delete process.env.SHELL;
    assert.ok(SUPPORTED_SHELLS.includes(detectCurrentShell()));
});

test("detectCurrentShell() falls back when $SHELL names something unsupported (e.g. tcsh)", () => {
    process.env.SHELL = "/bin/tcsh";
    assert.ok(SUPPORTED_SHELLS.includes(detectCurrentShell()));
});

// ─── detectAvailableShells ───────────────────────────────────────────

test("detectAvailableShells() returns a subset of SUPPORTED_SHELLS and includes bash", async () => {
    const available = await detectAvailableShells();
    for (const shell of available) assert.ok(SUPPORTED_SHELLS.includes(shell));
    assert.ok(available.includes("bash"), "bash is expected on any machine capable of running this test suite");
});

// ─── install / uninstall / status per shell ─────────────────────────

for (const shell of SUPPORTED_SHELLS) {
    test(`installShellCompletion("${shell}") copies the packaged file to the expected location`, async () => {
        await withTempHome(() => {
            const result = installShellCompletion(shell);
            assert.equal(result.shell, shell);
            assert.ok(existsSync(result.installedPath));
            assert.equal(
                readFileSync(result.installedPath, "utf8"),
                readFileSync(packagedCompletionFile(shell), "utf8")
            );
        });
    });

    test(`isShellCompletionInstalled("${shell}") is false before install, true after`, async () => {
        await withTempHome(() => {
            assert.equal(isShellCompletionInstalled(shell), false);
            installShellCompletion(shell);
            assert.equal(isShellCompletionInstalled(shell), true);
        });
    });

    test(`uninstallShellCompletion("${shell}") removes the installed file`, async () => {
        await withTempHome(() => {
            installShellCompletion(shell);
            assert.equal(uninstallShellCompletion(shell), true);
            assert.equal(existsSync(installedCompletionPath(shell)), false);
            assert.equal(isShellCompletionInstalled(shell), false);
        });
    });

    test(`uninstallShellCompletion("${shell}") on a shell that was never installed is a clean no-op`, async () => {
        await withTempHome(() => {
            assert.equal(uninstallShellCompletion(shell), false);
        });
    });

    test(`reinstalling "${shell}" after uninstall works cleanly`, async () => {
        await withTempHome(() => {
            installShellCompletion(shell);
            uninstallShellCompletion(shell);
            const result = installShellCompletion(shell);
            assert.ok(existsSync(result.installedPath));
            assert.equal(isShellCompletionInstalled(shell), true);
        });
    });

    test(`installing "${shell}" twice does not duplicate the install (idempotent)`, async () => {
        await withTempHome(() => {
            const first = installShellCompletion(shell);
            const second = installShellCompletion(shell);
            assert.equal(first.installedPath, second.installedPath);
            if (second.rcFile) {
                const content = readFileSync(second.rcFile, "utf8");
                const occurrences = content.split("# >>> DevForgeKit completions >>>").length - 1;
                assert.equal(occurrences, 1, "the marker block must appear exactly once after a duplicate install");
            }
        });
    });
}

test("fish install writes no rc file (fish auto-loads its completions directory)", async () => {
    await withTempHome(() => {
        const result = installShellCompletion("fish");
        assert.equal(result.rcFile, null);
        assert.match(result.installedPath, /\.config\/fish\/completions\/devforgekit\.fish$/);
    });
});

test("zsh/bash installs write a marker block into their real rc file, sourcing the installed copy", async () => {
    await withTempHome(() => {
        for (const shell of ["zsh", "bash"]) {
            const result = installShellCompletion(shell);
            assert.ok(result.rcFile);
            const content = readFileSync(result.rcFile, "utf8");
            assert.match(content, /# >>> DevForgeKit completions >>>/);
            assert.ok(content.includes(`source ${result.installedPath}`));
        }
    });
});

test("zsh's rc block includes a compdef-availability guard (compinit may not have run yet in the user's own rc)", async () => {
    await withTempHome(() => {
        const { rcFile } = installShellCompletion("zsh");
        const content = readFileSync(rcFile, "utf8");
        assert.match(content, /compdef/);
        assert.match(content, /compinit/);
    });
});

test("installShellCompletion() throws a clear error for an unsupported shell", async () => {
    await withTempHome(() => {
        assert.throws(() => installShellCompletion("tcsh"), /Unsupported shell/);
    });
});

// ─── completionStatus / isCurrentInstallStale ────────────────────────

test("completionStatus() reports installed: false and upToDate: null before any install", async () => {
    await withTempHome(async () => {
        const status = await completionStatus("bash");
        assert.equal(status.installed, false);
        assert.equal(status.upToDate, null);
    });
});

test("completionStatus() reports installed: true and upToDate: true right after a fresh install", async () => {
    await withTempHome(async () => {
        installShellCompletion("bash");
        const status = await completionStatus("bash");
        assert.equal(status.installed, true);
        assert.equal(status.upToDate, true);
    });
});

test("completionStatus() detects a stale installed copy (packaged source changed since install)", async () => {
    await withTempHome(async () => {
        installShellCompletion("bash");
        writeFileSync(installedCompletionPath("bash"), "# stale, hand-edited or from an older CLI version\n");
        const status = await completionStatus("bash");
        assert.equal(status.upToDate, false);
    });
});

test("completionStatus() detects a manually edited rc block as not current", async () => {
    await withTempHome(async () => {
        const { rcFile } = installShellCompletion("zsh");
        writeFileSync(rcFile, `${readFileSync(rcFile, "utf8")}\n# user added something inside the block by hand, imagine it changed the block content\n`);
        // Simulate real manual edit: rewrite the block's inner content directly.
        const content = readFileSync(rcFile, "utf8").replace("source ", "# source ");
        writeFileSync(rcFile, content);
        const status = await completionStatus("zsh");
        assert.equal(status.blockCurrent, false);
    });
});

test("isCurrentInstallStale() is false right after a fresh install", async () => {
    await withTempHome(() => {
        installShellCompletion("bash");
        assert.equal(isCurrentInstallStale("bash"), false);
    });
});

test("isCurrentInstallStale() is true when the packaged source is newer and differs from the installed copy", async () => {
    await withTempHome(() => {
        installShellCompletion("bash");
        const dest = installedCompletionPath("bash");
        writeFileSync(dest, "# an older completion script\n");
        // epoch-0, not "N seconds ago" - the real packaged source's own
        // mtime (a checked-out repo file, not under this test's control)
        // could itself be anywhere from "just now" to "whenever this
        // clone last touched it", so only a value guaranteed older than
        // any real checkout keeps this deterministic without mutating
        // the source file itself.
        utimesSync(dest, new Date(0), new Date(0));
        assert.equal(isCurrentInstallStale("bash"), true);
    });
});

// ─── real zsh: the self-registering compdef idiom actually registers ─

test("the generated zsh completion registers itself via compdef when sourced directly (not just fpath-autoloaded)", async (t) => {
    if (!(await commandExists("zsh"))) {
        t.skip("zsh not available on this machine");
        return;
    }
    const script = [
        "autoload -Uz compinit && compinit -C -d /dev/null",
        `source ${packagedCompletionFile("zsh")}`,
        'print -r -- "${_comps[devforgekit]}"'
    ].join("\n");
    const output = execFileSync("zsh", ["-f", "-c", script], { encoding: "utf8" }).trim();
    assert.equal(output, "_devforgekit");
});

// ─── generator output sanity (regression: used to be a bare `_devforgekit` call) ─

test("completions/devforgekit.zsh no longer ends with a bare, non-self-registering function call", () => {
    const content = readFileSync(path.join(repoRoot(), "completions", "devforgekit.zsh"), "utf8");
    assert.match(content, /compdef _devforgekit devforgekit/);
    assert.doesNotMatch(content.trimEnd(), /\n_devforgekit\s*$/);
});
