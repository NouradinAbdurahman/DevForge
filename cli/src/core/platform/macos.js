// The only fully-implemented platform adapter today - every method here
// existed before v2.0.7, just scattered across installer.js, repair.js,
// compatibility/engine.js, installAudit.js, packageIntel.js,
// commands/info.js, commands/stats.js, and workspace/shellIntegration.js
// as independent, sometimes-duplicated implementations. This file is
// where that logic now actually lives; those call sites delegate here
// via getPlatform() (see index.js).
import path from "node:path";
import { homeDir } from "../paths.js";
import { captureShellCommand } from "../shell.js";
import { Platform } from "./base.js";
import { assertSafePackageId } from "./errors.js";

export class MacOSPlatform extends Platform {
    get id() {
        return "macos";
    }

    get label() {
        return "macOS";
    }

    defaultShell() {
        return "zsh";
    }

    // zsh is macOS's default login shell since Catalina; bash is still
    // generated for scripts/users that explicitly run it.
    shells() {
        return ["zsh", "bash"];
    }

    binSearchDirs() {
        // Apple Silicon's Homebrew prefix first, then Intel's, matching
        // scripts/common.sh's os_brew_prefix precedence.
        return ["/opt/homebrew/bin", "/usr/local/bin", path.join(homeDir(), ".local", "bin"), path.join(homeDir(), "bin")];
    }

    packageManagerId() {
        return "brew";
    }

    packageManagerCacheDir() {
        return path.join(homeDir(), "Library", "Caches", "Homebrew");
    }

    async osVersion() {
        try {
            const { code, stdout } = await captureShellCommand("sw_vers -productVersion 2>/dev/null");
            return code === 0 && stdout.trim() ? stdout.trim() : null;
        } catch {
            return null;
        }
    }

    installCommand(step, action) {
        if (step.method === "brew-formula" || step.method === "brew-cask") {
            assertSafePackageId(step.id, `${step.method} package id`);
            if (step.tap) assertSafePackageId(step.tap, "brew tap");
        }
        const tapPrefix = step.tap ? `brew tap ${step.tap} && ` : "";
        if (step.method === "brew-formula") {
            return tapPrefix + (action === "uninstall" ? `brew uninstall ${step.id}` : `brew install ${step.id}`);
        }
        if (step.method === "brew-cask") {
            return tapPrefix + (action === "uninstall" ? `brew uninstall --cask ${step.id}` : `brew install --cask ${step.id}`);
        }
        return super.installCommand(step, action);
    }

    // packagePrefix(id, { cask }) -> the Homebrew Cellar/Caskroom prefix
    // for a formula/cask, or null if brew doesn't know it (not installed,
    // or genuinely not a brew package). Tries formula first, then cask,
    // same fallback order packageIntel.js used inline before.
    async packagePrefix(id, { cask = false } = {}) {
        const flag = cask ? "--cask --prefix" : "--prefix";
        const { code, stdout } = await captureShellCommand(`brew ${flag} ${id} 2>/dev/null`);
        if (code === 0 && stdout.trim()) return stdout.trim();
        if (!cask) return this.packagePrefix(id, { cask: true });
        return null;
    }

    // packageCellarDir(id) -> the Cellar directory for an installed
    // formula (commands/info.js's install-size computation).
    async packageCellarDir(id) {
        const { code, stdout } = await captureShellCommand(`brew --cellar ${id} 2>/dev/null`);
        return code === 0 && stdout.trim() ? stdout.trim() : null;
    }

    // packageCaskroomDir(id) -> the Caskroom directory for an installed
    // cask.
    async packageCaskroomDir(id) {
        const { code, stdout } = await captureShellCommand("brew --prefix 2>/dev/null");
        if (code !== 0 || !stdout.trim()) return null;
        return path.join(stdout.trim(), "Caskroom", id);
    }

    async outdatedPackages() {
        const { stdout } = await captureShellCommand("brew outdated 2>/dev/null");
        return stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    }

    // outdatedVerbose() -> the raw `brew outdated --verbose` text
    // packageIntel.js's detectOutdated scans for a specific package name
    // - kept separate from outdatedPackages() (plain names) since the two
    // callers want different formats and re-parsing one into the other
    // would be lossy.
    async outdatedVerbose() {
        const { code, stdout } = await captureShellCommand("brew outdated --verbose 2>/dev/null");
        return { code, stdout };
    }

    upgradeCommand(name) {
        assertSafePackageId(name, "package name");
        return `brew upgrade ${name}`;
    }
}
