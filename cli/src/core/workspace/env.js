// Workspace-local environment variables: a plaintext map for ordinary
// values (`workspace.env.variables`, part of workspace.json - included
// in exports/snapshots like everything else) plus a real, working
// AES-256-GCM encrypted store for secrets, keyed by a random 32-byte key
// generated per workspace on first use (mirrors core/signing.js's
// ensureSigningKey "generate on first use, 0600" pattern). workspace.json
// itself only ever records a secret's *name* in `env.secretKeys` - never
// its ciphertext or plaintext - so exporting/snapshotting/bundling a
// workspace document can never leak a secret value; only the
// `env/secrets.enc.json` sidecar (excluded from clone/bundle by
// store.js/bundle.js) and its sibling `env/secret.key` ever hold the
// real bytes. "Encrypted placeholder" (the PRD's term) is
// redactedEnvView() below: the display/export-safe stand-in for a secret
// value.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { workspaceDir } from "./store.js";
import { DevForgeError } from "../errors.js";

const ALGO = "aes-256-gcm";

function envDir(name) {
    return path.join(workspaceDir(name), "env");
}

function secretKeyPath(name) {
    return path.join(envDir(name), "secret.key");
}

function secretsFilePath(name) {
    return path.join(envDir(name), "secrets.enc.json");
}

function loadOrCreateKey(name) {
    const keyPath = secretKeyPath(name);
    mkdirSync(envDir(name), { recursive: true });
    if (existsSync(keyPath)) {
        return Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
    }
    const key = crypto.randomBytes(32);
    writeFileSync(keyPath, key.toString("base64"), { mode: 0o600 });
    return key;
}

function loadSecretsFile(name) {
    const file = secretsFilePath(name);
    if (!existsSync(file)) return {};
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    } catch {
        return {};
    }
}

function saveSecretsFile(name, secrets) {
    mkdirSync(envDir(name), { recursive: true });
    writeFileSync(secretsFilePath(name), `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
}

function encryptValue(key, plaintext) {
    const iv = crypto.randomBytes(12); // 96-bit IV, the GCM standard/recommended size
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
    return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

function decryptValue(key, entry) {
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(entry.iv, "base64"));
    decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, "base64")), decipher.final()]);
    return plaintext.toString("utf8");
}

// --------------------------------------------------------------------
// Secrets
// --------------------------------------------------------------------

// setSecret(workspace, key, value) -> updated document (caller must
// store.saveWorkspace() it - this module never writes workspace.json
// itself, only its own env/ sidecar files, matching git.js/ssh.js's
// "apply state, let the caller persist the document" split). A key is
// always either plain or secret, never both - promoting a key to secret
// removes any existing plaintext entry with the same name.
export function setSecret(workspace, key, value) {
    const secrets = loadSecretsFile(workspace.name);
    secrets[key] = encryptValue(loadOrCreateKey(workspace.name), value);
    saveSecretsFile(workspace.name, secrets);

    const secretKeys = workspace.env.secretKeys.includes(key) ? workspace.env.secretKeys : [...workspace.env.secretKeys, key];
    const variables = { ...workspace.env.variables };
    delete variables[key];
    return { ...workspace, env: { variables, secretKeys } };
}

export function removeSecret(workspace, key) {
    const secrets = loadSecretsFile(workspace.name);
    delete secrets[key];
    saveSecretsFile(workspace.name, secrets);
    return { ...workspace, env: { ...workspace.env, secretKeys: workspace.env.secretKeys.filter((k) => k !== key) } };
}

// getSecret(workspace, key) -> the decrypted plaintext, or null if the
// key isn't a declared secret, has no stored ciphertext, or fails to
// decrypt (e.g. the sidecar/key file was copied without the other).
export function getSecret(workspace, key) {
    if (!(workspace.env.secretKeys || []).includes(key)) return null;
    const entry = loadSecretsFile(workspace.name)[key];
    if (!entry) return null;
    try {
        return decryptValue(loadOrCreateKey(workspace.name), entry);
    } catch {
        return null;
    }
}

// getAllSecrets(workspace) -> { KEY: plaintext, ... } for every declared
// secret that decrypts successfully. This is the one function allowed
// to hold real secret plaintext in memory - callers (shellIntegration.js
// via switcher.js) use it only to materialize a *local*,
// mode-0600 file, never to print or transmit it.
export function getAllSecrets(workspace) {
    const result = {};
    for (const key of workspace.env.secretKeys || []) {
        const value = getSecret(workspace, key);
        if (value !== null) result[key] = value;
    }
    return result;
}

// redactedEnvView(workspace) -> { KEY: value | "<encrypted>" } - the
// PRD's "encrypted placeholder": every plain variable shown as-is, every
// secret shown as a fixed placeholder string. Safe for `workspace show`/
// `env list` output, logs, and anywhere else a human might see it.
export function redactedEnvView(workspace) {
    const view = { ...workspace.env.variables };
    for (const key of workspace.env.secretKeys || []) {
        view[key] = "<encrypted>";
    }
    return view;
}

// --------------------------------------------------------------------
// Plain variables
// --------------------------------------------------------------------

export function setVariable(workspace, key, value) {
    if ((workspace.env.secretKeys || []).includes(key)) {
        throw new DevForgeError(`'${key}' is a secret in this workspace - use setSecret (or 'workspace env set --secret') instead.`);
    }
    return { ...workspace, env: { ...workspace.env, variables: { ...workspace.env.variables, [key]: String(value) } } };
}

export function removeVariable(workspace, key) {
    const variables = { ...workspace.env.variables };
    delete variables[key];
    return { ...workspace, env: { ...workspace.env, variables } };
}

// --------------------------------------------------------------------
// .env file format (parse/serialize) + import/export
// --------------------------------------------------------------------

// parseEnvFile(content) -> { KEY: value }. Accepts the common real-world
// dotenv dialect: blank/`#`-comment lines ignored, an optional leading
// `export `, and single- or double-quoted values (unquoted otherwise).
export function parseEnvFile(content) {
    const vars = {};
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const withoutExport = line.startsWith("export ") ? line.slice("export ".length) : line;
        const eq = withoutExport.indexOf("=");
        if (eq === -1) continue;
        const key = withoutExport.slice(0, eq).trim();
        let value = withoutExport.slice(eq + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) {
            // Reverses dotenvQuote()'s escaping exactly (it only ever
            // backslash-escapes `\` and `"` before wrapping in double
            // quotes) - without this, a value containing either
            // character would come back from a round trip still bearing
            // its escaping backslashes.
            value = value.slice(1, -1).replace(/\\(.)/g, "$1");
        } else if (value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1);
        }
        if (key) vars[key] = value;
    }
    return vars;
}

function dotenvQuote(value) {
    const str = String(value);
    if (/^[A-Za-z0-9_.\-/:@]*$/.test(str)) return str;
    return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// serializeEnvFile({ KEY: value }) -> dotenv-format text, one `KEY=value`
// line per entry (values quoted only when they contain characters that
// would otherwise be ambiguous in a shell-sourced .env file).
export function serializeEnvFile(vars) {
    const lines = Object.entries(vars).map(([key, value]) => `${key}=${dotenvQuote(value)}`);
    return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

// importEnvFile(workspace, filePath, { secretKeys }) -> updated document
// (caller must saveWorkspace()). Every parsed key is set as a plain
// variable unless it's listed in `secretKeys`, in which case it's
// encrypted via setSecret() instead.
export function importEnvFile(workspace, filePath, { secretKeys = [] } = {}) {
    if (!existsSync(filePath)) {
        throw new DevForgeError(`No such file: ${filePath}`);
    }
    const parsed = parseEnvFile(readFileSync(filePath, "utf8"));
    let doc = workspace;
    for (const [key, value] of Object.entries(parsed)) {
        doc = secretKeys.includes(key) ? setSecret(doc, key, value) : setVariable(doc, key, value);
    }
    return doc;
}

// exportEnvFile(workspace, filePath, { includeSecrets }) -> filePath.
// Writes a standalone .env file anywhere on disk (e.g. into a project
// directory for `docker-compose --env-file`) - `includeSecrets: true`
// decrypts real values into it, so callers should treat the destination
// like any other plaintext secrets file (gitignore it, etc.).
export function exportEnvFile(workspace, filePath, { includeSecrets = false } = {}) {
    const vars = { ...workspace.env.variables, ...(includeSecrets ? getAllSecrets(workspace) : {}) };
    writeFileSync(filePath, serializeEnvFile(vars));
    return filePath;
}

// writeWorkspaceEnvFile(workspace) -> the regenerated path
// `<workspace dir>/env/vars.env`, always overwritten (never hand-edited,
// same convention as shellIntegration.js's workspace-shell.sh) and
// mode 0600. Includes decrypted secrets by design - this file's entire
// purpose is being a real, ready-to-use `--env-file` for tools like
// docker-compose, the same accepted plaintext-on-disk tradeoff every
// `.env`/direnv workflow already makes.
export function writeWorkspaceEnvFile(workspace) {
    mkdirSync(envDir(workspace.name), { recursive: true });
    const filePath = path.join(envDir(workspace.name), "vars.env");
    const vars = { ...workspace.env.variables, ...getAllSecrets(workspace) };
    writeFileSync(filePath, serializeEnvFile(vars));
    chmodSync(filePath, 0o600);
    return filePath;
}
