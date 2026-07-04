# GitHub Actions

All workflows live in `.github/workflows/`. Each workflow's display name in
the Actions tab is prefixed `DevForgeKit` (e.g. `bootstrap.yml` shows as
"DevForgeKit Bootstrap") - the table below uses filenames since those don't
change.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `bootstrap.yml` | push, PR | Runs `./bootstrap.sh --yes --dry-run` on `macos-latest`; uploads the generated report as an artifact |
| `shellcheck.yml` | push/PR touching `*.sh` | `shellcheck -x` on every script |
| `lint.yml` | push, PR | `bash -n` syntax check, `jq empty` on every JSON file, `markdownlint-cli` on every Markdown file |
| `update.yml` | weekly (Mon 09:00 UTC), manual | `brew update && brew outdated`, posted to the job summary |
| `release.yml` | push of tag `v*.*.*` | Verifies `VERSION` matches the tag, runs `validate.sh`, extracts the matching CHANGELOG section, generates a health report, and publishes a GitHub Release (titled "DevForgeKit vX.Y.Z") with `Brewfile`/`README.md`/`CHANGELOG.md`/`VERSION`/`health-report.txt` attached |
| `codeql.yml` | push/PR to `main`, weekly | CodeQL static analysis across `actions`, `javascript-typescript`, and `python` (see [Architecture.md#codeqls-language-matrix](Architecture.md#codeqls-language-matrix) for why Ruby is deliberately excluded) |
| `dependency-review.yml` | every PR | Flags high-severity vulnerabilities and disallowed licenses (GPL-3.0, AGPL-3.0) in dependency changes |
| `scorecard.yml` | push to `main`, weekly, branch protection changes | [OSSF Scorecard](https://github.com/ossf/scorecard) supply-chain security score, uploaded to Code Scanning |

## Dependency automation

Both **Dependabot** (`.github/dependabot.yml`) and **Renovate**
(`renovate.json`) are configured, covering GitHub Actions, npm/pnpm
(per JS/TS template), Docker, and Terraform. Homebrew has no native
Dependabot ecosystem and this repo's `Brewfile` doesn't pin formula
versions, so Homebrew staleness is instead caught by the weekly
`update.yml` job.

Running both Dependabot and Renovate on the same repo will produce
duplicate PRs for the same bump. Pick one; Renovate is left enabled by
default here for its grouping/dependency-dashboard/automerge features, but
either config is ready to use - disable the other in each tool's platform
settings (not just by deleting the config file) if you only want one.

Renovate auto-merges **patch** updates once CI passes; minor and major
updates always require manual review (`renovate.json`'s `packageRules`).

## Release flow

1. `./scripts/release.sh patch|minor|major` bumps `VERSION`, drafts a
   CHANGELOG entry from commits since the last tag, commits, tags, and
   pushes (see [ReleaseProcess.md](ReleaseProcess.md)).
2. Pushing the `vX.Y.Z` tag triggers `release.yml`, which builds and
   publishes the actual GitHub Release. `release.sh` deliberately does not
   duplicate that logic.

## Required permissions

- `release.yml`, `scorecard.yml`: `contents: write` / `security-events:
  write` as needed to publish releases and upload SARIF.
- `dependency-review.yml`, `codeql.yml`: read-only plus
  `security-events: write` for CodeQL's SARIF upload.

## Secret scanning & push protection

This repo doesn't (and shouldn't) manage GitHub's repository-level Secret
Scanning / Push Protection settings via a workflow file - they're toggled
in the GitHub UI (**Settings -> Code security**), not in-repo config. See
[Security.md](Security.md) for what to enable and why.
