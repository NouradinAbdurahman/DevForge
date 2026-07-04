# Changelog

All notable changes to this repository are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-07-04

### Added

- `scripts/common.sh` and `scripts/colors.sh` shared libraries: logging, timers,
  OS/arch detection, safe idempotent file copying, and a fault-tolerant step runner.
- `scripts/backup.sh` - captures live Zsh/Git/mise/VS Code/Cursor configuration
  back into the repo and commits/pushes only when something changed.
- `scripts/restore.sh` - restores dotfiles and editor configuration without
  touching Homebrew packages or services.
- `scripts/update.sh` - upgrades Homebrew, mise, Flutter, pnpm, Git LFS, and
  CocoaPods, then restarts and re-verifies services.
- `scripts/check.sh` - PASS/WARNING/FAIL health check across the full toolchain.
- `scripts/doctor.sh` - deep diagnostics: PATH hygiene, broken symlinks,
  permissions, Git/SSH/GitHub auth, Docker daemon state, toolchain doctors.
- `scripts/services.sh` - start/stop/restart/status for PostgreSQL, MySQL, Redis.
- `scripts/validate.sh` - shell syntax, ShellCheck, Brewfile, mise.toml, JSON,
  and Markdown validation.
- `scripts/cleanup.sh` - reclaims disk space across Homebrew, Flutter, npm/pnpm,
  mise, and Docker caches.
- `scripts/report.sh` - generates `reports/system-report.txt` with OS, hardware,
  tool versions, service state, and Git/Flutter/Docker status.
- `scripts/install.sh` - standalone Homebrew + Brewfile installer.
- GitHub Actions: `bootstrap.yml`, `shellcheck.yml`, `lint.yml`, `update.yml`,
  `release.yml`.
- `.env.example`, `LICENSE` (MIT), `VERSION`, this `CHANGELOG.md`.

### Changed

- `bootstrap.sh` rewritten to detect macOS version, CPU architecture (Apple
  Silicon vs Intel), internet connectivity, and disk space before installing
  anything; every step is now individually fault-tolerant instead of aborting
  the whole run on the first failure, and it prints a colored summary with
  total execution time.
- Dotfile/editor restoration is now idempotent: files are only copied when
  their content actually differs from what's already on disk, and any existing
  file that would be overwritten is backed up first (`*.backup-<timestamp>`).

## [0.1.0] - 2026-07-04

### Added

- Initial development environment: `bootstrap.sh`, `Brewfile`, `mise.toml`,
  `.zshrc`, `.gitconfig`, `.gitignore_global`, VS Code and Cursor settings.
