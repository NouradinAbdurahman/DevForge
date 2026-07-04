#!/usr/bin/env bash
# Captures the current live configuration (Zsh, Git, mise, VS Code, Cursor)
# back into this repository, then commits and pushes only if something
# actually changed. Safe to run repeatedly - it never creates empty commits.
#
# Usage: ./scripts/backup.sh [-y|--yes]
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

for arg in "$@"; do
    case "$arg" in
        -y|--yes) export DEV_SETUP_ASSUME_YES=1 ;;
    esac
done

START_TIME="$(timer_start)"
log_section "DevForge Backup"
log_info "Capturing live configuration into $DEV_SETUP_ROOT"

# --------------------------------------------------------------------------
# Plain config files: mise.toml, .zshrc, .gitconfig, .gitignore_global
# --------------------------------------------------------------------------

while IFS='|' read -r repo_path home_path; do
    [[ -z "$repo_path" ]] && continue
    if [[ -f "$home_path" ]]; then
        run_step_optional "Captured $repo_path" fs_safe_copy "$home_path" "$DEV_SETUP_ROOT/$repo_path"
    else
        log_warn "$home_path does not exist yet, skipping"
    fi
done < <(config_file_pairs | grep -v '^vscode/\|^cursor/')

# --------------------------------------------------------------------------
# Editors
# --------------------------------------------------------------------------

run_step_optional "Captured VS Code settings/keybindings/extensions" backup_editor vscode
run_step_optional "Captured Cursor settings/keybindings/extensions" backup_editor cursor

# --------------------------------------------------------------------------
# Bump CHANGELOG "Unreleased" timestamp marker (best effort, non-fatal)
# --------------------------------------------------------------------------

if [[ -f "$DEV_SETUP_ROOT/CHANGELOG.md" ]]; then
    log_step "CHANGELOG.md left untouched - edit manually to describe this backup if needed"
fi

print_summary || true

# --------------------------------------------------------------------------
# Commit and push, only if something changed
# --------------------------------------------------------------------------

log_section "Git"
cd "$DEV_SETUP_ROOT"

if [[ -z "$(git status --porcelain)" ]]; then
    log_info "No changes to commit"
    echo "Execution time: $(timer_elapsed "$START_TIME")"
    exit 0
fi

git status --short

if confirm "Commit and push these changes?"; then
    git add -A
    git commit -m "chore: DevForge backup ($(date +%Y-%m-%d))"
    git push
    log_success "Backup committed and pushed"
else
    log_info "Changes staged locally but not committed (declined)"
fi

echo "Execution time: $(timer_elapsed "$START_TIME")"
