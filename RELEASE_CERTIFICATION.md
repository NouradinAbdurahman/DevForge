# v3.0.1-rc1 Release Certification

The canonical release record for the v3.0.1 release cycle: every distribution
channel, every verification step actually performed, every known limitation,
and the reasoning behind every non-obvious release decision. Written once the
release-candidate work was complete, not maintained retroactively - later
corrections belong in the "Corrections" convention already established by
`docs/releases/3.0.1-rc1-publish.md`, appended below rather than rewriting
history.

**Status: Release Candidate.** Not yet promoted to stable. See
[RC period](#rc-period) below for what happens next.

## Distribution channels

| Channel | Status | Reference |
|---|---|---|
| GitHub Release | Draft, not published | [`v3.0.1-rc1`](https://github.com/NouradinAbdurahman/DevForgeKit/releases/tag/untagged-a803720c497fee4d3f99) (draft URL - becomes `.../releases/tag/v3.0.1-rc1` once published) |
| npm | **Published**, `next` tag | [`devforgekit@3.0.1-rc1`](https://www.npmjs.com/package/devforgekit) - `npm install -g devforgekit@next` |
| Homebrew | **Published** | [`NouradinAbdurahman/homebrew-devforgekit`](https://github.com/NouradinAbdurahman/homebrew-devforgekit) - `brew tap NouradinAbdurahman/devforgekit && brew install devforgekit` |
| Source | Always available | `git clone` + `./devforgekit install` |

Both npm and Homebrew currently install the *same* `v3.0.1-rc1` build - there
is no separate "stable" track to fall back to yet, since this is the first
release cycle to go through either channel for real. See
[Release decisions](#release-decisions) for why that's intentional rather
than an oversight.

## Verification performed

Everything below was run for real against the actual published artifacts -
never assumed from reading code, and never claimed without the command that
produced it.

### Automated

- Full test suite: **1,350/1,350 passing** (`npm test --prefix cli`).
- `shellcheck -x` clean across every modified/new shell script.
- `./scripts/validate.sh` clean (shell syntax, ShellCheck, Brewfile, mise.toml, JSON, YAML, Markdown).
- `devforgekit doctor --release-check` passes against the real downloaded release tarball (version consistency, required docs, distribution artifacts, registry health, git tree, CI status).
- CI green on every required check across PRs #22-#31 (`lint`, `test`, `dry-run`, CodeQL `analyze` (JS/TS + Python), `shellcheck`, `pack-and-verify` (macOS + Ubuntu), `formula-test`).

### npm channel

- `npm publish --dry-run --tag next` verified before the real publish.
- Real publish completed (required interactive 2FA/OTP - done by the package owner directly, not automatable).
- `npm view devforgekit` / `version` / `versions` / `dist-tags` confirmed post-publish: integrity hash, version, and tags all correct.
- Fresh install into a scratch prefix (`npm install -g devforgekit@next`) from the real, live registry - not a local tarball.
- `devforgekit --version`, `doctor`, `check`, `completion install`, `completion doctor` all verified against the real installed package.
- `npm uninstall -g devforgekit` - fully clean, 0 files remaining.
- Reinstall after uninstall - works identically.
- Consumer audit (separate from the above, run before publishing): `npm pack` contents match expectations, install from the packed `.tgz` (not the repo) from an unrelated directory, PATH integration via npm's own `bin` mechanism, no hardcoded reference to the source repo's location anywhere in the installed package.

### Homebrew channel

- Real sha256 computed against the actual GitHub-generated `v3.0.1-rc1` tarball (`shasum -a 256`, never hand-typed, matching the formula's own documented update flow).
- Formula tested locally against a scratch tap before the public tap existed.
- Public tap repository created: `NouradinAbdurahman/homebrew-devforgekit`.
- Full lifecycle tested against the real, live public tap:
  - `brew tap NouradinAbdurahman/devforgekit` - succeeds.
  - `brew audit --formula` - clean, no findings.
  - `brew style` - "1 file inspected, no offenses detected".
  - `brew install` - builds cleanly (6,541 files, 22MB, ~4s), `devforgekit --version`/`doctor` correct afterward, all three shells' completions installed to their real Homebrew-managed locations (`zsh`: `site-functions/_devforgekit`; `bash`: `etc/bash_completion.d/devforgekit.bash`; `fish`: `vendor_completions.d/devforgekit.fish`).
  - `brew upgrade` - correctly reports already up to date (only one formula revision exists yet).
  - `brew reinstall` - clean, no errors, version unchanged.
  - `brew uninstall` - fully clean removal, command no longer resolves.
  - `brew doctor` - see [Known limitations](#known-limitations) (tap-trust warning, expected).
  - `brew livecheck` - see [Known limitations](#known-limitations) (reports "behind" due to the still-draft GitHub Release, expected).

### New-developer-experience audit

Performed from scratch, treating the project as genuinely unfamiliar:
starting from the GitHub repository page, reading only the public README and
`docs/CommandReference.md`, installing via npm, running the install wizard
(`--dry-run`, since a real run performs genuine system-wide Homebrew
installs with no scratch-prefix equivalent - see the note in
[Known limitations](#known-limitations)), and generating a real first
project end-to-end.

**Found and fixed** (this is the one category of finding that was a genuine
DevForgeKit-side gap, not a third-party tool quirk):

- The README's Installation section only ever showed `git clone` +
  `bootstrap.sh` - no mention of npm or Homebrew anywhere, despite npm being
  the whole point of a fast, lightweight install. A first-time visitor would
  never discover `npm install -g devforgekit@next` (timed for real: ~6
  seconds end-to-end). Fixed in #31: npm promoted to the primary
  documented install method, Homebrew second, source build reframed as the
  advanced/contributing option. Stale version badge (`3.0.0`) and
  test-count badges (`1,299`) corrected across five locations. Quick
  Start and Troubleshooting/FAQ command examples switched from
  `./devforgekit` (only correct for a source checkout) to the global
  `devforgekit` a package install actually gives you. Commands table
  gained the `completion` row.

**Verified working well, no changes needed:**

- `--help` output: comprehensive, well-organized, real copy-pasteable examples.
- Error handling: `error: unknown command 'frobnicate'` is clear; a missing required argument (`devforgekit new`) falls into a friendly interactive picker instead of a bare error.
- No broken internal documentation links (checked every `docs/*.md` reference in the README).
- All four referenced screenshot images and the banner image exist on disk; README fetched directly from GitHub post-fix shows no broken markdown, tables, or images.
- Real project generation (`devforgekit new express my-first-api --license mit --auth --prisma --swagger --docker`): produces a complete, well-structured project (git initialized, README, LICENSE, Dockerfile, CI workflow, tests/), generated code passes `node --check`, `npm install` succeeds, the printed "Next commands" list is accurate.
- The install wizard's step-numbered (`Step N/8`) dry-run flow is clear and produces an accurate health-score summary.

## Known limitations

Real, observed behaviors of the underlying package managers and GitHub
itself - not DevForgeKit defects, and not things DevForgeKit's own code can
suppress. Documented here so they don't get mistaken for bugs during the RC
period.

- **`npm install`/`npm publish` print `allow-scripts` warnings.** npm 11.x's
  allow-scripts gate can skip a package's `postinstall` script by default,
  including DevForgeKit's own (which only populates `cli/node_modules` - the
  `devforgekit` dispatcher self-heals this transparently on first run,
  printing its own clear "Setting up..." message) and, separately, any
  generated project that depends on Prisma (whose own postinstall runs
  `prisma generate`). Both are inherent npm 11.x behavior, not specific to
  this project.
- **`brew doctor` reports the tap as "not trusted."** Expected for any new,
  unofficial Homebrew tap - Homebrew's tap-trust feature, unrelated to this
  tap's actual content (confirmed: real installs/builds/links/uninstalls all
  worked correctly despite the warning).
- **`brew livecheck` reports `3.0.1-rc1 ==> 3.0.0`** - i.e. suggests the
  formula is "ahead of" the latest available version. This is because the
  `v3.0.1-rc1` GitHub Release is still a **draft** (not published), so
  GitHub's own "latest release" marker still points at the real, published
  `v3.0.0`. `livecheck` is behaving exactly as designed (comparing against
  GitHub's actual public release marker); the RC's use of an unpublished
  draft is what creates the mismatch. Resolves once a release is published.
- **npm's `latest` dist-tag currently also resolves to `3.0.1-rc1`.** npm
  always assigns `latest` to a package's very first publish, regardless of
  `--tag` - there was no prior stable version for it to keep pointing at.
  Deliberately left as-is (see [Release decisions](#release-decisions)) -
  resolves automatically the moment a real `v3.0.1` stable is published.
  Documented in detail in `docs/releases/3.0.1-rc1-publish.md`.
- **The install wizard's real (non-`--dry-run`) run was not exercised
  end-to-end during this audit.** Homebrew has no scratch-prefix equivalent
  to npm's - a real run genuinely installs formulae system-wide, so testing
  it live against the maintainer's own development machine was
  deliberately avoided rather than risking dozens of unwanted package
  installs. `--dry-run` was exercised fully instead (accurately reports
  what would happen, matches documented behavior). A real end-to-end run
  belongs on an actual clean/disposable machine, called out explicitly as
  outstanding for the RC feedback period.
- **The maintainer's own development machine's global `devforgekit` symlink
  was left pointing at the just-uninstalled Homebrew Cellar path** after
  Homebrew lifecycle testing (`brew uninstall` removed the pre-existing
  symlink that pointed at the source checkout; recreating it manually
  outside the project's own install tooling was correctly declined pending
  the maintainer's own choice of how to restore it - not something an
  agent should improvise). Machine-local, not a release-blocking issue.

## Release decisions

Brief rationale for the non-obvious calls made this cycle, each with a
pointer to where the full reasoning lives.

- **`v3.0.0-rc1` was abandoned in favor of `v3.0.1-rc1`.** The original tag
  numbering was a real bug (`release.sh rc` appended `-rc1` to an
  already-shipped, already-tagged `3.0.0` without bumping forward first,
  producing a version lower than the real release it was meant to be a
  candidate for). Full writeup: `docs/ReleaseArchitecture.md`, PR #26.
- **The release process is two-phase (`create` then `finalize`)**, tagging
  only happens after a release PR merges to `main`, never before - required
  by this repo's branch-protection ruleset (`bypass_actors: []`, no one can
  push directly to `main`, including admins). Full writeup:
  `docs/ReleaseArchitecture.md`.
- **npm's `latest` dist-tag was deliberately left pointing at the RC**
  rather than removed. Removing it would leave a tagless
  `npm install -g devforgekit` with no default version to resolve at all
  (`ERR! No matching version found`) - worse than a short-lived
  RC-as-latest for a package's first-ever publish. Full writeup:
  `docs/releases/3.0.1-rc1-publish.md`.
- **The Homebrew tap points at `v3.0.1-rc1`, not the older real `v3.0.0`.**
  Homebrew has no equivalent of npm's `next`/`latest` dual-tag system -
  whatever the formula's `url` points at is what every `brew install` gets.
  Since the entire point of the RC period is testing this exact build
  across every channel, pointing Homebrew at the stale `v3.0.0` would have
  made Homebrew testers validate different code than npm testers. The
  formula will be bumped again when `v3.0.1` stable ships - "no reason to
  maintain two different RC builds."
- **Two pre-existing TUI test timing budgets were widened (2000ms →
  5000ms)**, found while chasing what looked like flaky CI on PR #28: both
  failed 3 times in a row under real concurrent full-suite load, each only
  marginally over budget (not a real hang), and the suite has grown from
  1,088 to 1,350 tests since those budgets were set. `tui-resize.test.js`'s
  separate copy of the same helper was left untouched - not implicated in
  any observed failure, and a speculative change without evidence isn't a
  real fix.

## RC period

Per the maintainer's own stated policy from this point forward: **no new
features**. Only:

- installation bugs
- crashes
- security issues
- packaging issues
- documentation fixes

Everything else is deferred to v3.1.

**Promotion to stable (`v3.0.1`)**, once RC feedback is clean:

1. Merge any accepted fixes.
2. `npm dist-tag add devforgekit@3.0.1 latest` (or a plain `npm publish` for the real `3.0.1`, which moves `latest` forward on its own).
3. Update the Homebrew formula's `url`/`sha256` to the real `v3.0.1` tag.
4. Publish the GitHub Release (`gh release edit v3.0.1 --draft=false`, or the equivalent for whatever tag `3.0.1` actually lands on).
5. Update the website and announce.

## Corrections

<!-- Append dated notes below this line as issues are found during the RC period. Never rewrite the sections above. -->
