// The OS Abstraction Layer's contract (v2.0.7 - see
// docs/PlatformArchitecture.md's Cross-Platform Architecture section).
// Every shared system (registry/installer, compatibility engine, repair,
// benchmark, package intel, workspace manager, TUI) that used to shell
// out to a macOS-only command (`brew`, `sw_vers`, `~/Library/Caches`,
// hardcoded `.zshrc`) now goes through `getPlatform()` (see index.js)
// instead. `Platform` is the base class: it implements every OS-agnostic
// package method (npm/pip/cargo/mise/shell - these already work
// identically on Linux/Windows) and throws `PlatformNotSupportedError`
// for anything that's genuinely still macOS/Homebrew-only, so a shared
// system calling an unsupported method on a non-macOS platform fails
// with a clear, actionable message instead of a raw ENOENT from a
// missing `brew` binary. `MacOSPlatform` (macos.js) is the only fully
// implemented adapter today; `LinuxPlatform`/`WindowsPlatform`
// (linux.js/windows.js) exist so the shape is real and testable, but
// deliberately do not implement package-manager operations yet - see
// those files' own comments. Per the CLAUDE.md/architecture rule this
// enforces: only bootstrap/install/service management (Layer 1's
// scripts/*.sh, forever bash+Homebrew) stays platform-specific by
// design; everything under cli/src/core (Layer 2) routes through here.
import os from "node:os";
import path from "node:path";
import { homeDir } from "../paths.js";
import { PlatformNotSupportedError } from "./errors.js";

export class Platform {
    // Subclasses must override; the base throwing here means a bug that
    // instantiates the base class directly fails loudly instead of
    // silently reporting as an unknown platform.
    get id() {
        throw new Error("Platform.id must be implemented by a subclass");
    }

    get label() {
        return this.id;
    }

    // CPU architecture, using the same apple-silicon/intel vocabulary
    // the registry's package.schema.json `architectures` field already
    // uses on macOS, and the plain arm64/x64/arm Node vocabulary
    // elsewhere - unifies what used to be three independent copies of
    // this exact mapping (compatibility/engine.js, repair.js,
    // installAudit.js).
    architecture() {
        const arch = os.arch();
        if (arch === "arm64") return this.id === "macos" ? "apple-silicon" : "arm64";
        if (arch === "x64" || arch === "ia32") return this.id === "macos" ? "intel" : "x64";
        if (arch === "arm") return "arm";
        return "unknown";
    }

    defaultShell() {
        return "bash";
    }

    // shellConfigFile(shell) -> the rc file a given shell reads on
    // startup, for workspace/shellIntegration.js's shell-hook and any
    // other code that needs to append/remove a marker block.
    shellConfigFile(shell = this.defaultShell()) {
        if (shell === "fish") return path.join(homeDir(), ".config", "fish", "config.fish");
        return path.join(homeDir(), shell === "zsh" ? ".zshrc" : ".bashrc");
    }

    // binSearchDirs() -> directories worth scanning for broken symlinks/
    // installed binaries (repair.js's scanBrokenSymlinks used to
    // hardcode "/usr/local/bin"). Order matters where it reflects PATH
    // precedence.
    binSearchDirs() {
        return [path.join(homeDir(), ".local", "bin"), path.join(homeDir(), "bin"), "/usr/local/bin"];
    }

    // packageManagerId() -> the identifier core/config.js's
    // `packageManager` field and the registry's install `method` values
    // are expressed in terms of ("brew" today). `null` means this
    // platform has no first-class package manager DevForgeKit drives yet.
    packageManagerId() {
        return null;
    }

    // packageManagerCacheDir() -> where that package manager's download/
    // build cache lives, or null if unknown/not applicable. Used by
    // `devforgekit clean` and diagnostics, never assumed present.
    packageManagerCacheDir() {
        return null;
    }

    // osVersion() -> a best-effort human-readable OS version string, or
    // null if it can't be determined. Async because every real
    // implementation shells out.
    async osVersion() {
        return null;
    }

    // installCommand(step, action) -> the shell command for a registry
    // package manifest's install `step` (see core/installer.js).
    // "action" is "install" or "uninstall". Handles every OS-agnostic
    // method directly; brew-specific methods and anything unrecognized
    // are handled by the caller/subclass (see MacOSPlatform.installCommand).
    installCommand(step, action) {
        switch (step.method) {
            case "npm":
                return action === "uninstall" ? `npm uninstall -g ${step.id}` : `npm install -g ${step.id}`;
            case "pip":
                return action === "uninstall" ? `pip uninstall -y ${step.id}` : `pip install ${step.id}`;
            case "cargo":
                return action === "uninstall" ? `cargo uninstall ${step.id}` : `cargo install ${step.id}`;
            case "mise":
                return action === "uninstall" ? `mise uninstall ${step.id}` : `mise use -g ${step.id}`;
            case "shell":
                return step.command;
            case "brew-formula":
            case "brew-cask":
                throw new PlatformNotSupportedError(
                    `'${step.method}' install steps require macOS (Homebrew) - not supported on ${this.label}`
                );
            case "apt":
                throw new PlatformNotSupportedError(
                    `'apt' install steps require Linux (Debian/Ubuntu) - not supported on ${this.label}`
                );
            case "dnf":
                throw new PlatformNotSupportedError(
                    `'dnf' install steps require Linux (Fedora/RHEL) - not supported on ${this.label}`
                );
            case "pacman":
                throw new PlatformNotSupportedError(
                    `'pacman' install steps require Linux (Arch) - not supported on ${this.label}`
                );
            case "winget":
                throw new PlatformNotSupportedError(
                    `'winget' install steps require Windows - not supported on ${this.label}`
                );
            case "choco":
                throw new PlatformNotSupportedError(
                    `'choco' install steps require Windows (Chocolatey) - not supported on ${this.label}`
                );
            case "scoop":
                throw new PlatformNotSupportedError(
                    `'scoop' install steps require Windows (Scoop) - not supported on ${this.label}`
                );
            default:
                throw new PlatformNotSupportedError(`Unknown install method: ${step.method}`);
        }
    }

    // packagePrefix(id, { cask }) -> the install prefix/location of a
    // package-manager-installed package, or null if it can't be
    // determined (commands/info.js's install-size computation,
    // packageIntel.js's install-location detection).
    async packagePrefix(_id, _opts = {}) {
        throw new PlatformNotSupportedError(`Package location lookup is not yet supported on ${this.label}`);
    }

    // outdatedPackages() -> string[] of package identifiers this
    // platform's package manager reports as outdated (commands/stats.js,
    // core/workspace/health.js, tui/pages/UpdatesPage.js). Every caller
    // already treats "package manager not available" as a soft/skippable
    // condition, so this throwing is expected to be caught, not a crash.
    async outdatedPackages() {
        throw new PlatformNotSupportedError(`Listing outdated packages is not yet supported on ${this.label}`);
    }

    // upgradeCommand(name) -> the shell command to upgrade a single
    // package by name via this platform's package manager.
    upgradeCommand(_name) {
        throw new PlatformNotSupportedError(`Upgrading packages is not yet supported on ${this.label}`);
    }
}
