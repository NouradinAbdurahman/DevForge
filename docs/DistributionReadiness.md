# Distribution Readiness

Single source of truth for what can actually ship where, and why not yet
for everything else. Verified against real repo state, not assumed -
see the Evidence column. npm and Homebrew packaging shipped ahead of
RC1 (PRs 18-19) rather than waiting for it, since both were entirely
within this repo's own control and needed real, live verification time
regardless - see `docs/RCValidationReport.md` for the most recent full
run's results.

| Channel | Status | Reason | Evidence |
|---|---|---|---|
| GitHub Release | **Ready** | Mechanism exists and is already exercised by real prior tags. As of the RC1 finalization pass, pushing a tag now creates a **draft** release (never auto-publishes) with checksums and an SBOM attached - see "Tag process" in `RELEASE.md`. | `.github/workflows/release.yml` fires on `v*.*.*`, verifies `VERSION` matches the tag, runs `validate.sh` + `doctor --release-check`, extracts the matching `CHANGELOG.md` section, generates a health report + SBOM + `SHA256SUMS.txt`, and creates a **draft** release (`gh release create --draft`) with all of it attached. Publishing is a separate, manual `gh release edit <tag> --draft=false`. |
| npm | **Ready** (packaging) - not yet published | Root `package.json` is publishable (`"private": false`, correct `bin`/`files`/`publishConfig`), `npm pack`/`npm publish --dry-run` verified clean, a real scratch-prefix global install verified live and in CI. Publishing to the real npm registry is the one remaining step - a single `npm publish`, deliberately deferred until RC1 dogfooding confirms there's nothing left to fix. | `package.json` (repo root): `"name": "devforgekit"`, `"private": false`, `"bin": {"devforgekit": "./devforgekit"}`, `"publishConfig": {"access": "public"}`. `.github/workflows/npm-package.yml` verifies pack/dry-run/install on every push. |
| Homebrew | **Ready** (packaging) - not yet published to a real tap | `Formula/devforgekit.rb` exists, passes `brew style`/`brew audit`/`brew livecheck`, and a real `brew install --build-from-source` has been verified live and in CI. Publishing means creating a real `homebrew-devforgekit` tap repo and pushing the formula there - deliberately deferred, same reasoning as npm. | `Formula/devforgekit.rb` (checksum, `depends_on "node"`, shell completion install, `livecheck`, `test do` block). `.github/workflows/homebrew-formula.yml` verifies style/audit/install/test on every relevant push. |
| Docker | **Pending** | No `Dockerfile` exists for packaging DevForgeKit itself. | `find . -iname "Dockerfile*"` returns nothing outside `templates/docker*` (those are project-generator templates for *generated* projects, not a package image for DevForgeKit itself). |
| Winget | **Blocked** | Windows registry coverage. | `registry/completeness-baseline.json`: `windows: 55` of 261 packages (21%) have verified Windows install steps. A Winget manifest that can't actually install most of the registry isn't a real release. |
| Chocolatey | **Blocked** | Windows registry coverage (same gate as Winget). | Same 55/261 figure. |
| Scoop | **Blocked** | Windows registry coverage (same gate as Winget). | Same 55/261 figure. |
| APT | **Blocked** | Linux registry coverage. | `registry/completeness-baseline.json`: `linux: 68` of 261 packages (26%) have verified Linux install steps. |
| Pacman | **Blocked** | Linux registry coverage (same gate as APT). | Same 68/261 figure. |
| RPM | **Blocked** | Linux registry coverage (same gate as APT). | Same 68/261 figure. |

## Status definitions

- **Ready** - the mechanism exists, has been exercised for real, and
  needs no new engineering to use again.
- **Pending** - self-inflicted, not externally gated. The work is
  well-understood and entirely within this repo's control (write a
  formula, write a Dockerfile, flip a `package.json` flag and dry-run
  publish) - just not done yet. No architectural blocker.
- **Blocked** - gated on something outside this specific channel's own
  work: here, that's Windows/Linux registry completeness (`registry/
  research-queue.md` tracks the remaining packages). Building a Winget
  manifest today would ship a package manager that can't install 79% of
  the registry - not a real release, regardless of how polished the
  manifest itself is.

## Why registry coverage gates three channels each

Windows and Linux coverage are single numbers that each gate three
package managers (Winget/Chocolatey/Scoop share the Windows number; APT/
Pacman/RPM share the Linux number) - closing the coverage gap once in
`registry/research-queue.md` unblocks three channels at once per
platform, not three separate research efforts. This is the same
constraint already called out in `docs/ReleaseCandidateChecklist.md`'s
"Cross Platform: Partial" row and is real data-verification work, not
engineering.

## Ordering

Per the roadmap, **publishing** (as opposed to packaging, which is
already done for npm/Homebrew) follows this order: **GitHub Release →
Website → npm → Homebrew → Docker → Winget → Chocolatey → Scoop.**
GitHub Release always comes first since it's the source of truth every
other channel points back to (npm's `homepage`/`repository`, the
Homebrew formula's `url`, the website's release links). The three
registry-coverage-blocked channels naturally land last since nothing
else unblocks them faster than closing that gap.
