// Mock credential backend for CI environments (GitHub Actions, GitLab CI,
// etc.). Never touches OS APIs, never prompts, never blocks. Optionally
// logs operations to stderr for debugging CI runs.
import { CredentialBackend } from "../backend.js";
export class MockBackend extends CredentialBackend {
    constructor({ log = false } = {}) {
        super();
        this._store = new Map();
        this._log = log;
    }

    _logOp(action, provider, result) {
        if (this._log) {
            process.stderr.write(`[mock-cred] ${action} ${provider} → ${result}\n`);
        }
    }

    set(provider, key) {
        this._store.set(provider, key);
        this._logOp("save", provider, "ok");
    }

    get(provider) {
        const val = this._store.get(provider) || null;
        this._logOp("load", provider, val ? "found" : "miss");
        return val;
    }

    remove(provider) {
        const removed = this._store.delete(provider);
        this._logOp("delete", provider, removed ? "removed" : "absent");
        return removed;
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
        return "Mock (CI)";
    }
}
