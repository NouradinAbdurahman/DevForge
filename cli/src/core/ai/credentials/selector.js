// Credential backend selector: automatically chooses the right backend
// based on the runtime environment. The rest of the application never
// knows which backend is in use — everything goes through one interface.
//
// Selection priority (per the PRD):
//   1. NODE_ENV=test          → Memory backend (in-memory, zero OS access)
//   2. CI=true                → Mock backend (no OS APIs, no prompts)
//   3. DEVFORGEKIT_CRED_BACKEND env var → explicit override (for testing)
//   4. macOS (production)     → Keychain backend
//   5. Linux (production)     → File backend (until Secret Service is added)
//   6. Windows (production)   → File backend (until Credential Manager is added)
//   7. Fallback               → File backend
//
// This module exports a singleton `getBackend()` that lazily creates and
// caches the chosen backend. Tests can call `resetBackend()` to force
// re-selection (e.g. after changing NODE_ENV).
import { MemoryBackend } from "./backends/memory.js";
import { MockBackend } from "./backends/mock.js";
import { KeychainBackend } from "./backends/keychain.js";
import { FileBackend } from "./backends/file.js";

let _backend = null;

export function selectBackend() {
    // 1. Test environment — never touch the OS
    if (process.env.NODE_ENV === "test") {
        return new MemoryBackend();
    }

    // 2. CI environment — never touch the OS
    if (process.env.CI === "true" || process.env.CI === "1") {
        return new MockBackend({ log: process.env.DEVFORGEKIT_CRED_LOG === "1" });
    }

    // 3. Explicit override (for integration testing or debugging)
    const override = process.env.DEVFORGEKIT_CRED_BACKEND;
    if (override === "memory") return new MemoryBackend();
    if (override === "mock") return new MockBackend();
    if (override === "file") return new FileBackend();
    if (override === "keychain") return new KeychainBackend();

    // 4. macOS production — Keychain
    if (process.platform === "darwin") {
        const kc = new KeychainBackend();
        if (kc.test().ok) return kc;
        // Keychain not available (locked, missing, etc.) — fall through to file
    }

    // 5-7. Everything else — File backend
    return new FileBackend();
}

// getBackend() -> CredentialBackend. Lazily creates and caches the
// selected backend. All credential operations go through this.
export function getBackend() {
    if (!_backend) {
        _backend = selectBackend();
    }
    return _backend;
}

// resetBackend() -> void. Clears the cached backend so the next
// getBackend() call re-selects. Used by tests that change env vars.
export function resetBackend() {
    _backend = null;
}

// setBackend(backend) -> void. Explicitly inject a backend (dependency
// injection). Used by tests that need a specific backend instance.
export function setBackend(backend) {
    _backend = backend;
}
