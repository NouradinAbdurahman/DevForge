import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    buildShellLines, applyWorkspaceShell, clearWorkspaceShell,
    shellInitScript, installShellHook, uninstallShellHook, isShellHookInstalled
} from "../src/core/workspace/shellIntegration.js";

async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-workspace-shell-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

const WORKSPACE = {
    name: "acme-backend",
    shell: { pathAdditions: ["/opt/acme/bin"], aliases: { deploy: "acme deploy --env=staging" }, functions: { greet: '  echo "hi"' } },
    env: { variables: { NODE_ENV: "development" }, secretKeys: ["API_KEY"] }
};

test("buildShellLines emits PATH/export/alias/function statements in order, quoting values", () => {
    const lines = buildShellLines(WORKSPACE, { resolvedEnv: { API_KEY: "sk-value" } });
    assert.deepEqual(lines, [
        'export PATH="/opt/acme/bin:$PATH"',
        "export NODE_ENV='development'",
        "export API_KEY='sk-value'",
        "alias deploy='acme deploy --env=staging'",
        "greet() {",
        '  echo "hi"',
        "}"
    ]);
});

test("buildShellLines never applies prompt/theme (reference-only, no PS1/PROMPT line emitted)", () => {
    const lines = buildShellLines({ ...WORKSPACE, shell: { ...WORKSPACE.shell, prompt: "custom", theme: "dracula" } });
    assert.ok(!lines.some((l) => l.includes("PROMPT") || l.includes("PS1")));
});

test("applyWorkspaceShell writes a mode-0600 file under ~/.config/devforgekit, regenerated each call", async () => {
    await withTempHome(async (tempHome) => {
        const file = applyWorkspaceShell(WORKSPACE, { resolvedEnv: { API_KEY: "sk-value" } });
        assert.equal(file, path.join(tempHome, ".config", "devforgekit", "workspace-shell.sh"));
        assert.equal((statSync(file).mode & 0o777).toString(8), "600");
        assert.match(readFileSync(file, "utf8"), /export NODE_ENV='development'/);
        assert.match(readFileSync(file, "utf8"), /export API_KEY='sk-value'/);

        // A second workspace's apply fully replaces the file - shell export
        // state is exclusive, unlike ssh.js's per-workspace blocks.
        applyWorkspaceShell({ name: "beta-frontend", shell: {}, env: { variables: { NODE_ENV: "staging" } } });
        const content = readFileSync(file, "utf8");
        assert.match(content, /NODE_ENV='staging'/);
        assert.ok(!content.includes("API_KEY"));
    });
});

test("clearWorkspaceShell resets the file to an inert placeholder", async () => {
    await withTempHome(async () => {
        const file = applyWorkspaceShell(WORKSPACE);
        clearWorkspaceShell();
        assert.equal(readFileSync(file, "utf8"), "# No active DevForgeKit workspace.\n");
    });
});

test("shellInitScript sources the generated file with an existence guard", async () => {
    await withTempHome(async (tempHome) => {
        const expectedFile = path.join(tempHome, ".config", "devforgekit", "workspace-shell.sh");
        assert.equal(shellInitScript(), `[ -f "${expectedFile}" ] && source "${expectedFile}"`);
    });
});

test("installShellHook/isShellHookInstalled/uninstallShellHook round-trip, idempotently, into ~/.zshrc", async () => {
    await withTempHome(async (tempHome) => {
        assert.equal(isShellHookInstalled("zsh"), false);

        const rcFile = installShellHook("zsh");
        assert.equal(rcFile, path.join(tempHome, ".zshrc"));
        assert.equal(isShellHookInstalled("zsh"), true);

        installShellHook("zsh"); // idempotent
        const content = readFileSync(rcFile, "utf8");
        assert.equal((content.match(/# >>> DevForgeKit workspace-shell-hook >>>/g) || []).length, 1);

        assert.equal(uninstallShellHook("zsh"), true);
        assert.equal(isShellHookInstalled("zsh"), false);
    });
});

test("installShellHook targets ~/.bashrc for shell: 'bash'", async () => {
    await withTempHome(async (tempHome) => {
        const rcFile = installShellHook("bash");
        assert.equal(rcFile, path.join(tempHome, ".bashrc"));
    });
});
