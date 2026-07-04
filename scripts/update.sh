#!/usr/bin/env bash
# Upgrades every managed toolchain (Homebrew, mise, Flutter/Dart, pnpm,
# Git LFS, CocoaPods) and restarts services if their binaries changed.
#
# Usage: ./scripts/update.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

START_TIME="$(timer_start)"
log_section "Updating DevForgeKit"
log_info "Upgrading every managed toolchain"

if command_exists brew; then
    run_step "brew update" brew update
    run_step "brew upgrade" brew upgrade
    run_step_optional "brew cleanup" brew cleanup
else
    log_warn "Homebrew not installed, skipping brew steps"
fi

if command_exists mise; then
    run_step_optional "mise self-update" mise self-update -y
    run_step "mise upgrade" mise upgrade
    run_step "mise install" mise install
else
    log_warn "mise not installed, skipping mise steps"
fi

if command_exists flutter; then
    run_step_optional "flutter upgrade" flutter upgrade
    run_step_optional "flutter precache" flutter precache
else
    log_warn "flutter not installed, skipping Flutter steps"
fi

if command_exists dart; then
    run_step_optional "dart pub global activate (no-op if none configured)" true
else
    log_warn "dart not installed, skipping Dart steps"
fi

if command_exists pnpm; then
    run_step_optional "pnpm update -g" pnpm update -g
else
    log_warn "pnpm not installed, skipping pnpm update"
fi

if command_exists git-lfs; then
    run_step_optional "git lfs update" git lfs update --force
else
    log_warn "git-lfs not installed, skipping"
fi

if command_exists pod; then
    run_step_optional "pod repo update" pod repo update
    run_step_optional "pod setup" pod setup
else
    log_warn "CocoaPods not installed, skipping"
fi

log_section "Restarting services"
run_step_optional "Restart PostgreSQL, MySQL, Redis" service_restart_all
run_step_optional "Verify services are healthy" service_verify_all

if print_summary; then
    STATUS=0
else
    STATUS=1
fi

echo "Execution time: $(timer_elapsed "$START_TIME")"
exit $STATUS
