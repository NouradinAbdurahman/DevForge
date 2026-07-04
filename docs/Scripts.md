# Scripts reference

All scripts live in `scripts/` and share `scripts/common.sh` +
`scripts/colors.sh`. `bootstrap.sh` and `dev` live at the repo root since
they're entry points. See [CLI.md](CLI.md) for `./dev`, the dispatcher
that fronts everything below.

| Script | Purpose | Mutates the machine? |
| --- | --- | --- |
| `bootstrap.sh` | Full provision: Homebrew, mise, dotfiles, editors, services, report | Yes (or `--dry-run` for none) |
| `scripts/install.sh` | Homebrew + Brewfile (or profile subset) only | Yes |
| `scripts/restore.sh` | Dotfiles + editor config only | Yes |
| `scripts/backup.sh` | Live config -> repo, commit + push if changed | Yes (git) |
| `scripts/update.sh` | Upgrade Homebrew/mise/Flutter/pnpm/Git LFS/CocoaPods, restart services | Yes |
| `scripts/check.sh` | Fast PASS/WARNING/FAIL sweep + health score | No |
| `scripts/doctor.sh` | Deep diagnostics (PATH, PATH manager, symlinks, perms, daemons, doctors) + health score; `--fix` writes missing PATH entries | `--fix` mutates `~/.zshrc`; otherwise no |
| `scripts/services.sh` | `start\|stop\|restart\|status` for Postgres/MySQL/Redis | Yes (services only) |
| `scripts/validate.sh` | Shell syntax, ShellCheck, Brewfile (+ profiles), mise.toml, JSON, YAML, Markdown | No |
| `scripts/cleanup.sh` | Reclaim disk space across every cache | Yes (deletes caches) |
| `scripts/report.sh` | Write `reports/system-report.txt` | No |
| `scripts/inventory.sh` | Write 9 Markdown reports under `reports/` | No |
| `scripts/preferences.sh` | `backup\|restore\|status` for macOS UI preferences | `restore` mutates; others don't |
| `scripts/profile.sh` | `list\|show\|use` - manage install profiles | `use` writes `.devprofile` |
| `scripts/release.sh` | Bump VERSION, draft CHANGELOG, commit, tag, push | Yes (git, on confirmation) |

## Usage

```bash
./bootstrap.sh [-y|--yes] [--skip-services] [--dry-run] [--profile <name>|--minimal|--full]
./scripts/install.sh [--profile <name>|--minimal|--full]
./scripts/restore.sh
./scripts/backup.sh [-y|--yes]
./scripts/update.sh
./scripts/check.sh
./scripts/doctor.sh [--fix]
./scripts/services.sh <start|stop|restart|status>
./scripts/validate.sh
./scripts/cleanup.sh
./scripts/report.sh
./scripts/inventory.sh
./scripts/preferences.sh <backup|restore|status>
./scripts/profile.sh <list|show|use> [name]
./scripts/release.sh <patch|minor|major> [-y|--yes]
```

Or via the CLI (`./dev <command>`, see [CLI.md](CLI.md)) - identical
behavior, shorter to type.

`-y`/`--yes` (or `DEV_SETUP_ASSUME_YES=1`) answers every confirmation
prompt with "yes" - use it for unattended/CI runs.

## `scripts/common.sh` function index

- **Logging**: `log_info`, `log_success`, `log_warn`, `log_error`,
  `log_step`, `log_section`
- **Timing**: `timer_start`, `timer_elapsed`
- **Detection**: `command_exists`, `os_is_macos`, `os_arch`,
  `os_brew_prefix`, `os_macos_version`, `net_has_internet`
- **Confirmation**: `confirm` (honors `DEV_SETUP_ASSUME_YES` and
  non-interactive shells)
- **Filesystem**: `fs_ensure_dir`, `fs_safe_copy` (idempotent, auto-backs-up
  differing files)
- **Version strings**: `version_of <bin> [args...]`
- **Config maps**: `config_file_pairs`, `preference_domain_pairs`
- **Profiles**: `profile_brewfile_path <name>`, `resolve_profile [explicit]`
  (see [Profiles.md](Profiles.md))
- **PATH manager**: `path_manager_known_dirs`, `path_manager_check`,
  `path_manager_fix` (see `scripts/doctor.sh --fix`)
- **Homebrew**: `ensure_homebrew`, `brew_load_shellenv`
- **Restore**: `restore_zsh`, `restore_git`, `restore_mise`,
  `restore_editor <vscode|cursor>`, `backup_editor <vscode|cursor>`
- **Services**: `service_start_all`, `service_stop_all`,
  `service_restart_all`, `service_status_all`, `service_verify_all`
- **Step runner**: `run_step`, `run_step_optional`, `record_result`,
  `print_summary`, `print_health_score`
