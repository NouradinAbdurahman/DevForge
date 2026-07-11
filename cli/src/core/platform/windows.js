// Windows platform adapter (v2.2.3 Cross-Platform Implementation).
// Supports winget (Windows Package Manager), Chocolatey, and Scoop.
// Detects which package manager is available at runtime by checking
// for the binary on PATH, with a precedence order of winget > choco > scoop
// (winget ships with modern Windows 10/11, choco is the most common
// third-party manager, scoop is a user-level alternative).
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { homeDir } from "../paths.js";
import { captureShellCommand } from "../shell.js";
import { Platform } from "./base.js";
import { PlatformNotSupportedError, assertSafePackageId } from "./errors.js";

function detectPackageManager() {
    // winget is in WindowsApps dir, choco in ProgramData, scoop in user home
    const wingetPath = path.join(homeDir(), "AppData", "Local", "Microsoft", "WindowsApps", "winget.exe");
    const chocoPath = "C:\\ProgramData\\chocolatey\\bin\\choco.exe";
    const scoopShimDir = path.join(homeDir(), "scoop", "shims");

    if (existsSync(wingetPath)) return "winget";
    if (existsSync(chocoPath)) return "choco";
    if (existsSync(scoopShimDir)) return "scoop";
    return null;
}

export class WindowsPlatform extends Platform {
    get id() {
        return "windows";
    }

    get label() {
        return "Windows";
    }

    defaultShell() {
        return "powershell";
    }

    // Named even though the Environment Configuration Engine's
    // PowerShell writer isn't implemented yet - the engine skips
    // unimplemented writers with a warning (see
    // core/environment/writers/index.js), so this stays honest while
    // keeping the platform contract complete.
    shells() {
        return ["powershell"];
    }

    // shellConfigFile() - PowerShell's per-user profile script, the
    // closest equivalent to .zshrc/.bashrc's "runs on every new shell"
    // role. Best-effort path (the real location can vary by PowerShell
    // version/edition).
    shellConfigFile(shell = this.defaultShell()) {
        if (shell === "powershell") {
            return path.join(homeDir(), "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1");
        }
        return super.shellConfigFile(shell);
    }

    binSearchDirs() {
        const dirs = [
            path.join(homeDir(), "AppData", "Local", "Microsoft", "WindowsApps"),
            "C:\\Program Files",
            "C:\\Program Files (x86)",
        ];
        const pm = detectPackageManager();
        if (pm === "scoop") dirs.push(path.join(homeDir(), "scoop", "shims"));
        if (pm === "choco") dirs.push("C:\\ProgramData\\chocolatey\\bin");
        return dirs;
    }

    packageManagerId() {
        return detectPackageManager();
    }

    packageManagerCacheDir() {
        const pm = detectPackageManager();
        if (pm === "winget") return path.join(homeDir(), "AppData", "Local", "Packages", "Microsoft.DesktopAppInstaller_8wekyb3d8bbwe");
        if (pm === "choco") return "C:\\ProgramData\\chocolatey\\cache";
        if (pm === "scoop") return path.join(homeDir(), "scoop", "cache");
        return null;
    }

    async osVersion() {
        try {
            const { code, stdout } = await captureShellCommand("cmd /c ver 2>nul");
            if (code === 0 && stdout.trim()) return stdout.trim();
        } catch {
            // ignore
        }
        return null;
    }

    installCommand(step, action) {
        if (["winget", "choco", "scoop"].includes(step.method)) {
            assertSafePackageId(step.id, `${step.method} package id`);
        }
        switch (step.method) {
            case "winget":
                return action === "uninstall"
                    ? `winget uninstall --id ${step.id} --silent`
                    : `winget install --id ${step.id} --accept-package-agreements --accept-source-agreements`;
            case "choco":
                return action === "uninstall"
                    ? `choco uninstall ${step.id} -y`
                    : `choco install ${step.id} -y`;
            case "scoop":
                return action === "uninstall"
                    ? `scoop uninstall ${step.id}`
                    : `scoop install ${step.id}`;
            default:
                return super.installCommand(step, action);
        }
    }

    async packagePrefix(id) {
        const pm = detectPackageManager();
        if (!pm) return null;
        try {
            if (pm === "winget") {
                // winget doesn't have a direct prefix command; return the default install location
                return path.join(homeDir(), "AppData", "Local", "Microsoft", "WinGet", "Packages");
            }
            if (pm === "choco") {
                return path.join("C:\\ProgramData\\chocolatey", "lib", id);
            }
            if (pm === "scoop") {
                return path.join(homeDir(), "scoop", "apps", id);
            }
        } catch {
            // ignore
        }
        return null;
    }

    async outdatedPackages() {
        const pm = detectPackageManager();
        if (!pm) return [];
        try {
            if (pm === "winget") {
                const { code, stdout } = await captureShellCommand("winget upgrade 2>nul");
                if (code !== 0) return [];
                return stdout.split("\n")
                    .filter(l => l && !l.startsWith("Name") && !l.startsWith("-") && !l.includes(" upgrades"))
                    .map(l => {
                        const match = l.match(/\S+\s+\S+\s+\S+\s+\S+\s+(\S+)/);
                        return match ? match[1] : null;
                    })
                    .filter(Boolean);
            }
            if (pm === "choco") {
                const { code, stdout } = await captureShellCommand("choco outdated 2>nul");
                if (code !== 0) return [];
                return stdout.split("\n")
                    .filter(l => l && !l.startsWith("Chocolatey"))
                    .map(l => l.split("|")[0].trim())
                    .filter(Boolean);
            }
            if (pm === "scoop") {
                const { code, stdout } = await captureShellCommand("scoop status 2>nul");
                if (code !== 0) return [];
                return stdout.split("\n")
                    .filter(l => l && !l.startsWith("Scoop"))
                    .map(l => l.split(" ")[0])
                    .filter(Boolean);
            }
        } catch {
            // ignore
        }
        return [];
    }

    upgradeCommand(name) {
        assertSafePackageId(name, "package name");
        const pm = detectPackageManager();
        if (pm === "winget") return `winget upgrade --id ${name} --accept-package-agreements --accept-source-agreements`;
        if (pm === "choco") return `choco upgrade ${name} -y`;
        if (pm === "scoop") return `scoop update ${name}`;
        throw new PlatformNotSupportedError("No supported Windows package manager detected");
    }
}
