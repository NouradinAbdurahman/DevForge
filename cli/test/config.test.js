import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, getConfigValue, setConfigValue, listConfig } from "../src/core/config.js";

// config.js resolves the user-level layer from process.env.HOME at call
// time (see userConfigDir in core/paths.js), so pointing HOME at a
// scratch directory isolates these tests from the developer's real
// ~/.config/devforgekit/config.yaml without needing to mock the
// filesystem.
function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-config-test-"));
    process.env.HOME = tempHome;
    try {
        return fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

test("defaults apply when no config files exist", () => {
    withTempHome(() => {
        const config = loadConfig();
        assert.equal(config.editor, "vscode");
        assert.equal(config.shell, "zsh");
        assert.equal(config.packageManager, "brew");
        assert.equal(config.browser, "chrome");
        assert.equal(config.aiProvider, "none");
        assert.equal(config.defaultProfile, "minimal");
        assert.equal(config.updateSchedule, "manual");
        assert.equal(config.telemetry, false);
        assert.deepEqual(config.fonts, []);
        assert.deepEqual(config.mirrors, []);
        assert.equal(config.registryUrl, null);
    });
});

test("set then get round-trips through the user-level layer at ~/.config/devforgekit/config.yaml", () => {
    withTempHome((tempHome) => {
        setConfigValue("editor", "cursor");
        assert.equal(getConfigValue("editor"), "cursor");

        const configPath = path.join(tempHome, ".config", "devforgekit", "config.yaml");
        assert.ok(existsSync(configPath), "expected config.yaml to be written under ~/.config/devforgekit");
        assert.match(readFileSync(configPath, "utf8"), /editor: cursor/);
    });
});

test("env vars (DEVFORGEKIT_*) override the user-level file", () => {
    withTempHome(() => {
        setConfigValue("editor", "cursor");
        process.env.DEVFORGEKIT_EDITOR = "neovim";
        try {
            assert.equal(getConfigValue("editor"), "neovim");
        } finally {
            delete process.env.DEVFORGEKIT_EDITOR;
        }
    });
});

test("DEV_SETUP_ASSUME_YES=1 is surfaced as config.assumeYes", () => {
    withTempHome(() => {
        process.env.DEV_SETUP_ASSUME_YES = "1";
        try {
            assert.equal(listConfig().assumeYes, true);
        } finally {
            delete process.env.DEV_SETUP_ASSUME_YES;
        }
    });
});
