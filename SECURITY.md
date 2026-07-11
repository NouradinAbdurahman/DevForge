# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a
public GitHub issue. Instead, email **<security@devforgekit.dev>** with:

1. A description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

You will receive a response within 48 hours. If the vulnerability is
confirmed, a fix will be prioritized and a GitHub Security Advisory will
be published. See `docs/Security.md` for the repository's own CI-level
security tooling (CodeQL, secret scanning, dependency review) — this
file is about the tool's behavior on the machine it runs on.

## Supported Versions

Security fixes are applied to `main` and included in the next release.

| Version | Supported |
| ------- | --------- |
| latest (main) | Yes |
| previous releases | Best effort |

## Supported platforms

DevForgeKit is a two-layer tool: Layer 1 (`bootstrap.sh`/`scripts/*.sh`)
is bash + Homebrew and is **macOS-only by design** — it's the layer that
provisions a machine before any of the CLI's own tooling exists. Layer 2
(the `cli/` Node CLI, everything this document's threat model below
covers) is genuinely cross-platform, but coverage is **not yet uniform**:
every one of the 261 registry packages has a verified macOS install path;
68 have a verified Linux path (apt/dnf/pacman) and 55 have a verified
Windows path (winget/choco/scoop) as of this writing. A package without
an explicit platform entry fails with a clear, honest
`PlatformNotSupportedError` rather than silently attempting a macOS-only
command — see `devforgekit registry audit` for current, live numbers.
Security fixes apply equally to all three OS code paths regardless of
this coverage gap.

## Threat model

DevForgeKit is a **local, single-user developer CLI**, not a hosted
service, multi-tenant system, or sandboxed execution environment. The
baseline assumption throughout the codebase is the same one every
package manager, shell config, and editor extension system makes: **the
person running this tool has already chosen to trust it with their own
account's privileges**, and the tool's job is to not make that trust
transitively worse (a malicious registry package, plugin, or shared
workspace bundle shouldn't be able to do more than a user could already
do by hand).

What this means concretely:

- **In scope**: command injection, path traversal, insecure temp files,
  weak crypto, privilege escalation *beyond* what an explicit install
  action already implies, and any place external content (a downloaded
  archive, a pasted API key, an AI provider's response, a shared
  workspace bundle) reaches a shell command, a file write, or automatic
  code execution without review.
- **Out of scope / explicitly not attempted**: sandboxing plugin or
  registry-package code from the rest of the filesystem/network (a
  plugin's `timeoutMs` — see `core/shell.js` — is resource/time
  isolation, never described as anything more); protecting against an
  attacker who already has local write access to the current user's
  `$HOME` (at that point they can edit `.zshrc`, cron, or any other
  auto-run location directly — DevForgeKit's own directories aren't a
  meaningfully larger attack surface than what's already there);
  defending against a fully malicious or compromised Homebrew/apt/dnf/
  pacman/winget/choco/scoop — DevForgeKit defers 100% to each package
  manager's own bottle/signature verification and never bypasses or
  duplicates it.

## Trust boundaries

The single most important fact for understanding what's safe to combine:
**registry packages (`registry/packages/*.yaml`) are loaded exclusively
from this repository's own tree, never from a user-writable directory.**
Everything else layers on top of that fixed point:

- **Registry packages** — the only place a package's `install`/
  `uninstall`/`validate`/`repair`/`update` fields (real shell commands,
  executed via `core/installer.js`) come from. Reviewed, in-repo content
  only; adding one requires a PR to this repository.
- **Profiles, recipes, collections** — resolved from *both* the in-repo
  registry and a user-writable root (`~/.config/devforgekit/`), but their
  schemas (`additionalProperties: false`) only allow arrays of package
  *names* plus a fixed `configure` action enum — they can select an
  unwanted subset of already-vetted packages, never introduce a new
  shell command. A hand-placed malicious profile is a nuisance, not an
  RCE.
- **Plugins** (`core/plugins.js`, `core/pluginSdk.js`) — commands only
  ever run when the user explicitly types their name (the same implicit
  consent as running any other local script), but **event hooks fire
  automatically and unattended** on real internal actions (e.g. every
  install). A plugin trust ledger (`core/pluginTrust.js`,
  `~/.config/devforgekit/plugin-trust.json`) gates this: a plugin's
  event hooks are only wired to the bus if it was accepted through
  `devforgekit plugin install` (signature verified, or an explicit
  "install anyway" confirmation) or ships in this repo's own `plugins/`.
  A plugin manually copied into place bypassing `plugin install` gets
  its commands registered (with a warning) but its event hooks are
  skipped entirely until reviewed. The content hash used for this is
  re-checked on every CLI startup, so editing an already-trusted
  plugin's files invalidates trust until it's reviewed again.
- **Workspace bundles** (`core/workspace/bundle.js`) — `.tar.gz` export/
  import is explicitly built for sharing a dev environment between
  machines or people. A bundle can declare `shell.aliases`/`functions`/
  `pathAdditions`, which become real, unattended shell code and PATH
  entries the moment `workspace switch` runs. Both `workspace bundle
  import` and `workspace bundle import --preview` print an explicit
  warning listing exactly what will be injected before it's ever applied
  to a real shell — review it the same way you'd review a shared
  `.zshrc`. Secrets and snapshot history are never included in a bundle
  by design (`WORKSPACE_TRANSFER_EXCLUDES`).
- **AI provider responses** — treated as untrusted input, not just
  untrusted network content: `ai generate`'s proposed project name goes
  through the same `validateProjectName()` gate as everything else
  reaching a generator's shell-interpolated scaffold command (see
  `core/projectGenerator.js`), regardless of which command triggered
  generation.
- **Downloads** — every network call in this codebase uses a fixed,
  vendor-owned HTTPS URL (never a mirror, never user-influenceable
  beyond an explicit `plugin install <url>`/`workspace bundle import
  <path>` argument) with TLS enforced (no `-k`/`--insecure`, no
  `rejectUnauthorized: false` anywhere). The four `curl | sh`-style
  installers in the registry (Homebrew, Bun, rustup, SDKMAN!) are each
  reproduced verbatim from that vendor's own official install
  instructions — see "Known limitations" below.

## Security measures in place

- **No shell-string command injection from external identifiers.**
  Every platform adapter (`core/platform/{base,macos,linux,windows}.js`)
  validates a package id/tap/upgrade-target against a strict allowlist
  (`assertSafePackageId`, `core/platform/errors.js`) before it's ever
  interpolated into a shell command — real package-manager identifiers
  never contain shell metacharacters, so this closes the class outright
  rather than trying to escape it for both POSIX shells and cmd.exe.
- **No shell-string injection from pasted secrets.** The macOS Keychain
  credential backend (`core/ai/credentials/backends/keychain.js`) uses
  `execFileSync` with an argv array, not a shell-interpreted string —
  a pasted API key can contain any character without ever escaping a
  quoted argument.
- **Project names are validated at one chokepoint.**
  `runProjectGenerator()` (`core/projectGenerator.js`) rejects anything
  outside `[a-zA-Z0-9._-]`, a reserved Windows device name, or a leading
  `.`/`-` before any generator's scaffold command runs — enforced for
  every caller (`devforgekit new`, `ai generate`, the TUI's
  GeneratorPage), not just the original CLI path.
- **Archive extraction is zip-slip-safe.** Every `tar -xzf` call site
  (workspace bundle import, plugin install, snapshot restore/diff/
  preview) lists an archive's entries first (`assertSafeTarArchive`,
  `core/archiveSafety.js`) and refuses to extract if any entry would
  escape the destination directory, before anything is written to disk.
- **Plugin event hooks require review** (see Trust boundaries above) —
  the Ed25519 signing system (`core/signing.js`) now actually gates
  unattended code execution, not just the one `plugin install` command
  path.
- **Workspace secrets use authenticated encryption correctly.**
  AES-256-GCM with the tag length pinned explicitly on both encrypt and
  decrypt (`core/workspace/env.js`) — a truncated/malformed auth tag is
  rejected outright rather than accepted at a weaker length.
- **Secret-bearing files are created with a restrictive mode atomically,
  not chmod'd after the fact** — closing the brief window (at the
  process's default umask) between a plaintext-secrets file being
  created and being restricted. Applies to workspace `vars.env`,
  `workspace-shell.sh`, `~/.ssh/config`'s managed blocks, and any `env
  export --include-secrets` destination.
- **`fs_safe_copy` (Layer 1, `scripts/common.sh`) is symlink-safe.**
  Writes go to a same-directory temp file and `mv` into place, so a
  destination swapped for a symlink between the existence check and the
  write can't redirect the copy to overwrite an arbitrary file.
- **No telemetry.** The `telemetry` config field exists but is
  unconsumed — no data leaves your machine.
- **No remote registry fetch.** Packages/profiles/recipes/collections
  are local YAML files, validated against JSON schemas (ajv) with
  referential integrity checks (`core/registry.js`'s `checkIntegrity`).
- **Dependency scanning.** `npm audit` (0 known vulnerabilities as of
  this writing), CodeQL, OSSF Scorecard, and dependency-review run in
  CI; Dependabot and Renovate watch dependencies.
- **Homebrew's own verification is never bypassed or duplicated.**
  DevForgeKit only ever calls `brew install`/`brew bundle install` and
  defers entirely to Homebrew's bottle/cask signature and checksum
  verification.

## Known limitations / accepted risk

Stated honestly rather than silently — the same standard this codebase
holds registry data and platform coverage to:

- **Plugin "sandboxing" is resource/time isolation, not a security
  boundary.** A `timeoutMs` kills a runaway hook; it does not restrict
  filesystem or network access. A trusted plugin's code runs with the
  same privileges as the user who trusted it, same as any local script.
- **`curl | sh` vendor installers.** `registry/packages/{brew,bun,rust,
  sdkman}.yaml` and `scripts/common.sh`'s `ensure_homebrew()` each
  reproduce that vendor's own official, documented install command
  (fixed HTTPS domain, TLS enforced) with no additional script-integrity
  check beyond what the vendor's own instructions carry — the well-known,
  industry-standard risk profile of that install pattern, not something
  specific to DevForgeKit.
- **cmd.exe quoting on Windows is allowlist-based, not escape-based.**
  Rather than attempting a complete cmd.exe quoting implementation
  (genuinely difficult even for dedicated tooling), Windows package
  identifiers are validated against the same strict allowlist every
  platform uses (see "Security measures" above) — content that doesn't
  look like a real package id is refused outright rather than escaped.
- **A user with local write access to their own `$HOME` can already do
  anything DevForgeKit could be tricked into doing** — this is treated
  as out of scope (see Threat model), consistent with every dotfile
  manager, shell plugin system, and package manager.
- **Linux/Windows registry coverage is partial** (see "Supported
  platforms"). This is a completeness gap, not a security one — an
  unsupported platform/package combination fails loudly with
  `PlatformNotSupportedError` rather than silently misbehaving.

## Scope

This policy covers the DevForgeKit repository and its CLI. It does not
cover third-party tools that DevForgeKit installs (Homebrew packages,
npm globals, VS Code/Cursor extensions, etc.) — those are the
responsibility of their respective maintainers.
