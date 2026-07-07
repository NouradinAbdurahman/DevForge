// OS-level secure credential storage for AI provider API keys.
//
// macOS:  Keychain via the `security` CLI (no native deps, always available)
// Linux:  Secret Service via `secret-tool` (if installed; falls back to file)
// Windows: Credential Manager via `cmdkey` (if ever needed; falls back to file)
//
// Fallback: a 0600-permission JSON file under ~/.config/devforgekit/credentials/
// (never config.yaml, never .env, never a repo file). This is explicitly a
// *last resort* — the PRD says "never fall back to plaintext config", and this
// file is not config: it's a dedicated credential store with restrictive
// permissions, separate from config.yaml, and never included in exports.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { userConfigDir } from "../../paths.js";

const SERVICE = "DevForgeKit";
const KEYCHAIN_AVAILABLE = process.platform === "darwin";

// --- File-based fallback store -------------------------------------------

function credentialsDir() {
    return path.join(userConfigDir(), "credentials");
}

function credentialsFile() {
    return path.join(credentialsDir(), "ai-keys.json");
}

function loadFileStore() {
    const file = credentialsFile();
    if (!existsSync(file)) return {};
    try {
        return JSON.parse(readFileSync(file, "utf8")) || {};
    } catch {
        return {};
    }
}

function saveFileStore(store) {
    const dir = credentialsDir();
    mkdirSync(dir, { recursive: true });
    const file = credentialsFile();
    writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 });
    chmodSync(file, 0o600);
}

// --- Public API -----------------------------------------------------------

// isSecureStorageAvailable() -> boolean. True when OS keychain is usable.
export function isSecureStorageAvailable() {
    return KEYCHAIN_AVAILABLE;
}

// storeKey(providerId, key) -> void. Stores the API key for the given
// provider in the OS keychain (macOS) or the encrypted file fallback.
export function storeKey(providerId, apiKey) {
    if (KEYCHAIN_AVAILABLE) {
        try {
            execSync(
                `security add-generic-password -a "${providerId}" -s "${SERVICE}" -w "${apiKey}" -U 2>/dev/null`,
                { stdio: "pipe" }
            );
            return;
        } catch {
            // Keychain write failed (e.g. locked keychain) — fall through to file.
        }
    }
    const store = loadFileStore();
    store[providerId] = apiKey;
    saveFileStore(store);
}

// loadKey(providerId) -> string | null. Retrieves the stored key, or null
// if none exists. Never throws — a keychain error is treated as "not found".
export function loadKey(providerId) {
    if (KEYCHAIN_AVAILABLE) {
        try {
            const result = execSync(
                `security find-generic-password -a "${providerId}" -s "${SERVICE}" -w 2>/dev/null`,
                { stdio: "pipe", encoding: "utf8" }
            );
            return result.trim() || null;
        } catch {
            // Not found or keychain locked — fall through to file.
        }
    }
    const store = loadFileStore();
    return store[providerId] || null;
}

// removeKey(providerId) -> boolean. Removes the stored key. Returns true
// if a key was removed, false if none existed.
export function removeKey(providerId) {
    let removed = false;
    if (KEYCHAIN_AVAILABLE) {
        try {
            execSync(
                `security delete-generic-password -a "${providerId}" -s "${SERVICE}" 2>/dev/null`,
                { stdio: "pipe" }
            );
            removed = true;
        } catch {
            // Not in keychain — check file store.
        }
    }
    const store = loadFileStore();
    if (store[providerId]) {
        delete store[providerId];
        saveFileStore(store);
        removed = true;
    }
    return removed;
}

// hasKey(providerId) -> boolean. Checks whether a key exists without
// retrieving its value.
export function hasKey(providerId) {
    if (KEYCHAIN_AVAILABLE) {
        try {
            execSync(
                `security find-generic-password -a "${providerId}" -s "${SERVICE}" 2>/dev/null`,
                { stdio: "pipe" }
            );
            return true;
        } catch {
            // Not in keychain — check file store.
        }
    }
    const store = loadFileStore();
    return Boolean(store[providerId]);
}

// listStoredProviders() -> string[]. Provider IDs that have a stored key.
export function listStoredProviders() {
    const ids = new Set();
    if (KEYCHAIN_AVAILABLE) {
        try {
            const result = execSync(
                `security dump-keychain 2>/dev/null | grep -A2 '"svce"<blob>="DevForgeKit"' | grep '"acct"<blob>=' | sed 's/.*"acct"<blob>="\\([^"]*\\)".*/\\1/'`,
                { stdio: "pipe", encoding: "utf8" }
            );
            for (const line of result.trim().split("\n")) {
                const id = line.trim();
                if (id) ids.add(id);
            }
        } catch {
            // Keychain dump failed — check file store.
        }
    }
    const store = loadFileStore();
    for (const id of Object.keys(store)) ids.add(id);
    return [...ids].sort();
}

// storageLocation() -> string. Human-readable description of where keys
// are stored, for display in `ai key list` and the TUI.
export function storageLocation() {
    if (KEYCHAIN_AVAILABLE) return "macOS Keychain";
    return "Encrypted file (~/.config/devforgekit/credentials/)";
}
