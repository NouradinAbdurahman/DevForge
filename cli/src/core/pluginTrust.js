// Plugin trust ledger: closes a real gap in the Ed25519 signing system
// (core/signing.js) - signature verification only ever happens inside
// installPlugin() (core/pluginSdk.js), transiently, against the original
// downloaded archive. Once extracted, a plugin is just a directory under
// plugins/ or ~/.devforgekit/plugins/, and discoverPlugins()
// (core/plugins.js) re-discovers it on every CLI startup with no
// re-verification at all - a plugin manually copied/synced into that
// directory (bypassing `plugin install` entirely) was getting its event
// hooks wired to the internal event bus and firing automatically on
// every relevant action, completely unattended, with not even a
// warning. Commands are different - a plugin command only ever runs
// when the user explicitly types its name, the same implicit consent as
// running any other local script by name - so this ledger gates event
// hooks (unattended execution) but never blocks command registration.
//
// Trust here means "this exact plugin content was accepted through the
// CLI's own install flow" (recordPluginTrust, called by installPlugin()
// after either a verified signature or an explicit user confirmation),
// not a cryptographic guarantee - the content hash just detects that the
// plugin changed since it was last accepted, so a tampered update still
// requires re-review.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { userConfigDir, repoRoot } from "./paths.js";

function trustLedgerPath() {
    return path.join(userConfigDir(), "plugin-trust.json");
}

function loadTrustLedger() {
    const file = trustLedgerPath();
    if (!existsSync(file)) return {};
    try {
        return JSON.parse(readFileSync(file, "utf8")) || {};
    } catch {
        return {};
    }
}

function saveTrustLedger(ledger) {
    const dir = userConfigDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(trustLedgerPath(), `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
}

// pluginContentHash(dir) -> sha256 hex digest over every file in the
// plugin's directory (path + content, sorted for determinism) so any
// change to plugin.yml or a hook script invalidates prior trust.
export function pluginContentHash(dir) {
    const hash = crypto.createHash("sha256");
    function walk(current, relBase) {
        let entries;
        try {
            entries = readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            const full = path.join(current, entry.name);
            const rel = path.join(relBase, entry.name);
            if (entry.isDirectory()) {
                walk(full, rel);
            } else if (entry.isFile()) {
                hash.update(rel);
                hash.update(readFileSync(full));
            }
        }
    }
    walk(dir, "");
    return hash.digest("hex");
}

// isPluginTrusted(name, dir) -> boolean. A plugin shipped in this repo's
// own plugins/ directory (part of the trusted distribution, same
// precedent as the in-repo registry being trusted while
// ~/.config/devforgekit is not) is always trusted. Otherwise, trusted
// only if its current content hash matches what was recorded the last
// time it was accepted through installPlugin().
export function isPluginTrusted(name, dir) {
    if (path.resolve(dir).startsWith(path.resolve(repoRoot(), "plugins") + path.sep)) {
        return true;
    }
    const ledger = loadTrustLedger();
    const entry = ledger[name];
    if (!entry) return false;
    return entry.contentHash === pluginContentHash(dir);
}

// recordPluginTrust(name, dir) - called by installPlugin() once a
// plugin has been accepted (verified signature, or an explicit "install
// anyway" confirmation for an unsigned/untrusted one) - never called
// automatically just because a plugin was discovered.
export function recordPluginTrust(name, dir) {
    const ledger = loadTrustLedger();
    ledger[name] = { contentHash: pluginContentHash(dir), trustedAt: new Date().toISOString() };
    saveTrustLedger(ledger);
}
