import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureSigningKey, signFile, verifyFile, isSignatureTrusted, trustKey } from "../src/core/signing.js";

// signing.js resolves ~/.config/devforgekit from process.env.HOME at call
// time (see userConfigDir in core/paths.js), so pointing HOME at a
// scratch directory isolates these tests from the developer's real
// signing key, same pattern config.test.js already uses.
function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-signing-test-"));
    process.env.HOME = tempHome;
    try {
        return fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

test("ensureSigningKey generates a keypair once and reuses it on subsequent calls", () => {
    withTempHome(() => {
        const first = ensureSigningKey();
        const second = ensureSigningKey();
        assert.equal(first.publicKeyPem, second.publicKeyPem);
        assert.match(first.publicKeyPem, /BEGIN PUBLIC KEY/);
        assert.match(first.privateKeyPem, /BEGIN PRIVATE KEY/);
    });
});

test("signFile/verifyFile round-trip: a genuine signature verifies against the matching public key", () => {
    withTempHome((tempHome) => {
        const filePath = path.join(tempHome, "artifact.txt");
        writeFileSync(filePath, "real content");

        const signature = signFile(filePath);
        const { publicKeyPem } = ensureSigningKey();
        assert.equal(verifyFile(filePath, signature, publicKeyPem), true);
    });
});

test("verifyFile rejects a signature against a tampered file", () => {
    withTempHome((tempHome) => {
        const filePath = path.join(tempHome, "artifact.txt");
        writeFileSync(filePath, "real content");
        const signature = signFile(filePath);

        writeFileSync(filePath, "tampered content");
        const { publicKeyPem } = ensureSigningKey();
        assert.equal(verifyFile(filePath, signature, publicKeyPem), false);
    });
});

test("isSignatureTrusted is true for a self-signed file (your own key is always trusted)", () => {
    withTempHome((tempHome) => {
        const filePath = path.join(tempHome, "artifact.txt");
        writeFileSync(filePath, "real content");
        const signature = signFile(filePath);
        assert.equal(isSignatureTrusted(filePath, signature), true);
    });
});

test("isSignatureTrusted is false for a signature from a key that hasn't been trusted", () => {
    withTempHome((tempHomeA) => {
        const filePath = path.join(tempHomeA, "artifact.txt");
        writeFileSync(filePath, "real content");
        const signature = signFile(filePath);

        // A second, separate identity (different HOME -> different key) has
        // no reason to trust the first identity's signature yet.
        withTempHome(() => {
            assert.equal(isSignatureTrusted(filePath, signature), false);
        });
    });
});

test("trustKey adds a third-party public key, after which its signatures are trusted", () => {
    // Author machine: sign a file with its own key, export the public key.
    const authorHome = mkdtempSync(path.join(tmpdir(), "devforgekit-signing-author-"));
    const originalHome = process.env.HOME;
    let signature;
    let authorPubKeyPath;
    let filePath;
    try {
        process.env.HOME = authorHome;
        filePath = path.join(authorHome, "artifact.txt");
        writeFileSync(filePath, "real content");
        signature = signFile(filePath);
        const { publicKeyPem } = ensureSigningKey();
        authorPubKeyPath = path.join(authorHome, "author.pub");
        writeFileSync(authorPubKeyPath, publicKeyPem);
    } finally {
        process.env.HOME = originalHome;
    }

    // Installer machine: untrusted until explicitly trusting the author's key.
    withTempHome(() => {
        assert.equal(isSignatureTrusted(filePath, signature), false);
        trustKey(authorPubKeyPath, "author");
        assert.equal(isSignatureTrusted(filePath, signature), true);
    });

    rmSync(authorHome, { recursive: true, force: true });
});
