#!/usr/bin/env bash
# Restores VS Code, Cursor, Git, Zsh, and mise configuration from this repo
# onto the local machine. This is the config-only subset of bootstrap.sh -
# use it when you just want to re-sync dotfiles without reinstalling
# Homebrew packages or restarting services.
#
# Usage: ./scripts/restore.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

START_TIME="$(timer_start)"
log_section "Restoring configuration from $DEV_SETUP_ROOT"

run_step "Zsh configuration" restore_zsh
run_step "Git configuration" restore_git
run_step_optional "mise runtimes" restore_mise
run_step "VS Code configuration" restore_editor vscode
run_step "Cursor configuration" restore_editor cursor

print_summary
STATUS=$?

echo "Execution time: $(timer_elapsed "$START_TIME")"
echo
log_info "Restart your shell (or run 'exec zsh') to pick up .zshrc changes."

exit $STATUS
