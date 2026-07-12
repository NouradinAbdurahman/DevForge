# Release Process

The release checklist, tag process, rollback process, publishing order,
and verification steps for cutting a DevForgeKit release - starting
with `v3.0.1-rc1`. This is the top-level entry point; it cross-references
the documents that already own the detail rather than duplicating them.

## Release checklist

The authoritative, item-by-item checklist is
[`docs/ReleaseCandidateChecklist.md`](docs/ReleaseCandidateChecklist.md) -
**the rule stated there governs**: until every item is green, don't
release. As of this writing, everything through API Freeze is green;
real hardware/VM validation and the RC1 tag itself remain.

At a glance, before tagging any release:

1. `scripts/validate.sh` passes (shell syntax, ShellCheck, Brewfile,
   mise.toml, JSON, YAML, Markdown).
2. `npm test --prefix cli` passes (full suite).
3. No failed GitHub Actions runs on the commit being released
   (`scripts/release.sh` checks this automatically via `gh run list`
   when `gh` is authenticated).
4. `docs/CompatibilityReport.md`, `docs/ApiFreeze.md`, and
   `docs/ReleaseReadinessReport.md` reflect the current state - update
   before tagging if anything material changed since they were written.
5. Working tree is clean and you're on `main` (`scripts/release.sh`
   aborts otherwise, or asks for confirmation off `main`).
6. `devforgekit doctor --release-check` passes - one command that
   verifies version consistency (`VERSION`/`package.json`/
   `cli/package.json`/`Formula/devforgekit.rb`), required documentation
   exists, distribution artifacts are present, the registry passes
   audit/lint/format, no outstanding pending-work markers or
   experimental/debug flags are present, the git tree is clean, and the
   current commit's CI runs haven't failed. Blocks (non-zero exit) if
   anything fails - see `cli/src/core/releaseCheck.js`.
7. `devforgekit rc-validate` (or `./scripts/rc-validate.sh`) passes -
   the full Distribution Verification & RC Validation gate: GitHub
   Release, npm (`npm pack`/`publish --dry-run`/a real scratch-prefix
   global install/uninstall), Homebrew (`brew style`/`audit`/a real
   `brew install --build-from-source` against a local test tap/
   `upgrade`/`uninstall`), a fresh-install lifecycle (`bootstrap.sh
   --dry-run`, environment regeneration, snapshot/restore, repair scan),
   smoke tests, package integrity, and the full regression suite -
   writing a real, non-fabricated `docs/RCValidationReport.md` with a
   PASS/FAIL recommendation. This is the final gate before tagging an
   RC; run it locally before every `rc`/`promote` release.

## Tag process

Tagging is a **two-phase process** - see
[`docs/ReleaseArchitecture.md`](docs/ReleaseArchitecture.md) for the
full reasoning (branch protection on `main` means nothing can push a
release commit directly, so the release itself has to go through a PR
like any other change). Summary:

1. **`./scripts/release.sh <rc|promote|patch|minor|major>`** ("create")
   - runs the preflight checks above, drafts (or renames) the
   CHANGELOG.md section, bumps `VERSION` and `package.json`'s/
   `cli/package.json`'s own `"version"` fields, commits on a new
   `release/vX.Y.Z` branch, pushes it, and opens a PR. Never tags
   anything, never touches `main` directly.
2. Review and merge that PR like any other.
3. **`./scripts/release.sh finalize`** - verifies the PR actually
   merged, syncs local `main`, tags the merge commit, and pushes only
   the tag (never `main` - the merge already updated it).

| `create` mode | Effect |
|---|---|
| `rc` | Cuts a release candidate of the *current* version: `3.0.1` -> `3.0.1-rc1` -> `3.0.1-rc2` -> ... No version-number bump. Refuses if the current, clean version is already tagged/released on origin (run `patch`/`minor`/`major` first in that case). Renames the hand-written `## [Unreleased]` CHANGELOG section to the new versioned heading (preserving its content) and adds a fresh empty `## [Unreleased]` above it. |
| `promote` | Finishes an RC cycle: strips the `-rcN` suffix (`3.0.1-rc3` -> `3.0.1`) for the final release. Same CHANGELOG rename, no fresh `## [Unreleased]` added. |
| `patch\|minor\|major` | A normal semver bump for a routine release once the current version has shipped. Auto-generates a new CHANGELOG section from `git log` since the last tag (unchanged, original behavior) - refuses to run while the current version is a pre-release. |

See the script's own header comment for the full command reference.
Pushing the tag drafts the release - it does not publish anything.
`.github/workflows/release.yml` fires on any `v*.*.*` push, verifies
`VERSION` matches the tag, re-runs `validate.sh` and
`doctor --release-check` (blocking the workflow if either fails),
extracts the matching CHANGELOG section, and creates a **draft**
GitHub Release with `Brewfile`/`README.md`/`CHANGELOG.md`/`VERSION`/a
fresh health report/an SBOM (CycloneDX + SPDX)/`SHA256SUMS.txt`
attached - correctly marked prerelease (and not "Latest") for an
`-rcN` tag. Publishing is always a separate, deliberate action:

```bash
gh release edit vX.Y.Z --draft=false
```

or the "Publish release" button on the draft's GitHub page. Re-running
the workflow against an already-drafted tag just refreshes the assets
(rerun-safe), it never re-publishes or duplicates.

For `v3.0.1-rc1` specifically: `v3.0.0` was already cut and published
as a real, public GitHub Release on 2026-07-07, before the security
audit, Command Safety Audit, Backward Compatibility Matrix, API Freeze,
npm distribution, and Homebrew distribution work in this document's own
`## [Unreleased]` section (see `CHANGELOG.md`). An earlier attempt at
this cycle mistakenly cut `v3.0.0-rc1` - a version number *lower* than
the already-shipped `v3.0.0` - by running `rc` mode against a clean,
already-released version without bumping it forward first (now fixed:
`rc` refuses that case outright, see `docs/ReleaseArchitecture.md`).
That tag never became a consumable release (no GitHub Release was ever
created from it) and was deleted; `v3.0.1-rc1` is the real release
candidate for this cycle's verification work.

## Rollback process

**Before pushing a tag**, nothing has happened publicly - just delete
the local tag and commit (`git tag -d vX.Y.Z`, `git reset --hard
HEAD~1` if the release commit needs undoing too) and start over.

**After pushing a tag but before publishing the draft**, still nothing
public has happened - a draft release isn't visible to anyone without
write access to the repo, and the tag itself is a normal git ref like
any other. Delete the draft (`gh release delete vX.Y.Z`) and the tag
(`git push origin :refs/tags/vX.Y.Z`), fix the issue, and push a new
tag - no different from the "before pushing a tag" case above in
practice, just with a cleanup step first.

**After publishing the draft** (`gh release edit --draft=false` or the
web UI), treat it as public: other people and tools (Homebrew, npm,
direct git users) may already reference it. Prefer *forward* fixes over
rewriting history:

1. **A real bug is found in a published release** - fix it, cut a new
   patch release (`./scripts/release.sh patch` once past RC, or
   `./scripts/release.sh rc` again if still in the RC cycle). Do not
   force-push over the existing tag.
2. **The tag itself was a mistake** (wrong commit, wrong version
   number) and nothing has consumed it yet - confirm with the
   repository owner first (deleting a pushed tag is a "hard to
   reverse, visible to others" action), then:
   ```bash
   git push origin :refs/tags/vX.Y.Z   # delete the remote tag
   git tag -d vX.Y.Z                   # delete the local tag
   gh release delete vX.Y.Z            # remove the GitHub Release, if one was created
   ```
   Re-tag correctly afterward. Never do this to a tag that's been live
   for more than a few minutes without explicit confirmation - someone
   may have already pulled it.
3. **A published npm/Homebrew package is broken** - see
   `docs/DistributionReadiness.md`. npm: `npm deprecate
   devforgekit@X.Y.Z "reason"` marks it without unpublishing (unpublishing
   is disruptive to anyone who already depends on it). Homebrew: revert
   the tap's formula commit to the last-known-good `url`/`sha256`.

## Publishing order

Per `docs/DistributionReadiness.md`'s own ordering section:

**GitHub Release -> Website -> npm -> Homebrew -> Docker -> Winget ->
Chocolatey -> Scoop**

GitHub Release always comes first because it's the source of truth
every other channel points back to (npm's `homepage`/`repository`
fields, the Homebrew formula's `url`, the website's release links).
Winget/Chocolatey/Scoop are Blocked on Windows registry coverage and
APT/Pacman/RPM are Blocked on Linux registry coverage - see that
document for exactly why and what unblocks them.

For `v3.0.1-rc1`: only the GitHub Release step applies. npm and
Homebrew are packaging-*ready* (`package.json`, `Formula/devforgekit.rb`,
both CI-verified) but real publishing to the npm registry and a
`homebrew-devforgekit` tap is deliberately out of scope until after RC1
dogfooding confirms there's nothing left to fix - see the "What's left"
section of `docs/ReleaseCandidateChecklist.md`.

## Verification steps

Automated, on every relevant change (not just at release time):

- `.github/workflows/cli.yml` - full test suite, registry integrity,
  completions drift.
- `.github/workflows/npm-package.yml` - real `npm pack`/`npm publish
  --dry-run`, a real global install into a scratch prefix, and
  `--version`/`--help`/`doctor`/`new --list` against the installed copy.
- `.github/workflows/homebrew-formula.yml` - `brew style`, `brew audit`,
  a real `brew install --build-from-source` into a local test tap,
  `brew test`, and the same functional verification as npm's workflow.
- `.github/workflows/e2e.yml` - full install/validate/doctor/env/repair/
  workspace/uninstall lifecycle on macOS, Ubuntu, and Windows runners.

On demand, before tagging any RC (once per candidate, or after fixing
anything the above found):

- `devforgekit rc-validate` (`scripts/rc-validate.sh`) - runs the full
  Distribution Verification & RC Validation checklist locally in one
  command and writes `docs/RCValidationReport.md`: GitHub Release
  (existence, a real downloaded/checksummed asset), npm (dry runs plus a
  real scratch-prefix global install/smoke-test/uninstall cycle),
  Homebrew (`style`/`audit`/a real `install --build-from-source` against
  a local test tap/`upgrade`/`uninstall`), a fresh-install lifecycle
  against a scratch `$HOME` (`bootstrap.sh --dry-run`, environment
  regeneration, snapshot/restore, repair scan), smoke tests against the
  current checkout, `devforgekit doctor --release-check`, and the full
  regression suite (`validate.sh` + `npm test --prefix cli`). Supports
  `--skip-npm`/`--skip-homebrew`/`--skip-github-release`/`--skip-scaffold`
  for a faster partial run while iterating. Exits non-zero (and the
  report says `FAIL`) if anything required failed.

Manual, once per release candidate (see
`docs/ReleaseCandidateChecklist.md`'s "Create RC1" item):

1. Install DevForgeKit fresh on a real machine (not CI) via
   `git clone` + `./devforgekit install`.
2. Use it for real work for several days: run `doctor`, `update`,
   `repair`, generate a project, switch a workspace.
3. Deliberately break something recoverable (rename `cli/node_modules`,
   corrupt a config file) and confirm `repair`/`doctor --fix` actually
   fixes it.
4. `devforgekit uninstall` and confirm it leaves the machine clean.

Only release-blocking bugs found during this pass get fixed before the
tag; everything else becomes a normal post-release issue.
