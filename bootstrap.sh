#!/usr/bin/env bash
# Provisions a complete macOS development workstation from this repository.
# Safe to run repeatedly: every step only installs or copies what is missing
# or different, and no single failed step aborts the rest of the run.
#
# Usage: ./bootstrap.sh [-y|--yes] [--skip-services] [--dry-run]
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/scripts/common.sh
source "$SCRIPT_DIR/scripts/common.sh"

SKIP_SERVICES=0
DRY_RUN=0

for arg in "$@"; do
    case "$arg" in
        -y|--yes) export DEV_SETUP_ASSUME_YES=1 ;;
        --skip-services) SKIP_SERVICES=1 ;;
        --dry-run) DRY_RUN=1; SKIP_SERVICES=1 ;;
        -h|--help)
            echo "Usage: ./bootstrap.sh [-y|--yes] [--skip-services] [--dry-run]"
            echo "  --dry-run  validate everything (Brewfile, config presence) without installing or copying anything; used by CI"
            exit 0
            ;;
        *)
            log_error "Unknown option: $arg"
            exit 1
            ;;
    esac
done

trap 'log_error "Bootstrap aborted unexpectedly at line $LINENO"' ERR

START_TIME="$(timer_start)"

echo "${COLOR_BOLD}=========================================${COLOR_RESET}"
echo "${COLOR_BOLD}  Development Environment Bootstrap${COLOR_RESET}"
echo "${COLOR_BOLD}=========================================${COLOR_RESET}"

# --------------------------------------------------------------------------
# Preflight
# --------------------------------------------------------------------------

log_section "Preflight checks"

if ! os_is_macos; then
    log_error "This bootstrap only supports macOS."
    exit 1
fi

log_info "macOS $(os_macos_version) on $(os_arch) ($([ "$(os_arch)" = "arm64" ] && echo "Apple Silicon" || echo "Intel"))"

if net_has_internet; then
    log_success "Internet connectivity detected"
else
    log_warn "No internet connectivity detected - Homebrew installs will fail"
    if ! confirm "Continue anyway?"; then
        exit 1
    fi
fi

# -P (POSIX) forces single-line output and -k (1024-byte blocks) behaves the
# same on both BSD df (stock macOS) and GNU df (if coreutils shadows it on PATH).
FREE_KB="$(df -Pk "$HOME" | awk 'NR==2 {print $4}')"
FREE_GB="$((FREE_KB / 1024 / 1024))"
if [[ "${FREE_GB:-0}" -lt 5 ]]; then
    log_warn "Only ${FREE_GB}GB free on disk - installs may fail"
    if ! confirm "Continue anyway?"; then
        exit 1
    fi
else
    log_success "${FREE_GB}GB free disk space"
fi

# --------------------------------------------------------------------------
# Homebrew
# --------------------------------------------------------------------------

log_section "Homebrew"

if [[ "$DRY_RUN" -eq 1 ]]; then
    run_step "Homebrew present" command_exists brew
    run_step_optional "Brewfile is valid (brew bundle check)" brew bundle check --file="$DEV_SETUP_ROOT/Brewfile" --no-upgrade
else
    run_step "Homebrew installed" ensure_homebrew
    run_step "Homebrew packages (brew bundle)" brew bundle --file="$DEV_SETUP_ROOT/Brewfile"
fi

# --------------------------------------------------------------------------
# Runtimes and configuration
# --------------------------------------------------------------------------

log_section "Runtimes and configuration"

if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "Skipping config restore in --dry-run mode"
    run_step "mise.toml present" test -f "$DEV_SETUP_ROOT/mise.toml"
    run_step "vscode/settings.json present" test -f "$DEV_SETUP_ROOT/vscode/settings.json"
    run_step "cursor/settings.json present" test -f "$DEV_SETUP_ROOT/cursor/settings.json"
else
    run_step "mise runtimes" restore_mise
    run_step "Zsh configuration" restore_zsh
    run_step "Git configuration" restore_git
    run_step "VS Code configuration" restore_editor vscode
    run_step "Cursor configuration" restore_editor cursor
fi

# --------------------------------------------------------------------------
# Services
# --------------------------------------------------------------------------

if [[ "$SKIP_SERVICES" -eq 0 ]]; then
    log_section "Services"
    run_step "Start PostgreSQL, MySQL, Redis" service_start_all
    sleep 2
    run_step_optional "Verify services are healthy" service_verify_all
else
    log_info "Skipping service startup (--skip-services or --dry-run)"
fi

# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------

log_section "Report"
run_step_optional "Generate system report" "$DEV_SETUP_ROOT/scripts/report.sh"

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------

print_summary
SUMMARY_OK=$?

echo
echo "${COLOR_BOLD}=========================================${COLOR_RESET}"
_check_result() {
    local label="$1" present="$2"
    if [[ "$present" -eq 0 ]]; then
        printf '%s%s%s %s\n' "$COLOR_SUCCESS" "$SYMBOL_PASS" "$COLOR_RESET" "$label"
    else
        printf '%s%s%s %s\n' "$COLOR_ERROR" "$SYMBOL_FAIL" "$COLOR_RESET" "$label"
    fi
}
_check_tool() { command_exists "$2"; _check_result "$1" $?; }
_check_tool "Homebrew" brew
_check_tool "Git" git
_check_tool "GitHub CLI" gh
_check_tool "SSH" ssh
_check_tool "Node" node
_check_tool "pnpm" pnpm
_check_tool "Java" java
_check_tool "Python" python3
_check_tool "Flutter" flutter
_android_sdk_present=0
[[ -d "${ANDROID_HOME:-$HOME/Library/Android/sdk}" ]] || _android_sdk_present=1
_check_result "Android SDK" "$_android_sdk_present"
_check_tool "Docker" docker
_check_tool "PostgreSQL" psql
_check_tool "MySQL" mysql
_check_tool "Redis" redis-cli
_check_tool "Supabase CLI" supabase
_check_tool "VS Code" code
_check_tool "Cursor" cursor
echo "${COLOR_BOLD}=========================================${COLOR_RESET}"

if [[ $SUMMARY_OK -eq 0 ]]; then
    log_success "Bootstrap completed successfully."
else
    log_warn "Bootstrap completed with failures - see summary above."
fi

echo "Execution time: $(timer_elapsed "$START_TIME")"

exit 0
