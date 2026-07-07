// Linux platform adapter (v2.2.3 Cross-Platform Implementation).
// Supports apt (Debian/Ubuntu), dnf (Fedora/RHEL), and pacman (Arch).
// Detects which package manager is available at runtime via existsSync
// on the binary path, with a precedence order of apt > dnf > pacman
// (matching the distro family most likely to have the others also
// installed, e.g. Ubuntu WSL with pacman available). WSL is detected
// via /proc/version containing "microsoft".
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { homeDir } from "../paths.js";
import { captureShellCommand } from "../shell.js";
import { Platform } from "./base.js";
import { PlatformNotSupportedError } from "./errors.js";

const APT_PATH = "/usr/bin/apt";
const DNF_PATH = "/usr/bin/dnf";
const PACMAN_PATH = "/usr/bin/pacman";

function detectPackageManager() {
    if (existsSync(APT_PATH)) return "apt";
    if (existsSync(DNF_PATH)) return "dnf";
    if (existsSync(PACMAN_PATH)) return "pacman";
    return null;
}

function isWSL() {
    try {
        const content = readFileSync("/proc/version", "utf8");
        return /microsoft/i.test(content);
    } catch {
        return false;
    }
}

export class LinuxPlatform extends Platform {
    get id() {
        return "linux";
    }

    get label() {
        return "Linux";
    }

    defaultShell() {
        return "bash";
    }

    binSearchDirs() {
        return [path.join(homeDir(), ".local", "bin"), "/usr/local/bin", "/usr/bin"];
    }

    packageManagerId() {
        return detectPackageManager();
    }

    packageManagerCacheDir() {
        const pm = detectPackageManager();
        if (pm === "apt") return "/var/cache/apt/archives";
        if (pm === "dnf") return "/var/cache/dnf";
        if (pm === "pacman") return "/var/cache/pacman/pkg";
        return null;
    }

    // osVersion() - best-effort from /etc/os-release (the standard
    // freedesktop.org source every major distro ships), e.g.
    // "Ubuntu 24.04.1 LTS". Returns null if the file is missing/unreadable.
    async osVersion() {
        const osReleasePath = "/etc/os-release";
        if (!existsSync(osReleasePath)) return null;
        try {
            const content = readFileSync(osReleasePath, "utf8");
            const match = /^PRETTY_NAME="?([^"\n]+)"?$/m.exec(content);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    }

    // isWSL() - true when running inside Windows Subsystem for Linux.
    // Detected via /proc/version containing "microsoft".
    get wsl() {
        return isWSL();
    }

    installCommand(step, action) {
        switch (step.method) {
            case "apt":
                return action === "uninstall"
                    ? `sudo apt remove -y ${step.id}`
                    : `sudo apt update && sudo apt install -y ${step.id}`;
            case "dnf":
                return action === "uninstall"
                    ? `sudo dnf remove -y ${step.id}`
                    : `sudo dnf install -y ${step.id}`;
            case "pacman":
                return action === "uninstall"
                    ? `sudo pacman -Rns --noconfirm ${step.id}`
                    : `sudo pacman -S --noconfirm ${step.id}`;
            default:
                return super.installCommand(step, action);
        }
    }

    async packagePrefix(id) {
        const pm = detectPackageManager();
        if (!pm) return null;
        try {
            if (pm === "apt") {
                const { code, stdout } = await captureShellCommand(`dpkg -L ${id} 2>/dev/null | head -1`);
                if (code === 0 && stdout.trim()) return path.dirname(stdout.trim());
            }
            if (pm === "dnf") {
                const { code, stdout } = await captureShellCommand(`rpm -ql ${id} 2>/dev/null | head -1`);
                if (code === 0 && stdout.trim()) return path.dirname(stdout.trim());
            }
            if (pm === "pacman") {
                const { code, stdout } = await captureShellCommand(`pacman -Ql ${id} 2>/dev/null | head -1 | awk '{print $2}'`);
                if (code === 0 && stdout.trim()) return path.dirname(stdout.trim());
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
            if (pm === "apt") {
                const { code, stdout } = await captureShellCommand("apt list --upgradable 2>/dev/null");
                if (code !== 0) return [];
                return stdout.split("\n")
                    .filter(l => l && !l.startsWith("Listing"))
                    .map(l => l.split("/")[0])
                    .filter(Boolean);
            }
            if (pm === "dnf") {
                const { code, stdout } = await captureShellCommand("dnf check-update 2>/dev/null");
                if (code !== 0 && code !== 100) return [];
                return stdout.split("\n")
                    .filter(l => l && !l.startsWith("Last metadata") && !l.includes("updates"))
                    .map(l => l.split(" ")[0])
                    .filter(Boolean);
            }
            if (pm === "pacman") {
                const { code, stdout } = await captureShellCommand("pacman -Qu 2>/dev/null");
                if (code !== 0) return [];
                return stdout.split("\n")
                    .map(l => l.split(" ")[0])
                    .filter(Boolean);
            }
        } catch {
            // ignore
        }
        return [];
    }

    upgradeCommand(name) {
        const pm = detectPackageManager();
        if (pm === "apt") return `sudo apt update && sudo apt upgrade -y ${name}`;
        if (pm === "dnf") return `sudo dnf upgrade -y ${name}`;
        if (pm === "pacman") return `sudo pacman -Syu --noconfirm ${name}`;
        throw new PlatformNotSupportedError("No supported Linux package manager detected");
    }
}
