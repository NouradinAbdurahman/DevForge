// In-memory credential backend: exists only in RAM. Nothing touches disk,
// nothing touches the OS keychain, nothing survives process exit. Perfect
// for unit tests — the PRD's "a unit test must never access the user's
// real Keychain" requirement.
import { CredentialBackend } from "../backend.js";

export class MemoryBackend extends CredentialBackend {
    constructor() {
        super();
        this._store = new Map();
    }

    set(provider, key) {
        this._store.set(provider, key);
    }

    get(provider) {
        return this._store.get(provider) || null;
    }

    remove(provider) {
        return this._store.delete(provider);
    }

    list() {
        return [...this._store.keys()].sort();
    }

    exists(provider) {
        return this._store.has(provider);
    }

    test() {
        return { ok: true };
    }

    location() {
        return "In-memory (test)";
    }

    // Test-only helper: clear all stored keys between tests.
    clear() {
        this._store.clear();
    }
}
