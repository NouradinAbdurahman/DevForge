# Customization

- **Packages**: add or remove entries in `Brewfile` (grouped by `brew`,
  `cask`, `vscode`, and `npm` prefixes; each `brew`/`cask` line keeps a
  one-line comment explaining what it's for - preserve that convention for
  new entries).
- **Runtime versions**: edit `mise.toml` (Java, Node, Python). Don't add
  runtime version pins to `Brewfile`/`.zshrc` for anything mise already
  manages.
- **Shell**: edit `.zshrc` - it's restored verbatim to `~/.zshrc` by
  `restore_zsh` (`scripts/common.sh`).
- **Editors**: `vscode/` and `cursor/` are parallel, independent
  directories (`settings.json`, `keybindings.json`, `extensions.txt`) -
  not symlinked or generated from a shared source. Update both when a
  change should apply to both editors.
- **Services**: `SERVICE_LIST` in `scripts/common.sh` controls which
  Homebrew services `bootstrap.sh`/`scripts/services.sh` start, stop, and
  verify (currently `postgresql@17`, `mysql`, `redis`).
- **Preferences backed up**: `preference_domain_pairs()` in
  `scripts/common.sh` is the single source of truth for which `defaults`
  domains `scripts/preferences.sh` covers - add a `domain|filename|optional`
  line there to track a new one.
- **Mirrored config files**: `config_file_pairs()` in `scripts/common.sh`
  is the equivalent source of truth for `scripts/backup.sh`/`restore.sh`.
- **Secrets**: copy `.env.example` to `.env` and fill in real values -
  `.env` is gitignored and never restored/backed up by any script.
- **New scripts**: follow the pattern in
  [Architecture.md](Architecture.md#the-step-runner-pattern) - source
  `common.sh`, use `run_step`/`run_step_optional`/`record_result`, end with
  `if print_summary; then exit 0; else exit 1; fi`.
- **Project templates**: `templates/` is independent of the rest of the
  repo - add a new stack by creating `templates/<name>/` with a `README.md`,
  `.gitignore`, `.editorconfig`, `LICENSE`, and a genuinely working minimal
  example (see [Templates.md](Templates.md)).
