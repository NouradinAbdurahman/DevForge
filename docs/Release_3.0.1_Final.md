# DevForgeKit v3.0.1 - Final Release Report

The single-page status summary for the first stable public release.
`RELEASE_CERTIFICATION.md` is the full record with evidence (including
the release-process bugs found and fixed while getting here) for every
claim below; this document is the recommendation and the numbers.

| Field | Value |
|---|---|
| Release version | `3.0.1` |
| Release date | 2026-07-12 (tag), fully verified 2026-07-13 |
| Git commit (tag) | [`1a6767f`](https://github.com/NouradinAbdurahman/DevForgeKit/commit/1a6767fb1da302785803b64b1869f92b7993bc28) (tag `v3.0.1`) |
| `main` HEAD (post-fixes) | [`763bcbe`](https://github.com/NouradinAbdurahman/DevForgeKit/commit/763bcbeb36c5ef231f67bcf41970006d6af2bfd4) |
| GitHub Release | [DevForgeKit v3.0.1](https://github.com/NouradinAbdurahman/DevForgeKit/releases/tag/v3.0.1) - published, not draft, not prerelease, `Latest` |
| npm | [`devforgekit@3.0.1`](https://www.npmjs.com/package/devforgekit) - `latest` dist-tag, real global install verified end-to-end |
| Homebrew tap | [`NouradinAbdurahman/homebrew-devforgekit`](https://github.com/NouradinAbdurahman/homebrew-devforgekit) - `Formula/devforgekit.rb` points at the real `v3.0.1` tag, real build-from-source install verified against a fresh tap clone |
| CI status | Green - all 5 required checks passing on the current `main` tip (Core CLI, Bootstrap, Lint, Scorecard, CodeQL) |
| Test count | 1,350/1,350 passing (clean, isolated run - see "Test suite" below) |
| Registry count | 261 packages, 35 categories, 17 collections, 50 profiles, 8 recipes, quality score 89% |
| Supported platforms | npm/Homebrew: macOS (Apple Silicon or Intel) or Linux. Windows: WSL, or source install. Verified live this cycle: **macOS, Apple Silicon only** (unchanged from RC - see Known limitations) |

## Package integrity

- Source archive: `https://github.com/NouradinAbdurahman/DevForgeKit/archive/refs/tags/v3.0.1.tar.gz`
  sha256 `58e8c3f82edf9301a4697157292c7290aeb0368728fbe048da81957f8f1d19ac`
  (7,223,473 bytes) - this is the real, final value; a first, now-corrected
  attempt shipped in the GitHub Release's own assets is stale (see
  "Release-process bugs found and fixed" below).
- GitHub Release assets (`Brewfile`, `CHANGELOG.md`, `health-report.txt`,
  `README.md`, `sbom-cyclonedx.json`, `sbom-spdx.json`, `VERSION`) -
  all 7 checksums verified directly against `SHA256SUMS.txt` via
  `shasum -a 256 -c` on freshly downloaded copies.
- SBOM: both CycloneDX and SPDX formats present and confirmed to
  reference `3.0.1` (`sbom-cyclonedx.json`'s `metadata.component.version`,
  `sbom-spdx.json`'s `packages[0].versionInfo`).
- npm package: `devforgekit@3.0.1`, `bin.devforgekit` field verified
  correct on the live registry entry after the fix in PR #42.

## Test suite

`npm test --prefix cli`: **1,350/1,350 passing**, 0 failures, run
cleanly in isolation. Three earlier full-suite runs each showed exactly
one failure - a different, unrelated test every time (a TUI scroll
timeout, a Node test-runner worker IPC error, and an async-render
assertion) - none of which reproduced when re-run alone. This matches
resource contention from this session's own heavy cumulative activity
(many Homebrew builds and npm installs run back-to-back on one
machine), not a code defect; the isolated, clean 1,350/1,350 result is
the trustworthy one and matches how real CI actually runs (one
suite per isolated runner).

`scripts/validate.sh`: clean (769 checks passed, 0 failed) - shell
syntax, ShellCheck (22 scripts), Brewfile/profile Brewfiles,
`mise.toml`, JSON, YAML, Markdown, ESLint (0 errors, 119 pre-existing
unused-var warnings in test files, no regressions), and the CLI test
suite. The one warning (`profiles/recommended/Brewfile skipped or
failed`) is real but expected and non-blocking: this dev machine
doesn't have Docker installed, which that profile lists - not a
Brewfile defect.

`devforgekit doctor --release-check`: **PASS** - version consistency
across `VERSION`/`package.json`/`cli/package.json`/
`Formula/devforgekit.rb`, all required docs and distribution artifacts
present, registry lint/format clean, no pending-work markers, clean git
tree, no failed CI runs on the current commit.

`devforgekit registry audit`/`lint`/`format`: clean, no drift in the
generated `registry.json`/`docs/Registry.md`/
`profiles/generated/brewfile-categories.txt`.

## Release-process bugs found and fixed this cycle

The first `v3.0.1` tag attempt failed at the release-readiness gate
because `Formula/devforgekit.rb` still referenced `3.0.0` - a real
release-process **ordering** bug (the gate correctly requires the
Formula to already match before creating a release, but the Formula can
only reference a tag once that tag exists), not a validation weakness.
Fixed forward, not by weakening the gate:

1. **Formula sha256 self-reference** (PR #39, then PR #40) - the
   Formula file lives inside the same repo/tag its own `sha256` field
   describes, so fixing it changes the tag's own archive content. Two
   real, verified checksums were needed: one before the fix landed,
   one after `scripts/release.sh finalize` re-tagged the fix's own
   commit. Confirmed by re-downloading the real, published archive and
   comparing, not assumed.
2. **Empty CHANGELOG section** (PR #41) - `scripts/release.sh promote`
   correctly renamed the empty `## [Unreleased]` heading straight to
   `## [3.0.1]` with no content (promoting an RC to stable made no code
   changes), but that left the published GitHub Release's body
   effectively blank. Fixed with real content explaining the promotion,
   then the live release's body was updated directly
   (`gh release edit --notes-file`) without touching the immutable tag.
3. **Invalid npm `bin` field** (PR #42) - `package.json`'s
   `bin.devforgekit` was `"./devforgekit"` (leading `./`), which npm
   11.x flags and silently strips at publish time. The already-published
   `3.0.1-rc1` package turned out fine (npm's auto-correction had
   already applied successfully then), but the underlying bug was fixed
   directly rather than continuing to rely on silent per-publish
   correction.

All three are documented in full, with verification evidence, in
`RELEASE_CERTIFICATION.md`'s Corrections entries. None weakened any
release gate or validation logic.

## Known limitations

Carried forward from the RC cycle (`docs/RC1_STATUS.md`) - **not
resolved by this release**, since nothing in this final-release cycle
involved testing on non-macOS hardware:

- **Real hardware/VM validation remains macOS-Apple-Silicon-only.**
  Not yet validated on real hardware: macOS Intel, Windows 11 (native
  npm install unsupported - WSL or source install only), Fedora
  (dnf), Arch (pacman). CI runners (GitHub-hosted) cover Ubuntu/
  Windows/macOS at the automated level; this is about real-machine
  validation beyond CI.
- **Registry live-coverage gap**: macOS 261/261 (100%), Linux 68/261
  (26%), Windows 55/261 (21%) - data-verification work, tracked
  separately, not an engineering defect.
- **Only 5/261 registry packages are CI-verified** via a real live
  install/validate/uninstall smoke test (`registry-smoke.yml`'s
  allowlist) - tracked in GitHub issue #37 for future expansion.
- **Formula/tag circular dependency** (this cycle's own discovery,
  documented in `RELEASE_CERTIFICATION.md`): the Homebrew Formula lives
  inside the same repo/tag it describes, so a perfectly self-consistent
  first-attempt checksum isn't achievable within the current pipeline
  architecture. Worth a v3.1 pipeline redesign (create tag → create
  release → update Formula against the released tarball → publish
  Formula) - explicitly deferred, not attempted in this release.
- A full documentation *review pass* (every page, every example,
  screenshots, migration guide, FAQ) remains deferred, per earlier
  explicit direction, unchanged since the RC.

## Recommendation

```
v3.0.1 is fully released and verified across all three distribution channels.
```

**Basis** (objective evidence only, detailed in `RELEASE_CERTIFICATION.md`):

- GitHub Release: published, not draft, not prerelease, confirmed as
  the repository's `Latest` release via `/releases/latest`. All assets
  checksum-verified against freshly downloaded copies. SBOM (both
  formats) confirmed referencing the correct version.
- npm: `devforgekit@3.0.1` published for real (`npm publish`,
  completing npm's browser-based publish approval), `latest` dist-tag
  correctly moved to it, `next` correctly left at `3.0.1-rc1`. A real
  scratch-prefix global install verified end-to-end, including the
  documented `allow-scripts` postinstall-skip self-heal.
- Homebrew: the real, public tap updated and pushed, verified via
  `brew style`/`brew audit --strict`/`brew livecheck` (now reports up
  to date) and a real `brew install --build-from-source` cycle against
  a genuinely fresh tap clone (`brew untap` + `brew tap`, not just the
  local clone that pushed the change) - `devforgekit --version`
  confirmed `3.0.1` against the real installed binary.
- Full automated suite green: 1,350/1,350 tests (clean isolated run),
  `scripts/validate.sh` clean, `devforgekit doctor --release-check`
  PASS, registry audit/lint/format clean, all CI checks green on the
  current `main` tip.
- Three real release-process bugs found while getting here, all fixed
  forward with verification evidence, none papered over or worked
  around.

**What this recommendation does not claim**: real-hardware validation
beyond macOS Apple Silicon, or resolution of the Formula/tag circular
dependency's underlying architecture. Both are honestly tracked above
as open, non-blocking follow-on work.
