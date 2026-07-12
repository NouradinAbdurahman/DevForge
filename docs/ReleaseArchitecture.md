# Release Architecture

Why the release process is shaped the way it is, and how to recover when
it doesn't go cleanly. `RELEASE.md` is the checklist - what to run, in
what order. This document is the reasoning behind it: why two phases,
why tagging happens after a PR merge instead of before, how branch
protection constrains the design, and what to do when a step fails
partway through. Everything below reflects a real release cycle
(`v3.0.0-rc1` -> `v3.0.1-rc1`) that hit every failure mode described
here, not a hypothetical.

## Why two phases

`scripts/release.sh` used to be one script: bump `VERSION`, draft the
CHANGELOG, commit, tag, and `git push origin main` followed by
`git push origin vX.Y.Z`. That design assumed it could push a commit
directly to `main`.

This repo's branch protection (a GitHub ruleset, "Protect main" -
`gh api repos/.../rulesets`, not the legacy branch-protection API, which
reports "Branch not protected" for this repo) sets `non_fast_forward`
and a `pull_request` rule with `"bypass_actors":[]` and
`"current_user_can_bypass":"never"`. No identity, including an
org admin, can push straight to `main`. Confirmed live: the original
script's `git push origin main` was rejected with `GH013: Repository
rule violations found ... Changes must be made through a pull request`,
and because the script runs under `set -Eeuo pipefail`, it aborted at
that exact line - the tag push on the next line never even executed.

The fix is not to work around the ruleset (disabling branch protection,
force-pushing, or reaching for an admin bypass that doesn't exist here)
- it's to make the release process go through a PR like every other
change to `main`. A single script can't both open a PR and wait for a
human (or CI) to merge it in one synchronous run, so the process splits
into two independently-runnable commands:

- **`scripts/release.sh <patch|minor|major|rc|promote>`** ("create") -
  bumps `VERSION`, `package.json`'s and `cli/package.json`'s own
  `"version"` fields, and `CHANGELOG.md` on a new `release/vX.Y.Z`
  branch, pushes it, and opens a PR. It never tags anything and never
  touches `main` directly.
- **`scripts/release.sh finalize`** - run once that PR is reviewed and
  merged. Verifies the merge really happened, syncs local `main`, tags
  the merge commit, and pushes only the tag.

## Why tagging happens after the PR merges, not before

A tag has to point at a commit that's actually reachable from `main` -
otherwise `git describe`, GitHub's own tag-to-branch UI, and anyone who
clones the repo and looks for the release commit on `main` all disagree
about where the release actually is. If `create` tagged its own release
branch before the PR merged, one of two things would happen: the PR
gets merged with a squash or rebase (common on this repo - the ruleset
allows merge/squash/rebase), which rewrites the commit the tag points
at, silently detaching the tag from `main`'s real history; or the PR
gets closed without merging, leaving a real, pushed tag pointing at a
commit that was never actually accepted.

Tagging only the *merge commit*, only *after* `gh pr view <pr> --json
state` reports `MERGED`, guarantees the tag always points at a commit
that is genuinely part of `main`'s history, tagged in the exact form it
was reviewed and merged in.

## How branch protection shapes every step

The same ruleset that forced the two-phase split also shapes what each
phase is allowed to do:

- `create` **never pushes to `main`** - only to its own `release/vX.Y.Z`
  branch, then opens a PR. This is the only way to get a change onto
  `main` under this ruleset.
- `finalize` **never pushes to `main` either** - by the time `finalize`
  runs, the PR merge has already updated `main`. `finalize`'s own
  `git fetch origin main --quiet && git merge --ff-only origin/main` is
  a *local* sync, not a push; the only thing it pushes to origin is the
  tag (`git push origin "$TAG"`).
- `finalize` refuses to fast-forward if local `main` has diverged from
  `origin/main` in a way that isn't a clean fast-forward - this can only
  happen if something else moved `main` after the release PR merged
  (another PR landing in between), and tagging a stale local `main`
  would tag the wrong commit.
- The required status checks the ruleset enforces (`test`, `lint`,
  `dry-run`, both CodeQL `analyze` matrix legs) all have to genuinely
  run on the release PR like any other PR - `create`'s own preflight
  (`validate.sh`, `bootstrap.sh --dry-run`, a CI-status check on the
  commit being released) catches problems locally before a PR is even
  opened, but the ruleset's required checks are what actually gate the
  merge.

## The release-state file

`create` writes `.devforgekit-release-state.json` at the repo root
(gitignored - it's local, machine-specific state, never committed):
`version`, `bump`, `releaseBranch`, `releaseBranchSha`,
`changelogHeading`, `prNumber`, `stage`, `createdAt`. `finalize` reads
it to know which PR to check and which `VERSION`/CHANGELOG heading it
should find on `main` before it's willing to tag anything - it does not
trust the state file blindly: it re-verifies the PR's real merge state
via `gh pr view`, re-checks `VERSION` on the freshly-synced `main`
against the recorded version, and re-checks that `CHANGELOG.md`
actually contains the recorded heading. The state file only ever tells
`finalize` *what to check*, never *that it's already true*.

`finalize` deletes the state file only on full success (tag pushed,
release workflow passed, draft release confirmed to exist). Any failure
along the way leaves the state file in place, so a re-run of `finalize`
picks up exactly where the failure happened rather than starting over.

The state file being gitignored and local-only has one real
consequence worth knowing: switching branches, running `git reset
--hard`, or working from a second clone can leave it missing even
though a release is genuinely in flight. If that happens, reconstruct
it by hand from real, verifiable sources - the real PR number (`gh pr
view <pr>`), the real `VERSION`/CHANGELOG heading on the target commit
- never by guessing. `finalize` re-verifies everything anyway, so a
correctly reconstructed state file is exactly as safe as the original.

## Recovery playbook

### `create` succeeded, `finalize` was never run (or failed early)

The state file exists, no tag exists on origin for that version.
Nothing public has happened - the release branch and its PR are the
only artifacts. Either merge the PR and run `finalize`, or close the PR
and delete the release branch and the state file to abandon the
release cleanly. Re-running `create` for the same version while a state
file already exists is refused ("a release for this version is already
pending") rather than silently starting a second, conflicting one.

### The tag exists, but the release workflow failed

This happened for real cutting this project's first release candidate
through this exact pipeline. `finalize` had already tagged the merge
commit and pushed `v3.0.0-rc1` when `release.yml`'s "Release readiness
gate" step (`doctor --release-check`) failed for real: `VERSION` had
been bumped to `3.0.0-rc1` but `package.json`'s and `cli/package.json`'s
own `"version"` fields hadn't - a genuine gap in `create`'s version-bump
logic, never caught before because `doctor --release-check` didn't
exist as a release-blocking gate until this exact cycle. Every step
after the gate (changelog extraction, SBOM generation, checksums,
**creating the GitHub Release draft**) is correctly skipped when the
gate fails - so a failed workflow run, even with a real tag already
public on origin, has created **no GitHub Release, draft or otherwise**.
`gh release view <tag>` reporting "release not found" is exactly this
state, and it's safe: a git tag alone isn't consumable by npm, Homebrew,
or a casual visitor to the repo's Releases page.

With no consumable artifact yet created, this is a fix-forward
situation, not a rollback:

1. Diagnose the real failure from the workflow's own logs
   (`gh run view <run-id> --job <job-id> --log`) - don't guess from the
   annotations summary, which only surfaces lint warnings and unrelated
   notices, not the actual gate failure.
2. Fix the root cause with a regular PR (this is ordinary `main`
   development, not a special release-branch flow) - merge it once CI
   is green.
3. Decide whether the *version number* the failed tag used is still
   correct. It often isn't: if fixing the root cause required
   meaningfully changing the release infrastructure itself (as it did
   here - the same cycle that found the version-sync bug also fixed a
   version-*numbering* bug in `release.sh rc` itself), treat the failed
   tag as having exercised the pipeline rather than having been a valid
   candidate, and cut the next one under a new, forward version number
   instead of trying to reuse the old one.
4. Delete the stale tag (`git push origin :refs/tags/vX.Y.Z`, `git tag
   -d vX.Y.Z`) - confirm first if it's been live for more than a few
   minutes, since someone may already have fetched it, but a tag with
   no GitHub Release is low-consequence to delete.
5. Reconstruct or update the release-state file to point at the fix
   PR's real number and the corrected version/CHANGELOG heading, then
   run `finalize` again.

### A release is only partially complete (draft created, not published; or published but something's wrong)

- **Draft created, not yet published**: still not public. Fix forward
  exactly as above - delete the draft (`gh release delete vX.Y.Z`) and
  the tag, fix, re-tag. See `RELEASE.md`'s "Rollback process" for the
  exact commands.
- **Already published** (`gh release edit --draft=false`, or the "Publish
  release" button): now other people and tools may reference it. Do not
  delete or retag - see `RELEASE.md`'s "Rollback process" for the
  forward-fix path (new patch release, `npm deprecate`, reverting the
  Homebrew tap's formula commit).
- **Workflow re-run against an already-tagged, already-drafted release**:
  safe and idempotent - `finalize`'s own restart path
  (`git ls-remote --tags origin` finding the tag already there) skips
  straight to waiting for the workflow and verifying the draft, and
  `release.yml`'s own "Create or update GitHub release draft" step uses
  `gh release create` if no release exists yet or `gh release upload
  --clobber` if one already does, so re-running never duplicates
  assets.

## Expected release lifecycle

```
scripts/release.sh rc              # or patch/minor/major
  -> release/vX.Y.Z branch, PR opened, state file written
       |
       v
   PR reviewed, CI required checks pass, merged to main
       |
       v
scripts/release.sh finalize
  -> verifies the merge, syncs main, tags the merge commit,
     pushes only the tag
       |
       v
   release.yml triggers on the tag push
  -> validate.sh, doctor --release-check (blocking gate),
     changelog extraction, health report, SBOM, checksums,
     optional signing, draft GitHub Release created/updated
       |
       v
   finalize verifies the draft exists, deletes the state file
       |
       v
   Draft release reviewed by a human
       |
       v
   gh release edit vX.Y.Z --draft=false   (separate, deliberate)
       |
       v
   npm publish --tag next / brew tap update   (separate, deliberate,
   not automated by release.sh or release.yml - see RELEASE.md's
   "Publishing order")
```

Every arrow after the tag push is verifiable independently: the
workflow's own log, the draft release's real assets and checksums, a
real scratch-prefix `npm install -g` from the packed artifact, and
`devforgekit doctor --release-check` run against the actual downloaded
release tarball rather than the working checkout. None of these steps
trust an earlier step's success without re-checking - the same
philosophy `finalize` itself applies to its own state file.
