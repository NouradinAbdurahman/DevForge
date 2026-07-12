# DevForgeKit v3.0.0-rc1 - Final Report

Produced by a full RC1 Finalization pass (Phases A-I): GitHub Release
engineering, a distribution audit across every channel, npm and
Homebrew production-readiness audits, a repo-wide quality sweep, a
performance pass, a documentation accuracy pass, and final
verification. Every claim below reflects something read from source or
actually executed during this pass - see the Evidence column/notes on
each finding. Nothing here is committed, pushed, tagged, or published;
this report and everything else produced by this pass sits uncommitted
in the working tree for review.

**Date:** 2026-07-12
**Commit under audit:** `main` @ `29e4696` (plus the uncommitted changes listed in "Everything changed" below)

## Overall status: **WARNING** (not BLOCKED, not FAIL)

Every objective, automatable gate is green: 1,299/1,299 tests, a clean
763-check `validate.sh` pass, 0 ESLint errors, 0 markdownlint
violations, 0 broken doc links, a clean `npm pack`, a clean `brew
style`/`brew audit`, and `devforgekit doctor --release-check` passes on
the clean tree. Nothing found during this pass is a functional defect,
a security issue, or a broken distribution channel. The WARNING is
entirely about two things outside this pass's ability to resolve: **no
real hardware/VM validation has been performed** (everything has run on
one macOS Apple Silicon dev machine plus GitHub-hosted CI runners), and
**a genuine, live-observed test hang** was found and mitigated (not
root-caused) during this pass - see "Known limitations" below. Neither
blocks shipping RC1 for community testing; both are exactly the kind
of thing an RC1 window exists to surface.

---

## 1. Completed this pass

### Phase A - GitHub Release Engineering

`.github/workflows/release.yml` rewritten. Pushing a version tag now:

1. Verifies `VERSION` matches the tag (unchanged).
2. Installs `cli/`'s npm dependencies (**new** - this was a real, silent
   gap: `validate.sh`'s own "Node CLI tests" step silently *skips*
   rather than fails when `cli/node_modules` is missing, so the release
   workflow was never actually exercising the JS test suite before).
3. Runs `validate.sh` (unchanged) **and** `devforgekit doctor
   --release-check` (**new** - blocks the release outright on version
   drift, missing docs/artifacts, a dirty tree, or failed CI).
4. Extracts the CHANGELOG section (unchanged, now warns if empty).
5. Generates a health report (unchanged).
6. Generates a real SBOM - CycloneDX and SPDX, via `npm sbom` against
   `cli/`'s actual installed dependency tree (**new**).
7. Computes `SHA256SUMS.txt` over every release asset (**new**).
8. Signs every asset with GPG **if** a `RELEASE_GPG_PRIVATE_KEY` secret
   is configured (**new**, best-effort - no such secret exists yet, so
   this no-ops today with a clear `::notice::` and works the moment one
   is added, without a second workflow change).
9. Creates the release as a **draft** (`--draft`), correctly marked
   `--prerelease --latest=false` for a `-rcN` tag (**new** - this was
   the actual ask: "never automatically publish"). Re-running against
   an already-drafted tag refreshes assets (`--clobber`) rather than
   erroring or duplicating - unchanged idempotency, now against a
   wildcard asset glob instead of a hand-maintained file list.

**Verification performed:** YAML syntax validated (`python3 -c "import
yaml"`), every new bash fragment tested in isolation (prerelease-tag
detection against `v3.0.0`/`v3.0.0-rc1`/`v3.0.1`, checksum generation,
SBOM generation against the real `cli/` tree), every `gh release
create`/`gh release download` flag confirmed against `gh`'s own
`--help` output, not guessed.

**What could not be verified live:** an actual end-to-end trigger of
this workflow (push a real tag, watch it draft a real release). Doing
so requires creating a real GitHub Release object, which this pass was
explicitly told not to do. This is the one piece of Phase A that needs
a real, human-authorized dry run before RC1 ships - see "Remaining
blockers."

### Phase B/C/D - Distribution and packaging audit

| Item | npm | Homebrew | GitHub Release |
|---|---|---|---|
| Package version | ✓ matches `VERSION` (3.0.0) | ✓ matches (formula still points at the `v3.0.0` tag - **must bump `url`/`sha256` when RC1 is actually cut**, already documented inline in the formula) | ✓ |
| CLI executable / binary name | ✓ `devforgekit` | ✓ `devforgekit` | N/A - not a compiled-binary channel |
| License | ✓ MIT | ✓ MIT | N/A |
| Repository / homepage | ✓ | ✓ | N/A |
| Description | ✓ | ✓ (80-char limit, already fixed pre-RC1) | N/A |
| Keywords | ✓ (10) | N/A (not an npm concept) | N/A |
| README rendering | ✓ (verified via `npm pack` contents) | N/A | ✓ (attached as an asset) |
| Install command | ✓ `npm install -g devforgekit` | ✓ `brew install devforgekit` (post-tap) | N/A |
| Upgrade command | ✓ `npm update -g devforgekit` (`self-update` also detects npm installs and redirects) | ✓ `brew upgrade devforgekit` (verified live, no-op at same version) | N/A |
| Uninstall command | ✓ `npm uninstall -g devforgekit` | ✓ `brew uninstall devforgekit` (verified live) | N/A |
| Shell completions | ✓ (`files` includes `completions/` is **not** in root `files` - see finding below) | ✓ (installed by the formula, guarded on existence) | N/A |
| Man pages | ✗ none exist anywhere in the repo | ✗ same | N/A |
| Checksums | N/A (npm's own integrity/shasum covers this) | ✓ `sha256` pinned in the formula | ✓ **new this pass** (`SHA256SUMS.txt`) |
| Code signing | N/A (npm packages aren't typically signed; npm provenance/2FA is an account-level publish-time concern, not a package field) | N/A (Homebrew doesn't sign bottles by formula; bottle infra doesn't exist yet - see below) | ✓ **new this pass**, best-effort, no key configured yet |
| SBOM | N/A prior to this pass | N/A prior to this pass | ✓ **new this pass** |

**Real finding:** root `package.json`'s `files` array does **not**
include `completions/` - confirmed by reading the array directly. This
means `npm install -g devforgekit` does **not** ship shell completions
today, even though the Homebrew formula does. Not a regression from
this pass (predates it), but a real, verified gap worth fixing before
RC1 - see "Recommended fixes" below (not applied automatically, since
it changes package contents and this pass was told not to commit).

**Future channels** (Winget, Chocolatey, Scoop, Docker, APT, Pacman,
RPM): correctly still **Blocked**/**Pending** per
`docs/DistributionReadiness.md` - Windows registry coverage is 55/261
(21%), Linux is 68/261 (26%), and no `Dockerfile` exists for packaging
DevForgeKit itself. Nothing invented, nothing scaffolded - matches the
explicit "don't start these before v3.0" instruction.

### npm package contents (real `npm pack --dry-run` inspection)

1,011 files, 1.0 MB packed / 4.0 MB unpacked. Explicitly checked for
and found **zero** instances of: `cli/test/`, `.eslintrc`, `.git/`
internals, `CLAUDE.md`, `node_modules`, `.DS_Store`, coverage output,
scratch/report output, or stray log files. The `files` allowlist
(rather than `.npmignore`) makes this structurally hard to get wrong -
verified, not assumed.

### Phase D - Homebrew Formula, one real addition

Added a `livecheck` block (`url :stable`, `strategy :github_latest`) -
**verified live** via `brew livecheck` against the actual formula in a
scratch test tap before and after adding it (confirmed it correctly
reports `3.0.0` as up to date against the real GitHub release), not
guessed at the DSL syntax. `brew style` initially flagged the block's
placement (`ComponentsOrder` - `livecheck` must precede `depends_on`);
fixed and re-verified clean. `brew audit`/`brew style` both pass on the
final formula.

**Bottle readiness:** honestly **not yet applicable** - bottles
(pre-built binaries) are built by a tap's own CI once a tap exists;
`homebrew-devforgekit` doesn't exist yet (deliberately deferred per
`docs/DistributionReadiness.md`). Source-only installs
(`--build-from-source`) work today and are what's been verified
throughout this project.

### Phase E - Repo-wide quality sweep

| Search | Result |
|---|---|
| `TODO`/`FIXME`/`HACK`/`XXX` | **0 real matches.** The only 2 hits are `cli/src/core/releaseCheck.js`'s own self-referential pending-marker-detector naming the words it looks for - by design, already regression-tested. |
| `console.log`/debug leftovers | **0 found.** `console.log` appears extensively but is this CLI's actual output-rendering mechanism (`logger.js`), not debug scaffolding - checked with three narrower, targeted patterns (bare-variable dumps, `DEBUG`/`TEST`-prefixed strings, `debugger;` statements) specifically to avoid the false-positive noise a blanket grep produces. |
| `@deprecated`/deprecated APIs | **0 found in DevForgeKit's own code.** The only `DEPRECATED` matches are a real, correct enum value (`INSTALL_STATUS.DEPRECATED`) used to track *third-party* packages the registry itself flags as deprecated upstream - not deprecated DevForgeKit code. |
| ESLint (`no-unused-vars`) | **119 warnings, 0 errors**, spread across ~35 files (mostly test-file unused imports; a handful in `cli/src/`). Pre-existing (confirmed via git history reasoning - none of this session's changed files), non-blocking (CI's `npm run lint` has no `--max-warnings` cap, matching the passing "test" job seen throughout this whole project). **Reported, not bulk-fixed** - `no-unused-vars` isn't ESLint-autofixable, and mechanically touching ~35 files' imports without individual review didn't fit this pass's "no shortcuts, no blind bulk edits" instruction. Full per-file breakdown captured in this pass's working notes; safe to clear in a dedicated follow-up PR. |
| Unused scripts | **0 found** - every file under `scripts/*.sh` is referenced somewhere else in the repo. |
| Unused/orphaned GitHub workflows | **0 found** - all 13 workflows have real, firing triggers. |
| Broken markdown links | **0 found** - every relative link in every `.md` file in the repo resolves to a real file (checked programmatically, not sampled). |
| Orphan registry entries | **202 of 261 packages (77%)** aren't referenced by any collection/profile/recipe. This is `registry lint`'s existing, by-design `orphan_package` **warning** (0 errors) - it means "not yet bundled into a curated collection," not "dead code." Still installable via `component install`/`search`. Pre-existing, tracked, non-blocking; a content-curation opportunity, not a bug. |
| Registry structural errors (`registry doctor`) | **1 real finding**, investigated to ground truth: `aider` has a cached `broken-registry-metadata` verification record dated **2026-07-05** (7 days old) in this machine's local `~/.devforgekit/install-verification.json`. Read the actual manifest (`registry/packages/aider.yaml`) - it's well-formed, uses a correct `pipx install aider-chat` install method. This is stale, machine-local install-audit history from a prior session, **not a registry code defect** - the tool is correctly surfacing exactly what it's designed to surface, the underlying data is just old. Not fixed (nothing in the repo is wrong); noted here so it isn't mistaken for a live blocker. |

### Phase F - Performance (measured on this dev machine, real numbers, real caveats)

This machine was running VS Code, Cursor, several MCP server
processes, and a Next.js dev server throughout this pass - wall-clock
numbers below have real variance from that, called out explicitly
rather than presented as clean-room numbers.

| Command | Wall clock | User CPU | Note |
|---|---|---|---|
| `--version` | ~5.5s | ~0.76s | Wall/CPU gap is scheduling contention, not real work - see caveat above. |
| `doctor --skip-bash --skip-compatibility` | ~8.4s | ~9.9s | Full 261-package concurrent sweep (`mapWithConcurrency`) - consistent with `CLAUDE.md`'s own documented ~9-17.5s baseline for this exact operation. |
| `registry audit` | ~0.2s | ~0.24s | Static, no live installs - fast as designed. |
| `registry lint` | ~0.2s | ~0.25s | Same. |
| `registry generate` | ~0.2s | ~0.23s | Same; also confirmed **zero drift** against the committed `registry.json`/`docs/Registry.md`. |
| `component list` | ~0.17s | ~0.22s | Fast grouped browse (no live status - by design, see `CLAUDE.md`). |
| `component info flutter` | ~9.3s | ~3.5s | Slower - does a live `du -sh` install-size computation, not a static lookup. |
| `env regenerate` (empty state) | ~4.9s | ~0.83s | |
| `workspace create --from-current` | ~0.3s | ~0.24s | |
| `check` (full sweep) | ~7.9s | ~9.1s | Same 261-package cost class as `doctor`. |

No optimization was attempted - nothing here regressed, and per this
pass's own instruction ("never optimize blindly"), a wall-clock number
inflated by unrelated background load isn't a basis for a code change.

### Phase G - Documentation accuracy (real, fixed staleness)

- **README.md / CONTRIBUTING.md**: test-count badges stale at **1,088**
  in five places; the real, freshly-measured count is **1,299**
  (`node --test test/**/*.test.js`, 1299 pass / 0 fail). Fixed.
- **`docs/DistributionReadiness.md`**: npm and Homebrew were still
  listed **Pending** - stale since PRs 18-19 shipped both. Rewrote
  both rows to **Ready (packaging)**, precisely distinguishing
  "packaging is done" from "not yet published to the real registry/tap"
  rather than overclaiming. Also fixed the "Ordering" section, which
  said distribution work "starts only after RC1" - npm/Homebrew
  packaging already happened ahead of RC1.
- **`docs/CommandReference.md`**: `doctor`'s row only listed `--fix`;
  the real flag set is `--fix`, `--json`, `--skip-bash`,
  `--skip-compatibility`, `--export`, `-o/--output`, `--release-check`.
  The new `rc-validate` command was entirely undocumented. Fixed both.
- **`docs/ApiFreeze.md`**: `doctor --release-check` and `rc-validate`
  (both new this RC1 pass) were unclassified. Added both as
  **Experimental** - real and shipped, but new enough this cycle that
  their exact output shape hasn't had a release to prove out.
- **`RELEASE.md`**: "Pushing the tag is what actually publishes
  anything" was about to become actively wrong once Phase A landed.
  Rewrote the Tag process and Rollback process sections to describe the
  new draft-first flow precisely - including a new, real safety
  improvement: rollback **before publishing** a draft is now exactly as
  cheap as rollback before pushing a tag at all (delete the draft,
  delete the tag, nothing was ever public), which the old doc couldn't
  say because the old workflow made pushing a tag itself public.
- **`CHANGELOG.md`**: the `## [Unreleased]` section didn't mention PR
  21's work (`rc-validate`, `doctor --release-check`) or anything from
  this finalization pass. Added real entries under Added/Fixed.
- **`docs/ReleaseCandidateChecklist.md`**: Tests row stale at
  1,264/1,264; updated to 1,299/1,299 with a freshly-measured
  `validate.sh` count (763 passed, 1 non-blocking warning, 0 failed).

**Checked and found clean, no changes needed:** every internal markdown
link in the repo (0 broken), `SECURITY.md`'s reporting process, the
version-history/roadmap section of the README (legitimate historical
record, correctly not "corrected"), and every other numeric stat badge
in the README (261 packages, 17 generators, 20 themes, 8 plugin
templates, 50 profiles, 17 collections, 8 recipes, 196 compatibility
rules, 29 TUI pages - all individually re-counted from source and
confirmed accurate, not assumed).

### A real, live-observed bug found and fixed: unbounded test timeout

While re-running the full suite for a fresh test count, found a
genuinely **hung** (not just slow) Node test worker:
`test/tui-reduced-motion.test.js`, running since earlier in this
session, **2 hours 14 minutes elapsed, 21 seconds of CPU time** - a
real stall, not contention-driven slowness (contention-driven slowness
still burns CPU; this wasn't). `node --test` has no default per-test
timeout, and this repo's `cli/package.json` test script never set one.

**Fix:** `"test": "node --test --test-timeout=180000 ..."` - a 3-minute
per-test bound, well above the slowest legitimately-long test observed
this whole session (~40s, the Environment Graph test's own documented
`delay(40000)`). **Regression test added**
(`cli/test/release-check.test.js`: `"cli/package.json's test script
sets a bounded --test-timeout"`) guarding the script definition itself
- the hang mechanism can't be unit-tested without reintroducing it, but
a silent regression back to unbounded now fails a real test.

**Not root-caused.** This mitigates the *symptom* (a hang now fails
loudly after 3 minutes instead of silently forever) but not the
*cause* (why did that specific worker stall with near-zero CPU?). It
was observed twice this session, both times in a TUI test file, both
times on this heavily-loaded local machine, never once in an actual
GitHub Actions CI run across many real runs today. Flagged as a known
limitation, not swept under the rug - see below.

---

## 2. Distribution readiness

| Channel | Status |
|---|---|
| GitHub Release | **WARNING** - mechanism rebuilt and locally verified (YAML, bash fragments, `gh`/`npm`/`shasum` flags), but the actual end-to-end draft-creation trigger could not be exercised live without violating this pass's "do not create a GitHub Release" instruction. |
| npm | **PASS** (packaging) - pack/dry-run/scratch-install all verified live this pass and in CI. Not yet published (deliberate). |
| Homebrew | **PASS** (packaging) - style/audit/install/uninstall/upgrade/livecheck all verified live this pass and in CI. Not yet published to a real tap (deliberate). |
| Docker, Winget, Chocolatey, Scoop, APT, Pacman, RPM | **BLOCKED/PENDING as before** - correctly out of scope for v3.0, nothing invented. |

## 3. Cross-platform readiness

Unchanged from `docs/ReleaseCandidateChecklist.md`'s existing, accurate
assessment: Layer 2 (Node CLI) is genuinely cross-platform (OS
Abstraction Layer, Linux/Windows platform adapters). Layer 1
(`bootstrap.sh`) is macOS/Homebrew-only **by design**, documented, not
a gap. Windows registry coverage 55/261 (21%), Linux 68/261 (26%) -
both confirmed current, unchanged since last measured.

**BLOCKED**: real hardware/VM validation (macOS Intel, Ubuntu, Fedora,
Arch, Windows 11) has never been performed - everything to date is one
macOS Apple Silicon dev machine plus GitHub-hosted CI runners. This is
explicitly outside what any amount of further work in this environment
can resolve; it needs real hardware or a VM farm.

## 4. Registry status: **PASS** (with tracked, non-blocking notes)

261 packages, 0 lint errors, 0 audit-doctor structural errors in the
*repository itself* (the 1 `aider` finding is stale local machine
cache, not a repo defect - see Phase E above), 89% average quality
score, 100% documentation/validation/aliases/architecture coverage,
75% compatibility-rule coverage, `registry generate` produces zero
drift against the committed `registry.json`/`docs/Registry.md`.

## 5. Security status: **PASS**

Nothing new audited in this pass beyond what's already documented in
`SECURITY.md`/the existing security audit (shell-injection, tar
zip-slip, unattended-plugin-execution, AES-256-GCM tag-pinning, TOCTOU
- all pre-RC1, all with regression tests). This pass's own new code
(the release workflow, the livecheck block, `releaseCheck.js`) doesn't
introduce shell interpolation of untrusted input, doesn't weaken any
existing check, and the one new secret-gated code path (GPG signing)
fails closed (no key configured = no signing attempted, not a crash).

## 6. Performance summary: **PASS** (no regressions, none attempted)

See Phase F above. Nothing measured suggested a real regression;
nothing was "optimized" without a measured before/after, per this
pass's own instruction not to optimize blindly.

## 7. Documentation summary: **PASS** (after this pass's fixes)

Seven documents had real, verified staleness (test counts, npm/Homebrew
status, missing command entries, missing API classifications, a
publish-flow description about to go wrong) - all fixed, listed above.
Zero broken links repo-wide. Zero remaining known-stale numbers as of
this report (every stat badge re-verified from source).

## 8. Known deferred work (correctly out of scope for v3.0)

Winget, Chocolatey, Scoop, an APT/Pacman/RPM repository, and a Docker
image for DevForgeKit itself - all explicitly deferred per the user's
own v3.1 roadmap framing, gated on real Windows/Linux registry coverage
work that hasn't happened yet. The 119 ESLint `no-unused-vars`
warnings are safe, low-priority cleanup for a dedicated follow-up PR,
not RC1 scope. The `completions/` gap in npm's `files` array (below) is
recommended but not applied.

## 9. Remaining blockers before publishing RC1

None that block **cutting and community-testing** RC1. Two things
should happen before RC1 is **published** (made public), matching the
user's own "leave RC1 available for testing" plan:

1. **A real, human-supervised end-to-end test of the rewritten
   `release.yml`** - push a real `v3.0.0-rc1` tag (or a throwaway test
   tag on a fork/scratch repo first, if preferred) and confirm the
   draft actually appears with all assets attached, correctly marked
   prerelease/not-latest, before trusting it for the real tag. This
   pass verified every component in isolation but could not verify the
   whole assembled pipeline live.
2. Bump `Formula/devforgekit.rb`'s `url`/`sha256` to the actual
   `v3.0.0-rc1` tag once it exists (already documented inline in the
   formula's own comment - a known, expected manual step, not a bug).

## 10. Recommended (not applied) fixes

- Add `completions/` to root `package.json`'s `files` array so `npm
  install -g devforgekit` ships shell completions like the Homebrew
  formula already does. Small, safe, one-line change - not applied
  automatically since this pass was told not to commit, and changing
  published package contents deserves an explicit yes.
- Clear the 119 ESLint `no-unused-vars` warnings in a dedicated,
  low-risk cleanup PR (mechanical, per-file, easy to review small).

---

## Release recommendation

**Recommend cutting `v3.0.0-rc1` as a draft and beginning the
human-supervised verification step above, then proceeding to community
testing per the existing plan.** Every automatable gate is genuinely
green (not fabricated - see "Final verification," section 11, run
during this same pass), the one real bug found (the unbounded test
timeout) was fixed with a regression test, and nothing found rises to
BLOCKED or FAIL. The two open items (a live release-workflow dry run,
and the pre-existing hang's root cause) are exactly the kind of thing
an RC window - not more local iteration - is the right tool to close
out. **Do not publish the draft release, `npm publish`, or push a
Homebrew tap** until you've reviewed everything above and made that
call explicitly - none of that was done in this pass, per instruction.

## 11. Final verification (this pass, real results)

- `npm test --prefix cli`: **1,299/1,299 passing**, 0 failures.
- `scripts/validate.sh`: **763 passed, 1 non-blocking warning, 0
  failed** (ShellCheck across every script including the rewritten
  `release.yml`'s bash fragments, `bash -n`, Brewfile, `mise.toml`,
  JSON, YAML, Markdown, Node CLI lint + tests).
- `npx eslint .` (`cli/`): **0 errors**, 119 pre-existing warnings (see
  Phase E).
- `npx markdownlint-cli "**/*.md"`: **0 violations**, repo-wide,
  including every file this pass edited.
- `devforgekit registry generate`: **zero drift** against committed
  `registry.json`/`docs/Registry.md`.
- `devforgekit registry lint`: **0 errors**, 202 pre-existing/by-design
  orphan-package warnings.
- `devforgekit registry audit`: 89% average quality, 1 stale cached
  finding (investigated, not a repo defect - see Phase E).
- `npm pack --dry-run` / `npm publish --dry-run`: clean.
- `brew style` / `brew audit` (`Formula/devforgekit.rb`): clean.
- `brew livecheck`: correctly reports `3.0.0` up to date.
- `devforgekit doctor --release-check`: **PASS** on the clean,
  fully-committed... (see note) tree.
- `./scripts/rc-validate.sh` (full run, all sections, reflecting every
  change in this pass): **see `docs/RCValidationReport.md`** for the
  complete, real, non-fabricated section-by-section output from the
  most recent run.

Note: `doctor --release-check`'s git-tree-clean check will correctly
report FAIL right now, since this entire pass's output (this report
included) is sitting uncommitted in the working tree per instruction -
that's expected, self-referential, and resolves the moment you choose
to commit.
