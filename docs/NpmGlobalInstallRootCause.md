# Root Cause: `npm install -g devforgekit` + first run failing on Linux/WSL2

A root-cause investigation of a real, reproduced installation failure:
`sudo npm install -g devforgekit` succeeds, but the first `devforgekit`
invocation fails with:

```
Setting up the DevForgeKit CLI (first run only)...
Automatic setup failed - run:

cd "/usr/lib/node_modules/devforgekit/cli" && npm install
```

...and running that exact suggested command fails with the identical error.

## Environment reproduced

- Ubuntu 22.04 (Docker container, standing in for WSL2 Ubuntu - see
  "Is this WSL-specific?" below for why the container is representative)
- Node.js 20.20.2 via NodeSource's `nodejs` apt package, npm upgraded to
  11.18.0 (`npm install -g npm@11`) to match the reporter's exact npm
  warning text
- A non-root `testuser`, `sudo npm install -g devforgekit`

This reproduces the reporter's exact output verbatim, including the
`npm warn allow-scripts` text.

## The two root causes

This is not one bug - it's two independent problems that compound.

### 1. npm 11.16+'s `allow-scripts` gate silently skips the postinstall script

`package.json`'s `postinstall` (`scripts/npm-postinstall.sh`) is
responsible for populating `cli/node_modules` at install time. As of npm
11.16 (widely deployed; npm v12, expected July 2026, makes this the
unconditional default - see
[npm/cli#9463](https://github.com/npm/cli/issues/9463) and the GitHub
Changelog's ["Upcoming breaking changes for npm
v12"](https://github.blog/changelog/2026-06-09-upcoming-breaking-changes-for-npm-v12/)),
global installs' lifecycle scripts are gated behind an `allowScripts`
approval mechanism, and - critically - **`npm approve-scripts` does not
work for global installs at all** (confirmed: `EGLOBAL npm approve-scripts
does not work for global installs`, npm/cli#9463). There is effectively no
user-facing way to approve a global install's postinstall script.

**Evidence, not assumption** - reproduced verbatim:

```
$ sudo npm install -g devforgekit

added 1 package in 2s
npm warn allow-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn allow-scripts   devforgekit@3.0.1 (postinstall: scripts/npm-postinstall.sh)
npm warn allow-scripts
npm warn allow-scripts Run `npm install -g --allow-scripts=devforgekit` to allow these scripts once, or `npm config set allow-scripts=devforgekit --location=user` to allow them for all global installs.

$ ls /usr/lib/node_modules/devforgekit/cli/node_modules
ls: cannot access '.../cli/node_modules': No such file or directory
```

`scripts/npm-postinstall.sh` genuinely never executed. This confirms
investigation items 1 and 2 from the original report: yes, the
allow-scripts gate blocked it, and no, the script did not run.

This is *expected*, not a bug to fix upstream - it's why
`self_heal_cli_deps()` (the `devforgekit` dispatcher's runtime fallback)
already existed before this investigation, specifically anticipating
that a postinstall script can't be relied on. See its comment in the
`devforgekit` file for the earlier discovery of this exact gate.

### 2. `sudo` leaves the install directory root-owned, defeating the runtime self-heal

Since the postinstall script can't be relied on, the `devforgekit`
dispatcher has always had a fallback: `self_heal_cli_deps()` notices
`cli/node_modules` is missing on first run and tries to `npm install` it
lazily. This is investigation items 7 and 8 - yes, the CLI already tries
to lazily install its own dependencies and already tries to detect and
recover from a blocked lifecycle script.

The problem is *how* that recovery attempt failed. `sudo npm install -g`
installs as root, so `/usr/lib/node_modules/devforgekit/cli` is
root-owned. `self_heal_cli_deps()` then runs as the *invoking, unprivileged*
user - and hits a permission wall:

```
$ cd /usr/lib/node_modules/devforgekit/cli && npm install --omit=dev --no-audit --no-fund

npm error code EACCES
npm error Error: EACCES: permission denied, mkdir '/usr/lib/node_modules/devforgekit/cli/node_modules'
npm error   errno: -13,
npm error   syscall: 'mkdir'
```

This answers investigation item 6 directly: automatic recovery failed
because it never accounted for the possibility that the directory it
needs to write into isn't owned by the user running it. The message the
old code printed as "the fix" (`cd ... && npm install`, no `sudo`) hits
the *identical* `EACCES` - confirmed by running it verbatim - so the
suggested recovery path never actually worked either.

## Investigation checklist (mapped to the original 12 questions)

1. **Did npm 11's allow-scripts model block the postinstall script?** Yes,
   confirmed live (see above). This is real, current npm behavior, not
   assumed.
2. **Did the postinstall script actually execute?** No - `cli/node_modules`
   was absent immediately after a successful `sudo npm install -g`.
3. **Is the published package missing runtime dependencies?** No.
   `npm pack --dry-run` in the repo, a real `npm pack`, and the tarball
   already live on the npm registry were byte-for-byte compared: `cli/
   package.json` and `cli/package-lock.json` (which fully declare every
   runtime dependency) are present and identical in all three. Nothing
   is missing from the package; the dependencies just aren't *installed*
   yet at that point, by design (see next item).
4. **Is `cli/node_modules` intentionally excluded from the package?** Yes
   - deliberately, matching ordinary npm package conventions (you don't
   ship a package's own `node_modules`). `package.json`'s `files` array
   lists `cli/package.json` and `cli/package-lock.json` but not
   `cli/node_modules`; there's no `.npmignore` overriding this.
5. **Does the runtime incorrectly assume `cli/node_modules` already
   exists?** No - `cli_available()` in the `devforgekit` dispatcher
   already checked for it and already had a fallback
   (`self_heal_cli_deps`) for exactly the case where it's missing. The
   assumption that was wrong was narrower: that fallback assumed it could
   always *write* to `cli/`'s own location, which fails specifically
   under a `sudo`-owned install.
6. **Why did automatic recovery fail?** `EACCES: permission denied` -
   see above. Not a network problem, not a missing-npm problem, not an
   allow-scripts problem the second time around - a plain filesystem
   permission mismatch between who owns the directory and who is running
   the command.
7. **Should the CLI lazily install its own dependencies when missing?**
   It already did (`self_heal_cli_deps`). The fix is making that lazy
   install survive the one condition it didn't previously handle.
8. **Should the CLI detect blocked lifecycle scripts and auto-recover?**
   It already tried to. The fix adds a second, permission-proof recovery
   tier instead of a fundamentally different detection mechanism - the
   detection (missing `cli/node_modules`) was already correct.
9. **Is this WSL-specific, or can it happen on Linux and macOS too?** Not
   WSL-specific. Reproduced identically on plain Ubuntu 22.04 in Docker
   (no WSL involved at all), and the underlying `EACCES` was additionally
   reproduced directly on macOS by `chmod`-ing a target directory to
   remove the current user's write bit and running a non-root
   `npm install --prefix` against it - the identical error appears. The
   condition is "does this npm global prefix require root to write into
   it, and was the package actually installed with elevated privileges,"
   which correlates strongly with Linux/WSL2 (where a system-managed
   Node.js's global prefix is commonly `/usr`, requiring `sudo`) but is
   not exclusive to it. A macOS user using a system-provided Node.js the
   same way would hit the same failure.
10. **Compare repository source, `npm pack`, the published package, and
    the installed package.** All four compared directly (`npm pack
    --dry-run`, a real `npm pack`, `npm pack devforgekit@3.0.1` against
    the live registry, and the actual installed tree under
    `/usr/lib/node_modules/devforgekit`): identical file content and
    identical file sizes throughout, and `scripts/npm-postinstall.sh`
    keeps its executable bit (`-rwxr-xr-x`) in the published tarball.
    There is no packaging discrepancy anywhere in this pipeline - the
    failure is entirely a runtime/permissions issue, not a publishing bug.
11. **Reproduce from a completely clean environment.** Done - a fresh
    `ubuntu:22.04` container, apt-installed Node.js, npm upgraded to
    11.18, a freshly created non-root user, `sudo npm install -g
    devforgekit`. See "Environment reproduced" above.
12. **Add regression tests.** Done - see below.

## Why previous testing missed this

`scripts/rc-validate.sh` - the project's real, artifact-level release
gate - already runs a real `npm install -g` against a real tarball before
every release:

```sh
mkdir -p "$RC_SCRATCH/npm-prefix" ...
npm install -g "$tarball" --prefix "$RC_SCRATCH/npm-prefix"
```

That `--prefix` always points at a scratch directory `rc-validate.sh`
itself just created, as the same non-root user who's running the script.
It is structurally incapable of ever being root-owned. So even though
this check would still hit the *first* root cause (the allow-scripts gate
would still skip the postinstall script during this test, same as for a
real user), the *second* root cause - a root-owned directory defeating
the self-heal fallback - could never surface, because the one condition
that causes it (an unprivileged self-heal attempt against a directory it
doesn't own) never existed in the test. The release gate was validating
"self-heal works when the directory is writable," which is true, but
never validated "self-heal must also survive when it isn't" - the actual
default condition for a large fraction of real Linux/WSL2 installs, where
a system-managed Node.js's global prefix requires `sudo`.

## The fix

`self_heal_cli_deps()` (in the `devforgekit` root dispatcher) now tries
two recovery tiers, in order:

1. **In place**, in `cli/` itself - unchanged from before, and still the
   common/fast path whenever that directory is writable (a repo clone,
   the Homebrew Cellar, or any npm global prefix the user already owns
   without `sudo`).
2. **A user-writable mirror**, at
   `~/.cache/devforgekit/cli-fallback/<hash of the real install path>/`,
   used only when (1)'s directory isn't writable. This mirrors the whole
   repository root, not just `cli/`, because `cli/src/core/paths.js`'s
   `repoRoot()` - which many modules use to locate `registry/`, `docs/`,
   `profiles/`, `scripts/`, `Brewfile`, `VERSION`, etc. - computes the
   repo root purely from its *own* file's on-disk location. A naive
   "just copy `cli/bin` and `cli/src` somewhere else" would have silently
   broken every one of those lookups.
   - `cli/bin` and `cli/src` are **real copies**, not symlinks. Node's
     module resolver, by default, resolves a symlinked module back to
     its real filesystem path before searching for `node_modules` -
     which would walk straight back to the original, still-unwritable
     `cli/node_modules` and defeat the entire fallback. A real copy has
     no such resolution quirk.
   - Every *other* top-level entry is a plain symlink back to the real
     install. Those are read through ordinary `fs` calls (`readFileSync`/
     `readdirSync`), which follow symlinks correctly with no such caveat,
     and symlinking keeps the mirror automatically current with the real
     install (no separate sync step, no staleness for anything except
     the two directories that were actually copied).
   - A `.mirrored-version` marker (compared against the real `VERSION`
     file on every invocation) invalidates and rebuilds the mirror after
     `npm update -g devforgekit` ships new `cli/src` - so the fallback
     can't silently keep running stale code forever.
   - The failure message, if even the fallback can't succeed (no network,
     no npm), now correctly names the real cause and a command that
     actually works (`sudo npm install --omit=dev --prefix ".../cli"`, or
     `sudo chown -R "$(id -un)" ".../cli"`), instead of the old
     `cd ... && npm install` suggestion that failed with the identical
     `EACCES` as the automatic attempt it was supposedly fixing.

### What this fix does not (yet) address

A few features that *write* into the repository root - most notably
`devforgekit inventory`'s and `devforgekit snapshot create`'s
`reports/*.md` output - still target the real install location, which
remains unwritable under a `sudo`-installed copy even after this fix
(the fallback mirror's symlinked `reports/` entry points straight back
at the same unwritable directory). This is a narrower problem than the
core ask here (`npm install -g devforgekit && devforgekit` must work with
no manual steps, which this fix delivers) and is tracked as a follow-up
rather than folded into this change.

## Regression tests

Four new tests in `cli/test/index.test.js`, all fast and network-free
(a fake `npm` on `PATH` symlinks in this repo's own already-installed
`cli/node_modules` instead of hitting the real registry, so the tests
stay deterministic in CI while still exercising the real chmod/dispatch/
exec logic end to end):

- The dispatcher falls back to the mirror and successfully delegates to
  the Node CLI when `cli/` is `chmod`'d unwritable (a plain `chmod`
  produces the identical `EACCES`/`-w` failure a root-owned directory
  does, with no `sudo` needed in a test environment).
- The mirror correctly resolves a `repoRoot()`-relative lookup
  (`registry/`, via `devforgekit component list`) through its symlinks,
  not just `cli/` itself.
- A second invocation reuses the already-built mirror instead of
  re-running setup.
- Bumping `VERSION` invalidates the mirror instead of silently running
  stale code.

## Verification across platforms

- **Linux/WSL2** (the reported environment): reproduced the original
  failure and verified the fix in a clean `ubuntu:22.04` Docker container
  with npm 11.18 - both the `sudo`-installed case (now works via the
  fallback mirror) and a plain non-`sudo` install into a user-owned
  prefix (still uses the fast in-place path, confirming no regression).
- **macOS**: the underlying `EACCES` condition (an unprivileged
  `npm install` against a directory it doesn't own) was reproduced
  directly, independent of any package manager, confirming the fix's
  logic (a plain `[[ -w ... ]]` check) is platform-agnostic rather than
  a Linux-only patch.
- **Full suite**: all 1,354 tests pass (`npm test` in `cli/`), including
  the four new regression tests above.
