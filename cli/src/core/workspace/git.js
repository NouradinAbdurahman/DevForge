// Real, global git identity management for workspaces. `git config
// --global` is the actual mechanism most multi-identity workflows
// already use to switch "who am I" on a machine, so applying a
// workspace's `git` block runs real `git config --global` calls -
// `git config` already owns safe, idempotent editing of ~/.gitconfig, so
// this deliberately does not reinvent that as a marker-block file
// rewrite (contrast core/workspace/ssh.js, which edits a file git config
// has no concept of). Honest scoping: aliases are additive/update-only -
// applying a workspace never removes an `alias.*` entry it didn't itself
// declare, since global git aliases are ordinary user-owned state, not
// something a workspace switch should silently delete just because the
// newly-active workspace doesn't mention it. `lfs: true` runs a real,
// global `git lfs install --skip-repo`; `lfs: false` is intentionally a
// no-op (never a forced `git lfs uninstall`, which would affect every
// other repo on the machine, not just this workspace).
import { runShellCommand, captureShellCommand, commandExists, shellQuote } from "../shell.js";

async function gitConfigGet(key) {
    const { code, stdout } = await captureShellCommand(`git config --global --get ${key}`);
    return code === 0 ? stdout.trim() || null : null;
}

// gitConfigUnset(key) -> true if the key ends up unset (exit 0 means it
// was removed; exit 5 means it was already unset - both are success).
async function gitConfigUnset(key, { onOutput } = {}) {
    const code = await runShellCommand(`git config --global --unset ${key}`, { onOutput, silent: !onOutput });
    return code === 0 || code === 5;
}

async function captureGitAliases() {
    const { code, stdout } = await captureShellCommand("git config --global --list");
    if (code !== 0) return {};
    const aliases = {};
    for (const line of stdout.split("\n")) {
        if (!line.startsWith("alias.")) continue;
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        aliases[line.slice("alias.".length, eq)] = line.slice(eq + 1);
    }
    return aliases;
}

// captureGitIdentity() -> the live global git config, shaped exactly
// like a workspace's `git` block - used by `workspace capture`/`create
// --from-current` to seed a new workspace from whatever is already
// configured on this machine, the same "export what's real" pattern
// core/commands/profile.js's `export` uses for installed components.
export async function captureGitIdentity() {
    const [name, email, signingKey, defaultBranch, hooksPath, credentialHelper] = await Promise.all([
        gitConfigGet("user.name"),
        gitConfigGet("user.email"),
        gitConfigGet("user.signingkey"),
        gitConfigGet("init.defaultBranch"),
        gitConfigGet("core.hooksPath"),
        gitConfigGet("credential.helper")
    ]);
    const [aliases, lfs] = await Promise.all([captureGitAliases(), commandExists("git-lfs")]);
    return { name, email, signingKey, defaultBranch, hooksPath, aliases, credentialHelper, lfs };
}

// applyWorkspaceGit(workspace, { onOutput }) -> [{ key, action, ok, reason? }, ...]
// Applies every field of `workspace.git` to the real, global git config.
// A field set to null/undefined/"" is unset rather than skipped, so
// switching from a workspace that set `signingKey` to one that doesn't
// actually clears it - "switching" must be able to turn fields off, not
// only on.
export async function applyWorkspaceGit(workspace, { onOutput } = {}) {
    const git = workspace.git || {};
    const results = [];

    async function apply(key, value) {
        if (value === null || value === undefined || value === "") {
            results.push({ key, action: "unset", ok: await gitConfigUnset(key, { onOutput }) });
            return;
        }
        const code = await runShellCommand(`git config --global ${key} ${shellQuote(value)}`, { onOutput, silent: !onOutput });
        results.push({ key, action: "set", ok: code === 0 });
    }

    await apply("user.name", git.name);
    await apply("user.email", git.email);
    await apply("user.signingkey", git.signingKey);
    await apply("commit.gpgsign", git.signingKey ? "true" : null);
    await apply("init.defaultBranch", git.defaultBranch);
    await apply("core.hooksPath", git.hooksPath);
    await apply("credential.helper", git.credentialHelper);

    for (const [name, command] of Object.entries(git.aliases || {})) {
        await apply(`alias.${name}`, command);
    }

    if (git.lfs === true) {
        if (await commandExists("git-lfs")) {
            const code = await runShellCommand("git lfs install --skip-repo", { onOutput, silent: !onOutput });
            results.push({ key: "lfs", action: "install", ok: code === 0 });
        } else {
            results.push({ key: "lfs", action: "install", ok: false, reason: "git-lfs is not installed" });
        }
    }

    return results;
}
