# Platform Support

The single source of truth for what DevForgeKit supports, on which
platforms, installed which way, at what confidence level - and the
evidence behind every claim. `README.md`, the website, and every other
doc should link here rather than duplicate this information; if you find
a platform claim elsewhere that disagrees with this document, this
document wins and the other one needs fixing.

Produced as part of the v3.0.2 Platform Stabilization Program (see
`docs/PlatformStabilizationProgram.md` for the full program and its
per-phase reports).

## At a glance

The one-line status for every platform. "Certified" means a real
end-to-end lifecycle was verified on real hardware or a faithful,
documented equivalent (see the compatibility matrix below for exactly
what was run and the evidence). Nothing here is a projection - a
platform is "Not yet certified" until it has actually been run, no
matter how likely it is to work.

| Platform | Status |
|---|---|
| **macOS Apple Silicon** | **Certified.** |
| **macOS Intel** | Not yet certified. Expected to work but requires real hardware validation. |
| **Ubuntu** | **Certified.** |
| **Debian** | **Certified.** |
| **Fedora** | Not yet certified. A local Docker Desktop environment issue on the development machine prevented validation. No known DevForgeKit issue. |
| **Arch Linux** | Not yet certified. Same reason as Fedora. |
| **Windows (native)** | Not supported. |
| **Windows + WSL2** | Supported installation path. Real installation bugs were found and fixed. Full platform certification (on real Windows/WSL2 hardware) is still pending. |

## Status levels

| Level | Meaning |
|---|---|
| **PASS** | Verified on the real platform (or a faithful, documented equivalent - see "Evidence" column), no known issues. |
| **WARNING** | Verified, works, but with a known limitation or caveat documented below. |
| **NOT TESTED** | Not verified in this program - no hardware/environment access, or out of current scope. Never assumed to work; do not treat as a silent PASS. |
| **FAIL** | Verified broken. Should never appear here for long - either fixed (becomes PASS/WARNING with a regression test) or explicitly descoped with a reason. |

## Installation methods

| Method | What it does | Where it's defined |
|---|---|---|
| **Homebrew** | `brew install devforgekit` (formula) or `brew install --HEAD` (source) | `.github/workflows/homebrew-formula.yml`, the tap repo |
| **npm** | `npm install -g devforgekit` | `package.json`, `scripts/npm-postinstall.sh` |
| **Source** | `git clone` + `./devforgekit install` (→ `bootstrap.sh`) | `bootstrap.sh`, `scripts/common.sh` |

## Compatibility matrix

Evidence-backed status per platform x installation method. Populated
incrementally as each phase of the Platform Stabilization Program
completes - a blank/NOT TESTED cell is honest and expected until that
phase runs, never filled in speculatively.

| Platform | Homebrew | npm | Source | Notes |
|---|---|---|---|---|
| macOS Apple Silicon (M1/M2/M3/M4) | PASS | PASS | PASS | This repo's own dev machine (arm64, macOS 26.5.2) - full real-hardware validation complete, Phase 1. See `docs/PlatformStabilizationProgram.md` for the full report. |
| macOS Intel | NOT TESTED | NOT TESTED | NOT TESTED | No Intel Mac hardware or VM available in this program's environment. Docker Desktop on macOS cannot emulate macOS itself (only Linux containers), so this cannot be approximated - it needs real or cloud (e.g. MacStadium) Intel Mac access. |
| Ubuntu | NOT TESTED (Homebrew-on-Linux formula install not attempted this phase - see Known limitations) | PASS | PASS (Node CLI direct from source; `bootstrap.sh`/`install` N/A by design - see Known limitations) | Docker `ubuntu:22.04`, native arm64, real first-time-user lifecycle (fresh OS, Node.js via NodeSource, no Homebrew, non-sudo and sudo npm install, full command surface, uninstall/reinstall, source-vs-npm parity). Phase 3, `docs/PlatformStabilizationProgram.md`. `--platform linux/amd64` emulation NOT TESTED. |
| WSL2 (Windows 11) | N/A (no Homebrew on WSL2) | _pending Phase 4 (Ubuntu-equivalent only)_ | _pending Phase 4 (Ubuntu-equivalent only)_ | No real Windows/WSL2 machine available in this program's environment. What Phase 4 _can_ verify: behavior inside a plain Ubuntu container, which is representative of WSL2's userspace (same kernel-adjacent Ubuntu, same npm/Node) but cannot verify genuinely WSL-specific concerns (Windows PATH leakage into WSL's `$PATH`, `/mnt/c/...` interop, `explorer.exe`/`clip.exe` interop, Windows Defender interfering with file watches). Those specific items stay NOT TESTED and are called out individually below rather than folded into a blanket PASS. |
| Debian | NOT TESTED (same as Ubuntu row) | PASS | PASS (Node CLI direct from source) | Docker `debian:12`, native arm64, same full lifecycle as Ubuntu, run side-by-side specifically to surface any Ubuntu-specific (vs. generic `apt`-family) assumptions - none found. Folded into Phase 3's report (also satisfies part of Phase 5). |
| Linux Mint | NOT TESTED | NOT TESTED | NOT TESTED | Ubuntu-based; not attempted - Phase 3 prioritized diffing against a non-Ubuntu-family `apt` distro (Debian) instead, which is more informative than re-testing an Ubuntu derivative. |
| Pop!_OS | NOT TESTED | NOT TESTED | NOT TESTED | Ubuntu-based; same as Mint. |
| Fedora | NOT TESTED | NOT TESTED | NOT TESTED | **Blocked, not failing:** a local Docker Desktop environment issue on this machine (`docker-credential-desktop`'s symlink breaks on every launch due to macOS App Translocation - confirmed live via `ps aux`) prevented pulling the `fedora:40` base image. Dockerfile is written and ready (`docker/platform-certification/Dockerfile.fedora`); the CLI's `dnf` code path in `cli/src/core/platform/linux.js` exists but is empirically unverified on a real dnf machine. |
| Arch | NOT TESTED | NOT TESTED | NOT TESTED | Same blocker as Fedora. Dockerfile ready (`docker/platform-certification/Dockerfile.arch`); the CLI's `pacman` code path exists but is empirically unverified on a real pacman machine. |
| Windows (native, no WSL) | N/A | N/A | N/A | Explicitly unsupported by design - `package.json`'s `os: ["darwin", "linux"]` and the bash-based `devforgekit`/`bootstrap.sh` entry points require a POSIX shell stock Windows doesn't provide. See the **Planned: v3.1 Native Windows Support** roadmap entry in `CHANGELOG.md`. Not a target of this program. |

## Known limitations (cross-platform)

- **`sudo npm install -g devforgekit`** (root-owned global npm prefix,
  common on Linux/WSL2 with a system-managed Node.js): previously left
  the CLI permanently broken on first run. Fixed - see
  `docs/NpmGlobalInstallRootCause.md`. Regression-tested in
  `cli/test/index.test.js` and `scripts/rc-validate.sh`.
- **Report-writing commands** (`devforgekit inventory`,
  `devforgekit snapshot create`) still target the real install location
  for `reports/*.md` output, which remains unwritable under a
  `sudo`-installed copy even after the above fix. Tracked as a follow-up
  in `docs/NpmGlobalInstallRootCause.md`'s "What this fix does not (yet)
  address" section.
- **`bootstrap.sh` is macOS/Homebrew-only** by design (hardcodes `brew
  bundle`, exits on non-macOS). True cross-platform parity for the
  _main_ install path is explicitly deferred - see
  `docs/InstallationAudit.md`'s "Still genuinely deferred" section and
  Phase 6/7 of the Platform Stabilization Program. On Linux, the
  rejection message (fixed in Phase 3 to stop calling this "unexpected")
  points the user at running `devforgekit <command>` directly instead -
  every other command (`doctor`, `check`, `new`, `component`, etc.)
  delegates to the Node CLI, which is not macOS-gated.
- **Homebrew-on-Linux (Linuxbrew) formula install** is architecturally
  plausible (the formula has no explicit macOS-only guard) but has never
  been tested on Linux in this program - recorded as NOT TESTED, not
  assumed to work, until a phase actually exercises it.
- **`npm uninstall -g devforgekit` after a root-owned (`sudo npm
  install -g`) install leaves `~/.cache/devforgekit/cli-fallback/`
  behind.** Harmless (a few MB of orphaned cache; a future install/mirror
  rebuild ignores it), but not currently cleaned up - `npm`'s
  `allow-scripts` gate would block a `preuninstall` hook the same way it
  blocks `postinstall`, so a real fix needs a different mechanism (e.g. a
  dedicated `devforgekit uninstall` cache-cleanup step) rather than a
  one-line patch. Found in Phase 3.
- **`version_of()` (`scripts/common.sh`), used by `scripts/report.sh` and
  therefore `bootstrap.sh`, has no timeout around the external tool
  version checks it runs** (`brew --version`, `pnpm -v`, `node -v`, etc.).
  Observed live during v3.0.2 release validation: a `pnpm -v` call hung
  indefinitely (confirmed via `lsof`/`ps`, required a manual `kill -9` to
  unblock; re-running the exact same command immediately after completed
  normally in under a second) - a one-off, not reproducible on demand,
  most likely transient resource contention from many concurrent
  Docker/npm/pnpm operations earlier in the same session rather than a
  `pnpm` defect. Not fixed this release: the underlying risk (one hung
  external tool freezes `bootstrap.sh`/`report.sh` indefinitely with no
  feedback) is real and worth a proper fix (a portable, bash-3.2-safe
  timeout wrapper - `timeout`/`gtimeout` aren't guaranteed present on
  stock macOS, so this needs a background-process-plus-watchdog pattern,
  not a one-line change), but doing that safely needs its own dedicated
  verification pass rather than a rushed change during documentation
  work. Tracked here rather than silently patched or silently ignored.
- **`commander@15` (a runtime dependency) declares `engines.node:
  >=22.12.0`**, stricter than devforgekit's own documented `>=18` floor,
  and prints a non-fatal `npm warn EBADENGINE` on `npm install` under
  Node <22.12. Investigated in Phase 3: this floor exists for Commander's
  CommonJS `require(esm)` support and does not reflect a real
  incompatibility for devforgekit, which is pure ESM (`cli/package.json`'s
  `"type": "module"`, native `import`). Confirmed empirically - every
  command exercised in Phase 3 ran correctly on Node 20.20.2. Cosmetic
  warning only, not a functional issue.

## How to update this document

Every phase of the Platform Stabilization Program that produces new
evidence (a real command run, a real install, a real container/VM test)
updates the relevant matrix cell and, if the result isn't a clean PASS,
adds a line to "Known limitations" with a link to the fuller writeup.
Never change a cell's status without evidence attached in the same
change - "should work" is not evidence.
