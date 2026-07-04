#!/usr/bin/env bash
# Reclaims disk space: Homebrew, Flutter, npm/pnpm, mise, and Docker caches,
# plus stray temp files and old DevForgeKit logs/backups.
#
# Usage: ./scripts/cleanup.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

START_TIME="$(timer_start)"
log_section "DevForgeKit Clean"
log_info "Cleaning up caches and temporary files"

if command_exists brew; then
    run_step_optional "brew cleanup -s" brew cleanup -s
    run_step_optional "Remove stale Homebrew downloads" brew cleanup --prune=all
else
    log_warn "Homebrew not installed, skipping"
fi

if command_exists flutter; then
    run_step_optional "flutter clean cache" flutter pub cache clean
else
    log_warn "flutter not installed, skipping"
fi

if command_exists npm; then
    run_step_optional "npm cache clean" npm cache clean --force
else
    log_warn "npm not installed, skipping"
fi

if command_exists pnpm; then
    run_step_optional "pnpm store prune" pnpm store prune
else
    log_warn "pnpm not installed, skipping"
fi

if command_exists mise; then
    run_step_optional "mise cache clear" mise cache clear
else
    log_warn "mise not installed, skipping"
fi

if command_exists docker && docker info >/dev/null 2>&1; then
    run_step_optional "docker system prune -f" docker system prune -f
else
    log_warn "Docker not installed or not running, skipping"
fi

log_step "Removing stray temp files..."
run_step_optional "Remove .DS_Store files under \$HOME (top level)" find "$HOME" -maxdepth 2 -name ".DS_Store" -delete

log_step "Pruning DevForgeKit config backups older than 30 days..."
run_step_optional "Prune old *.backup-* files" find "$DEV_SETUP_ROOT" -name "*.backup-*" -mtime +30 -delete

if print_summary; then
    STATUS=0
else
    STATUS=1
fi

echo "Execution time: $(timer_elapsed "$START_TIME")"
exit $STATUS
