# DevForgeKit v3.0.1-rc1 - Final RC Declaration

The single-page status summary. `RELEASE_CERTIFICATION.md` is the full
record with evidence for every claim below; this document is the
recommendation and the numbers, for anyone who needs the verdict without
reading the whole trail.

| Field | Value |
|---|---|
| Release version | `3.0.1-rc1` |
| Release date | 2026-07-12 |
| Git commit | [`3444e43`](https://github.com/NouradinAbdurahman/DevForgeKit/commit/3444e43fd40888a0292fd97d0e1d0fcf0642bc5e) (tag `v3.0.1-rc1`) |
| GitHub Release | [DevForgeKit v3.0.1-rc1](https://github.com/NouradinAbdurahman/DevForgeKit/releases/tag/untagged-a803720c497fee4d3f99) - draft, prerelease |
| npm | [`devforgekit@3.0.1-rc1`](https://www.npmjs.com/package/devforgekit) - published under `next` (and, per npm's first-publish behavior, `latest`) |
| Homebrew tap | [`NouradinAbdurahman/homebrew-devforgekit`](https://github.com/NouradinAbdurahman/homebrew-devforgekit) - published |
| CI status | Green - 5/5 required checks passing on the release commit (Core CLI, Bootstrap, Lint, Scorecard, CodeQL) |
| Test count | 1,350/1,350 passing |
| Registry count | 261 packages, 35 categories, 17 collections, 50 profiles, 8 recipes |
| Supported platforms | npm/Homebrew: macOS (Apple Silicon or Intel) or Linux. Windows: WSL, or the source install. Verified live this cycle: macOS, Apple Silicon only (see Outstanding hardware validation) |

## Known limitations

See `RELEASE_CERTIFICATION.md`'s "Known RC Limitations" section for full
detail. Summary:

- Homebrew tap is unsigned and untrusted by default (`brew doctor`) until a user explicitly taps it - expected for any new, unofficial tap.
- The still-draft GitHub Release causes `brew livecheck` to report `v3.0.0` as latest.
- npm's first-publication behavior temporarily assigns both `latest` and `next` to the RC.
- `npm install`/`npm publish` print `allow-scripts` warnings (npm 11.x behavior, not project-specific).
- The install wizard's real (non-`--dry-run`) run was not exercised end-to-end this cycle - see Outstanding hardware validation.

## Outstanding hardware validation

Every verification this cycle ran on a single machine: **macOS, Apple
Silicon**. Not yet validated:

- macOS, Intel
- Windows 11 (native npm install is unsupported - `package.json`'s `os`
  field restricts it to darwin/linux; WSL or source install only)
- Fedora (Linux, dnf)
- Arch (Linux, pacman)

None of these are release blockers for cutting an RC - they are exactly
what the RC period itself is for. They are release blockers for
promoting to stable `v3.0.1`.

## Recommendation

```
Ready for public Release Candidate testing
```

**Basis** (objective evidence only, detailed in `RELEASE_CERTIFICATION.md`):

- Full automated suite green: 1,350/1,350 tests, `scripts/validate.sh` clean, `devforgekit doctor --release-check` clean, `devforgekit rc-validate` clean modulo two documented, non-blocking, machine-local artifacts (both independently confirmed non-issues via the real `homebrew-formula.yml` CI workflow on a clean runner).
- All three distribution channels live and independently verified end-to-end against their real, public artifacts - not dry runs, not assumptions: npm (fresh install/uninstall/reinstall from the real registry), Homebrew (`tap`/`audit`/`style`/`install`/`upgrade`/`reinstall`/`uninstall`/`doctor`/`livecheck` against the real public tap), GitHub Release (draft, correct assets/checksums/SBOM/notes).
- New-developer-experience audit performed from scratch; the one real gap found (README never mentioned npm/Homebrew) is already fixed and merged.
- Zero broken internal documentation links (179 checked across 84 files), zero stray TODO/FIXME/debug markers, zero generated-file drift (registry, completions), clean `actionlint` across every workflow (one real dead-code issue found and fixed).
- Every `RELEASE.md` checklist item verified PASS - none left unknown.

**What this recommendation does not claim**: readiness for the *stable*
`v3.0.1` release. That requires the outstanding hardware validation above
plus a real RC feedback period with external users - both explicitly
deferred to the RC period itself, per design.
