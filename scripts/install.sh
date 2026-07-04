#!/usr/bin/env bash
# Installs Homebrew (if missing) and every package in the Brewfile, without
# touching dotfiles, editors, or services. This is the subset of
# bootstrap.sh you want when you only need packages refreshed - bootstrap.sh
# calls the same underlying functions for its own Homebrew step.
#
# Usage: ./scripts/install.sh [--profile <name>|--minimal|--full]
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

PROFILE_ARG=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --profile)
            [[ $# -ge 2 ]] || { log_error "--profile requires a value (see: ./scripts/profile.sh list)"; exit 1; }
            PROFILE_ARG="$2"
            shift 2
            ;;
        --minimal) PROFILE_ARG="minimal"; shift ;;
        --full) PROFILE_ARG="full"; shift ;;
        -h|--help)
            echo "Usage: $0 [--profile <name>|--minimal|--full]"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

PROFILE="$(resolve_profile "$PROFILE_ARG")"
BREWFILE_PATH="$(profile_brewfile_path "$PROFILE")"
if [[ ! -f "$BREWFILE_PATH" ]]; then
    log_error "Unknown profile '$PROFILE' (no such file: $BREWFILE_PATH). Run './scripts/profile.sh list' to see available profiles."
    exit 1
fi

START_TIME="$(timer_start)"
log_section "DevForgeKit Install"
log_info "Installing Homebrew packages"
log_info "Profile: $PROFILE ($BREWFILE_PATH)"

run_step "Homebrew installed" ensure_homebrew
run_step "Homebrew packages (brew bundle)" brew bundle --file="$BREWFILE_PATH"

if print_summary; then
    STATUS=0
else
    STATUS=1
fi

echo "Execution time: $(timer_elapsed "$START_TIME")"
exit $STATUS
