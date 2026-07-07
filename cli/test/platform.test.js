// Unit tests for the v2.0.7 OS Abstraction Layer (core/platform/). Uses
// setPlatformForTesting() to exercise MacOSPlatform/LinuxPlatform/
// WindowsPlatform deterministically regardless of which OS actually runs
// this suite, rather than mocking os.platform() globally.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    getPlatform,
    setPlatformForTesting,
    resetPlatformForTesting,
    MacOSPlatform,
    LinuxPlatform,
    WindowsPlatform,
    PlatformNotSupportedError
} from "../src/core/platform/index.js";

test("getPlatform() returns a real adapter matching the running OS by default", () => {
    resetPlatformForTesting();
    const platform = getPlatform();
    assert.ok(["macos", "linux", "windows"].includes(platform.id));
});

test("getPlatform() returns the same cached instance across calls", () => {
    resetPlatformForTesting();
    assert.equal(getPlatform(), getPlatform());
});

test("setPlatformForTesting()/resetPlatformForTesting() swap the active adapter", () => {
    setPlatformForTesting(new LinuxPlatform());
    assert.equal(getPlatform().id, "linux");
    setPlatformForTesting(new WindowsPlatform());
    assert.equal(getPlatform().id, "windows");
    resetPlatformForTesting();
});

test("MacOSPlatform: identity, shell, bin dirs, package manager", () => {
    const platform = new MacOSPlatform();
    assert.equal(platform.id, "macos");
    assert.equal(platform.label, "macOS");
    assert.equal(platform.defaultShell(), "zsh");
    assert.equal(platform.packageManagerId(), "brew");
    assert.ok(platform.binSearchDirs().includes("/opt/homebrew/bin"));
    assert.ok(platform.binSearchDirs().includes("/usr/local/bin"));
    assert.ok(platform.packageManagerCacheDir().endsWith("Library/Caches/Homebrew"));
});

test("MacOSPlatform: shellConfigFile resolves zsh/bash/fish rc paths", () => {
    const platform = new MacOSPlatform();
    assert.ok(platform.shellConfigFile("zsh").endsWith(".zshrc"));
    assert.ok(platform.shellConfigFile("bash").endsWith(".bashrc"));
    assert.ok(platform.shellConfigFile("fish").endsWith("config.fish"));
    assert.ok(platform.shellConfigFile().endsWith(".zshrc"), "defaults to the platform's default shell");
});

test("MacOSPlatform: installCommand builds brew-formula/brew-cask/npm/pip/cargo/mise/shell commands", () => {
    const platform = new MacOSPlatform();
    assert.equal(platform.installCommand({ method: "brew-formula", id: "wget" }, "install"), "brew install wget");
    assert.equal(platform.installCommand({ method: "brew-formula", id: "wget" }, "uninstall"), "brew uninstall wget");
    assert.equal(platform.installCommand({ method: "brew-cask", id: "docker" }, "install"), "brew install --cask docker");
    assert.equal(platform.installCommand({ method: "brew-cask", id: "docker" }, "uninstall"), "brew uninstall --cask docker");
    assert.equal(
        platform.installCommand({ method: "brew-formula", id: "bun", tap: "oven-sh/bun" }, "install"),
        "brew tap oven-sh/bun && brew install bun"
    );
    assert.equal(platform.installCommand({ method: "npm", id: "pnpm" }, "install"), "npm install -g pnpm");
    assert.equal(platform.installCommand({ method: "npm", id: "pnpm" }, "uninstall"), "npm uninstall -g pnpm");
    assert.equal(platform.installCommand({ method: "pip", id: "black" }, "install"), "pip install black");
    assert.equal(platform.installCommand({ method: "cargo", id: "ripgrep" }, "install"), "cargo install ripgrep");
    assert.equal(platform.installCommand({ method: "mise", id: "node" }, "install"), "mise use -g node");
    assert.equal(platform.installCommand({ method: "shell", command: "echo hi" }, "install"), "echo hi");
});

test("MacOSPlatform: installCommand throws PlatformNotSupportedError for an unknown method", () => {
    const platform = new MacOSPlatform();
    assert.throws(() => platform.installCommand({ method: "choco", id: "x" }, "install"), PlatformNotSupportedError);
});

test("upgradeCommand() builds `brew upgrade <name>` on macOS", () => {
    const platform = new MacOSPlatform();
    assert.equal(platform.upgradeCommand("wget"), "brew upgrade wget");
});

test("LinuxPlatform: identity, default shell, package manager detection", () => {
    const platform = new LinuxPlatform();
    assert.equal(platform.id, "linux");
    assert.equal(platform.label, "Linux");
    assert.equal(platform.defaultShell(), "bash");
    // packageManagerId() returns the detected pm or null — not fabricated
    const pmId = platform.packageManagerId();
    assert.ok(pmId === null || ["apt", "dnf", "pacman"].includes(pmId));
});

test("LinuxPlatform: OS-agnostic install methods still work (npm/pip/cargo/mise/shell)", () => {
    const platform = new LinuxPlatform();
    assert.equal(platform.installCommand({ method: "npm", id: "pnpm" }, "install"), "npm install -g pnpm");
    assert.equal(platform.installCommand({ method: "shell", command: "echo hi" }, "install"), "echo hi");
});

test("LinuxPlatform: apt/dnf/pacman install commands are built correctly", () => {
    const platform = new LinuxPlatform();
    assert.equal(
        platform.installCommand({ method: "apt", id: "wget" }, "install"),
        "sudo apt update && sudo apt install -y wget"
    );
    assert.equal(
        platform.installCommand({ method: "apt", id: "wget" }, "uninstall"),
        "sudo apt remove -y wget"
    );
    assert.equal(
        platform.installCommand({ method: "dnf", id: "git" }, "install"),
        "sudo dnf install -y git"
    );
    assert.equal(
        platform.installCommand({ method: "dnf", id: "git" }, "uninstall"),
        "sudo dnf remove -y git"
    );
    assert.equal(
        platform.installCommand({ method: "pacman", id: "ripgrep" }, "install"),
        "sudo pacman -S --noconfirm ripgrep"
    );
    assert.equal(
        platform.installCommand({ method: "pacman", id: "ripgrep" }, "uninstall"),
        "sudo pacman -Rns --noconfirm ripgrep"
    );
});

test("LinuxPlatform: brew-formula/brew-cask install steps throw PlatformNotSupportedError", () => {
    const platform = new LinuxPlatform();
    assert.throws(() => platform.installCommand({ method: "brew-formula", id: "wget" }, "install"), PlatformNotSupportedError);
    assert.throws(() => platform.installCommand({ method: "brew-cask", id: "docker" }, "install"), PlatformNotSupportedError);
});

test("LinuxPlatform: winget/choco/scoop install steps throw PlatformNotSupportedError", () => {
    const platform = new LinuxPlatform();
    assert.throws(() => platform.installCommand({ method: "winget", id: "x" }, "install"), PlatformNotSupportedError);
    assert.throws(() => platform.installCommand({ method: "choco", id: "x" }, "install"), PlatformNotSupportedError);
    assert.throws(() => platform.installCommand({ method: "scoop", id: "x" }, "install"), PlatformNotSupportedError);
});

test("WindowsPlatform: identity, default shell, package manager detection", () => {
    const platform = new WindowsPlatform();
    assert.equal(platform.id, "windows");
    assert.equal(platform.label, "Windows");
    assert.equal(platform.defaultShell(), "powershell");
    // packageManagerId() returns the detected pm or null — not fabricated
    const pmId = platform.packageManagerId();
    assert.ok(pmId === null || ["winget", "choco", "scoop"].includes(pmId));
});

test("WindowsPlatform: winget/choco/scoop install commands are built correctly", () => {
    const platform = new WindowsPlatform();
    assert.equal(
        platform.installCommand({ method: "winget", id: "Git.Git" }, "install"),
        "winget install --id Git.Git --accept-package-agreements --accept-source-agreements"
    );
    assert.equal(
        platform.installCommand({ method: "winget", id: "Git.Git" }, "uninstall"),
        "winget uninstall --id Git.Git --silent"
    );
    assert.equal(
        platform.installCommand({ method: "choco", id: "git" }, "install"),
        "choco install git -y"
    );
    assert.equal(
        platform.installCommand({ method: "choco", id: "git" }, "uninstall"),
        "choco uninstall git -y"
    );
    assert.equal(
        platform.installCommand({ method: "scoop", id: "ripgrep" }, "install"),
        "scoop install ripgrep"
    );
    assert.equal(
        platform.installCommand({ method: "scoop", id: "ripgrep" }, "uninstall"),
        "scoop uninstall ripgrep"
    );
});

test("WindowsPlatform: brew-formula/brew-cask/apt/dnf/pacman throw PlatformNotSupportedError", () => {
    const platform = new WindowsPlatform();
    assert.throws(() => platform.installCommand({ method: "brew-formula", id: "x" }, "install"), PlatformNotSupportedError);
    assert.throws(() => platform.installCommand({ method: "apt", id: "x" }, "install"), PlatformNotSupportedError);
    assert.throws(() => platform.installCommand({ method: "dnf", id: "x" }, "install"), PlatformNotSupportedError);
    assert.throws(() => platform.installCommand({ method: "pacman", id: "x" }, "install"), PlatformNotSupportedError);
});

test("WindowsPlatform: shellConfigFile resolves a PowerShell profile path", () => {
    const platform = new WindowsPlatform();
    assert.ok(platform.shellConfigFile().includes("WindowsPowerShell"));
});

test("architecture() maps CPU arch consistently across platforms", () => {
    const linux = new LinuxPlatform();
    const windows = new WindowsPlatform();
    const macos = new MacOSPlatform();
    // Whatever this machine's real arch is, macOS reports it in the
    // intel/apple-silicon vocabulary while Linux/Windows report the
    // generic arm64/x64/arm one - never "unknown" for a known Node arch.
    for (const platform of [linux, windows, macos]) {
        assert.notEqual(platform.architecture(), "unknown");
    }
    assert.ok(["intel", "apple-silicon"].includes(macos.architecture()));
    assert.ok(["arm64", "x64", "arm"].includes(linux.architecture()));
});

test("base Platform class throws if instantiated and used directly (no id)", async () => {
    const { Platform } = await import("../src/core/platform/base.js");
    const platform = new Platform();
    assert.throws(() => platform.id, /must be implemented by a subclass/);
});

test("installer resolveInstallStep uses platformInstall on macOS", async () => {
    const { resolveInstallStep } = await import("../src/core/installer.js");
    setPlatformForTesting(new MacOSPlatform());
    try {
        const pkg = {
            name: "test-pkg",
            install: { method: "shell", command: "echo fallback" },
            platformInstall: {
                macos: { method: "brew-formula", id: "test-pkg" },
                linux: { method: "apt", id: "test-pkg" },
                windows: { method: "winget", id: "Test.Pkg" },
            },
        };
        const step = resolveInstallStep(pkg);
        assert.equal(step.method, "brew-formula");
        assert.equal(step.id, "test-pkg");
    } finally {
        resetPlatformForTesting();
    }
});

test("installer resolveInstallStep uses platformInstall on Linux", async () => {
    const { resolveInstallStep } = await import("../src/core/installer.js");
    setPlatformForTesting(new LinuxPlatform());
    try {
        const pkg = {
            name: "test-pkg",
            install: { method: "shell", command: "echo fallback" },
            platformInstall: {
                macos: { method: "brew-formula", id: "test-pkg" },
                linux: { method: "apt", id: "test-pkg" },
                windows: { method: "winget", id: "Test.Pkg" },
            },
        };
        const step = resolveInstallStep(pkg);
        assert.equal(step.method, "apt");
        assert.equal(step.id, "test-pkg");
    } finally {
        resetPlatformForTesting();
    }
});

test("installer resolveInstallStep uses platformInstall on Windows", async () => {
    const { resolveInstallStep } = await import("../src/core/installer.js");
    setPlatformForTesting(new WindowsPlatform());
    try {
        const pkg = {
            name: "test-pkg",
            install: { method: "shell", command: "echo fallback" },
            platformInstall: {
                macos: { method: "brew-formula", id: "test-pkg" },
                linux: { method: "apt", id: "test-pkg" },
                windows: { method: "winget", id: "Test.Pkg" },
            },
        };
        const step = resolveInstallStep(pkg);
        assert.equal(step.method, "winget");
        assert.equal(step.id, "Test.Pkg");
    } finally {
        resetPlatformForTesting();
    }
});

test("installer resolveInstallStep falls back to top-level install when no platformInstall match", async () => {
    const { resolveInstallStep } = await import("../src/core/installer.js");
    setPlatformForTesting(new LinuxPlatform());
    try {
        const pkg = {
            name: "test-pkg",
            install: { method: "npm", id: "test-pkg" },
        };
        const step = resolveInstallStep(pkg);
        assert.equal(step.method, "npm");
    } finally {
        resetPlatformForTesting();
    }
});
