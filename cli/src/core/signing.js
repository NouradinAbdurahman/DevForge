// Real, working Ed25519 digital signatures for plugin packages (Node's
// built-in `node:crypto` - no fabrication), with an honest, narrow trust
// model: there is no certificate authority or marketplace registry yet
// (see docs/PlatformArchitecture.md's Plugin/Profile Marketplace
// Architecture, still design-only for that part). Trust today means
// "signed by a key this machine has been explicitly told to trust" -
// your own local key is trusted automatically; anyone else's public key
// has to be added via `trustKey()` (the `plugin trust <pubkey>` command)
// before its signature counts as trusted. A missing/untrusted signature
// is a warning requiring confirmation, not a silent pass - see
// installPlugin() in core/pluginSdk.js.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { userConfigDir } from "./paths.js";

function signingKeyPaths() {
    const dir = userConfigDir();
    return {
        dir,
        privateKeyPath: path.join(dir, "plugin-signing-key"),
        publicKeyPath: path.join(dir, "plugin-signing-key.pub")
    };
}

// ensureSigningKey() -> { privateKeyPem, publicKeyPem }. Generates a
// fresh Ed25519 keypair on first use (idempotent - reuses the existing
// one if present) at ~/.config/devforgekit/plugin-signing-key{,.pub}.
export function ensureSigningKey() {
    const { dir, privateKeyPath, publicKeyPath } = signingKeyPaths();
    if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
        return {
            privateKeyPem: readFileSync(privateKeyPath, "utf8"),
            publicKeyPem: readFileSync(publicKeyPath, "utf8")
        };
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });

    mkdirSync(dir, { recursive: true });
    writeFileSync(privateKeyPath, privateKeyPem, { mode: 0o600 });
    writeFileSync(publicKeyPath, publicKeyPem);

    return { privateKeyPem, publicKeyPem };
}

// signFile(filePath) -> base64-encoded Ed25519 signature of the file's
// raw bytes, using (and lazily creating) this machine's local key.
export function signFile(filePath) {
    const { privateKeyPem } = ensureSigningKey();
    const data = readFileSync(filePath);
    const signature = crypto.sign(null, data, privateKeyPem);
    return signature.toString("base64");
}

// verifyFile(filePath, signatureBase64, publicKeyPem) -> boolean
export function verifyFile(filePath, signatureBase64, publicKeyPem) {
    try {
        const data = readFileSync(filePath);
        const signature = Buffer.from(signatureBase64, "base64");
        return crypto.verify(null, data, publicKeyPem, signature);
    } catch {
        return false;
    }
}

function trustedKeysDir() {
    return path.join(userConfigDir(), "trusted-keys");
}

// loadTrustedKeys() -> [publicKeyPem, ...] - every key in
// ~/.config/devforgekit/trusted-keys/*.pub, plus this machine's own
// local public key (you always trust yourself).
export function loadTrustedKeys() {
    const keys = [];
    const { publicKeyPem } = ensureSigningKey();
    keys.push(publicKeyPem);

    const dir = trustedKeysDir();
    let entries;
    try {
        entries = readdirSync(dir).filter((f) => f.endsWith(".pub"));
    } catch {
        return keys;
    }
    for (const file of entries) {
        keys.push(readFileSync(path.join(dir, file), "utf8"));
    }
    return keys;
}

// trustKey(pubKeyPath, label) -> the path it was copied to. Adds a
// third-party public key to the trusted set.
export function trustKey(pubKeyPath, label) {
    const dir = trustedKeysDir();
    mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${label || path.basename(pubKeyPath, ".pub")}.pub`);
    writeFileSync(dest, readFileSync(pubKeyPath, "utf8"));
    return dest;
}

// isSignatureTrusted(filePath, signatureBase64) -> boolean - true if the
// signature verifies against ANY currently-trusted key.
export function isSignatureTrusted(filePath, signatureBase64) {
    return loadTrustedKeys().some((key) => verifyFile(filePath, signatureBase64, key));
}
