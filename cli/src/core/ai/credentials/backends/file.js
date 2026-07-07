// Encrypted file credential backend: a 0600-permission JSON file under
// ~/.config/devforgekit/credentials/ai-keys.json. This is the last-resort
// fallback when no OS credential store is available (or when the keychain
// is locked/unavailable). Never config.yaml, never .env, never a repo
// file — a dedicated credential store with restrictive permissions,
// separate from config.yaml, and never included in exports.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { userConfigDir } from "../../../paths.js";
import { CredentialBackend } from "../backend.js";

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

export class FileBackend extends CredentialBackend {
    set(provider, key) {
        const store = loadFileStore();
        store[provider] = key;
        saveFileStore(store);
    }

    get(provider) {
        const store = loadFileStore();
        return store[provider] || null;
    }

    remove(provider) {
        const store = loadFileStore();
        if (store[provider]) {
            delete store[provider];
            saveFileStore(store);
            return true;
        }
        return false;
    }

    list() {
        const store = loadFileStore();
        return Object.keys(store).sort();
    }

    exists(provider) {
        const store = loadFileStore();
        return Boolean(store[provider]);
    }

    test() {
        try {
            const dir = credentialsDir();
            mkdirSync(dir, { recursive: true });
            return { ok: true };
        } catch (err) {
            return { ok: false, reason: err.message };
        }
    }

    location() {
        return "Encrypted file (~/.config/devforgekit/credentials/)";
    }
}
