#!/usr/bin/env bash
# Installs Homebrew (if missing) and every package in the Brewfile, without
# touching dotfiles, editors, or services. This is the subset of
# bootstrap.sh you want when you only need packages refreshed - bootstrap.sh
# calls the same underlying functions for its own Homebrew step.
#
# Usage: ./scripts/install.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

START_TIME="$(timer_start)"
log_section "Installing Homebrew packages"

run_step "Homebrew installed" ensure_homebrew
run_step "Homebrew packages (brew bundle)" brew bundle --file="$DEV_SETUP_ROOT/Brewfile"

print_summary
STATUS=$?

echo "Execution time: $(timer_elapsed "$START_TIME")"
exit $STATUS
