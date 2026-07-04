# Security

## What's automated in this repo

- **CodeQL** (`.github/workflows/codeql.yml`) statically analyzes
  JavaScript/TypeScript (the project templates under `templates/`) on
  every push/PR to `main` and weekly.
- **Dependency Review** (`.github/workflows/dependency-review.yml`) blocks
  PRs that introduce high-severity vulnerable dependencies or
  GPL-3.0/AGPL-3.0-licensed packages.
- **OSSF Scorecard** (`.github/workflows/scorecard.yml`) scores the repo's
  supply-chain security posture (branch protection, pinned actions,
  dangerous workflow patterns, etc.) weekly and on push to `main`, uploaded
  to Code Scanning.
- **Dependabot** and **Renovate** keep GitHub Actions, npm/pnpm, Docker,
  and Terraform dependencies current (see
  [GitHubActions.md](GitHubActions.md)).
- **ShellCheck** (`.github/workflows/shellcheck.yml`) and `scripts/validate.sh`
  catch shell injection-prone patterns (unquoted variables, word
  splitting) before they ship.

## What you need to enable manually (repo settings, not code)

GitHub's **Secret Scanning** and **Push Protection** are repository
settings, not something a workflow file can turn on for a public/private
repo you own:

1. GitHub -> this repo -> **Settings -> Code security**.
2. Enable **Secret scanning**.
3. Enable **Push protection** (blocks pushes that contain a detected
   secret, rather than just alerting after the fact).

For private repos this requires GitHub Advanced Security; for public repos
both are free.

## Secrets handling in this repo

- Real secrets never belong in the repo. `.env.example` documents the
  expected variables (`SUPABASE_*`, `GITHUB_TOKEN`, `AWS_*`, etc.) -
  copy it to `.env` (gitignored) and fill in real values there.
- `vscode/settings.json` and `cursor/settings.json` contain a live `mssql`
  connection profile block. Treat any credentials-shaped field there as
  sensitive even when currently blank - don't add real passwords to files
  that get copied verbatim to `$HOME` and committed to this repo.
- `preferences/*.plist` (macOS preference backups) and `reports/*.txt`
  `reports/*.md` (generated inventory/health reports) are gitignored by
  default, since they can contain machine-identifying details (hostnames,
  local IPs, installed-app lists). Remove those `.gitignore` entries only
  if you deliberately want to version that data.

## Reporting a vulnerability

This is a personal workstation-provisioning repo, not a library with
external consumers, so there's no formal disclosure program. If you find a
security issue, open a GitHub issue or contact the repository owner
directly rather than filing a public PR with exploit details.
