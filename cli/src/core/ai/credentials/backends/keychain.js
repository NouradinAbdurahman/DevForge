// macOS Keychain credential backend: stores API keys in the macOS
// Keychain via the `security` CLI. Before any operation, verifies that
// the keychain is actually available (security binary exists, default
// keychain exists, keychain is unlocked). Returns structured errors
// instead of launching GUI dialogs.
//
// This backend is only selected on macOS in production (not test, not
// CI). It never runs during `npm test`.
import { execSync } from "node:child_process";
import { CredentialBackend } from "../backend.js";

const SERVICE = "DevForgeKit";

// KeychainUnavailableError: structured error for when the keychain
// cannot be used. Never triggers a GUI dialog.
export class KeychainUnavailableError extends Error {
    constructor(reason) {
        super(`Keychain unavailable: ${reason}`);
        this.name = "KeychainUnavailableError";
        this.reason = reason;
    }
}

// detectKeychain() -> { available, reason? }. Checks all preconditions
// before attempting any keychain operation. This is the gate that
// prevents GUI dialogs — if any check fails, we return an error instead
// of letting `security` prompt the user.
function detectKeychain() {
    // 1. Must be macOS
    if (process.platform !== "darwin") {
        return { available: false, reason: "not macOS" };
    }

    // 2. `security` binary must exist
    try {
        execSync("which security 2>/dev/null", { stdio: "pipe", encoding: "utf8" });
    } catch {
        return { available: false, reason: "security binary not found" };
    }

    // 3. Default keychain must exist
    try {
        execSync("security default-keychain 2>/dev/null", { stdio: "pipe", encoding: "utf8" });
    } catch {
        return { available: false, reason: "no default keychain" };
    }

    // 4. Keychain must be unlocked (check by listing without a prompt)
    try {
        execSync("security show-keychain-info 2>/dev/null", { stdio: "pipe" });
    } catch {
        return { available: false, reason: "keychain locked" };
    }

    return { available: true };
}

export class KeychainBackend extends CredentialBackend {
    constructor() {
        super();
        const detection = detectKeychain();
        this._available = detection.available;
        this._reason = detection.reason || null;
    }

    _ensureAvailable() {
        if (!this._available) {
            throw new KeychainUnavailableError(this._reason);
        }
    }

    set(provider, key) {
        this._ensureAvailable();
        try {
            execSync(
                `security add-generic-password -a "${provider}" -s "${SERVICE}" -w "${key}" -U 2>/dev/null`,
                { stdio: "pipe" }
            );
        } catch (err) {
            throw new KeychainUnavailableError(`write failed: ${err.message}`);
        }
    }

    get(provider) {
        if (!this._available) return null;
        try {
            const result = execSync(
                `security find-generic-password -a "${provider}" -s "${SERVICE}" -w 2>/dev/null`,
                { stdio: "pipe", encoding: "utf8" }
            );
            return result.trim() || null;
        } catch {
            return null;
        }
    }

    remove(provider) {
        if (!this._available) return false;
        try {
            execSync(
                `security delete-generic-password -a "${provider}" -s "${SERVICE}" 2>/dev/null`,
                { stdio: "pipe" }
            );
            return true;
        } catch {
            return false;
        }
    }

    list() {
        if (!this._available) return [];
        try {
            const result = execSync(
                `security dump-keychain 2>/dev/null | grep -A2 '"svce"<blob>="DevForgeKit"' | grep '"acct"<blob>=' | sed 's/.*"acct"<blob>="\\([^"]*\\)".*/\\1/'`,
                { stdio: "pipe", encoding: "utf8" }
            );
            const ids = new Set();
            for (const line of result.trim().split("\n")) {
                const id = line.trim();
                if (id) ids.add(id);
            }
            return [...ids].sort();
        } catch {
            return [];
        }
    }

    exists(provider) {
        if (!this._available) return false;
        try {
            execSync(
                `security find-generic-password -a "${provider}" -s "${SERVICE}" 2>/dev/null`,
                { stdio: "pipe" }
            );
            return true;
        } catch {
            return false;
        }
    }

    test() {
        if (!this._available) {
            return { ok: false, reason: this._reason };
        }
        try {
            execSync("security show-keychain-info 2>/dev/null", { stdio: "pipe" });
            return { ok: true };
        } catch {
            return { ok: false, reason: "keychain locked or inaccessible" };
        }
    }

    location() {
        return "macOS Keychain";
    }
}
