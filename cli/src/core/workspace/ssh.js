// SSH identity management for workspaces, via the same idempotent
// marker-block editor ssh clients already expect ~/.ssh/config to be
// hand-composed of `Host` blocks (see markerBlock.js). Honest scoping:
// unlike docker/kubernetes contexts, SSH has no single global "current
// identity" to switch - `ssh`/`git` resolve a key per remote host via
// `Host` alias matching, so every workspace's block coexists
// permanently in ~/.ssh/config rather than being torn down on switch;
// "activation" here means "this workspace's Host aliases are present
// and up to date," which is true immediately after `workspace create`/
// `save`, not something that only becomes true after a `switch`. Never
// touches private key *contents* - `identityFile` is always a path
// reference into the user's real ~/.ssh/, matching the platform's
// no-secrets-in-manifests rule from the cloud/AI modules.
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { homeDir } from "../paths.js";
import { runShellCommand, commandExists, shellQuote } from "../shell.js";
import { writeBlock, removeBlock, readBlock } from "./markerBlock.js";

// PROVIDER_DEFAULT_HOSTS - convenience defaults a create wizard/command
// can offer when a user picks a provider before typing a custom host;
// SSH identities are never restricted to only these three.
export const PROVIDER_DEFAULT_HOSTS = {
    github: "github.com",
    gitlab: "gitlab.com",
    bitbucket: "bitbucket.org"
};

function sshDir() {
    return path.join(homeDir(), ".ssh");
}

function sshConfigPath() {
    return path.join(sshDir(), "config");
}

function knownHostsPath() {
    return path.join(sshDir(), "known_hosts");
}

function blockId(workspaceName) {
    return `ssh-${workspaceName}`;
}

function buildHostBlock(identity) {
    const alias = identity.hostAlias || identity.host;
    const lines = [`Host ${alias}`, `    HostName ${identity.host}`];
    if (identity.user) lines.push(`    User ${identity.user}`);
    if (identity.identityFile) {
        lines.push(`    IdentityFile ${identity.identityFile}`);
        lines.push("    IdentitiesOnly yes");
    }
    if (identity.port) lines.push(`    Port ${identity.port}`);
    return lines;
}

// ensureKnownHost(host) -> { host, status } where status is one of
// "already-known" / "scanned" / "failed" / "skipped". Checks with
// `ssh-keygen -F` first so re-applying never appends duplicate entries
// to known_hosts.
async function ensureKnownHost(host, { onOutput } = {}) {
    const file = knownHostsPath();
    const alreadyKnown = await runShellCommand(`ssh-keygen -F ${shellQuote(host)} -f ${shellQuote(file)}`, { silent: true });
    if (alreadyKnown === 0) return { host, status: "already-known" };

    if (!(await commandExists("ssh-keyscan"))) {
        return { host, status: "skipped", reason: "ssh-keyscan is not available" };
    }
    mkdirSync(sshDir(), { recursive: true, mode: 0o700 });
    const code = await runShellCommand(`ssh-keyscan -H ${shellQuote(host)} >> ${shellQuote(file)} 2>/dev/null`, { onOutput, silent: !onOutput });
    return { host, status: code === 0 ? "scanned" : "failed" };
}

// applyWorkspaceSsh(workspace, { onOutput }) -> { identities, knownHosts }
// Writes (or, if the workspace declares no identities, removes) this
// workspace's ~/.ssh/config block, then ensures every declared
// `knownHosts` entry has a scanned host key.
export async function applyWorkspaceSsh(workspace, { onOutput } = {}) {
    const ssh = workspace.ssh || {};
    const identities = ssh.identities || [];
    const configPath = sshConfigPath();

    mkdirSync(sshDir(), { recursive: true, mode: 0o700 });

    if (identities.length > 0) {
        const lines = identities.flatMap((identity) => buildHostBlock(identity));
        writeBlock(configPath, blockId(workspace.name), lines, {
            header: [`# Workspace '${workspace.name}' - managed by 'devforgekit workspace switch/save'. Do not hand-edit; changes are lost on the next apply.`],
            backup: true,
            mode: 0o600
        });
    } else {
        removeBlock(configPath, blockId(workspace.name));
    }
    if (existsSync(configPath)) chmodSync(configPath, 0o600);

    const knownHosts = [];
    for (const host of ssh.knownHosts || []) {
        knownHosts.push(await ensureKnownHost(host, { onOutput }));
    }

    return { identities: identities.length, knownHosts };
}

// removeWorkspaceSsh(name) -> true if a block existed and was removed.
// Called when a workspace is deleted - its SSH identities should stop
// being offered once the workspace they belong to no longer exists.
export function removeWorkspaceSsh(name) {
    return removeBlock(sshConfigPath(), blockId(name));
}

// readWorkspaceSshBlock(name) -> the workspace's current ~/.ssh/config
// block text, or null if it has none. Used by health.js to detect drift
// (someone hand-edited ~/.ssh/config) and by tests.
export function readWorkspaceSshBlock(name) {
    return readBlock(sshConfigPath(), blockId(name));
}
