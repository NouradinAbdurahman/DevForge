#!/usr/bin/env bash
# Provisions a complete macOS development workstation from this repository.
# Safe to run repeatedly: every step only installs or copies what is missing
# or different, and no single failed step aborts the rest of the run.
#
# Usage: ./bootstrap.sh [-y|--yes] [--skip-services] [--dry-run]
#                        [--profile <name>|--minimal|--full]
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/scripts/common.sh
source "$SCRIPT_DIR/scripts/common.sh"

SKIP_SERVICES=0
DRY_RUN=0
PROFILE_ARG=""

# A while/shift loop (not `for arg in "$@"`) because --profile takes a
# following value.
while [[ $# -gt 0 ]]; do
    case "$1" in
        -y|--yes) export DEV_SETUP_ASSUME_YES=1; shift ;;
        --skip-services) SKIP_SERVICES=1; shift ;;
        --dry-run) DRY_RUN=1; SKIP_SERVICES=1; shift ;;
        --profile)
            [[ $# -ge 2 ]] || { log_error "--profile requires a value (see: devforgekit profile list)"; exit 1; }
            PROFILE_ARG="$2"
            shift 2
            ;;
        --minimal) PROFILE_ARG="minimal"; shift ;;
        --full) PROFILE_ARG="full"; shift ;;
        -h|--help)
            echo "Usage: ./bootstrap.sh [-y|--yes] [--skip-services] [--dry-run] [--profile <name>|--minimal|--full]"
            echo "  --dry-run          validate everything (Brewfile, config presence) without installing or copying anything; used by CI"
            echo "  --profile <name>   install only that profile's Brewfile subset (see: devforgekit profile list)"
            echo "  --minimal          shorthand for --profile minimal"
            echo "  --full             shorthand for --profile full (everything in the root Brewfile - the default)"
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

# An EXIT trap (not ERR) so this only fires when the script is actually
# terminating with a failure - an ERR trap would also fire for failures
# already handled inside run_step/run_step_optional (they run under
# `set +e` internally, but bash still invokes an inherited ERR trap for
# the failing command itself, which is misleading noise for tolerated steps).
# shellcheck disable=SC2154 # _status is assigned earlier in this same trap string
trap '_status=$?; [[ $_status -ne 0 ]] && log_error "Bootstrap aborted unexpectedly (exit $_status)"' EXIT

START_TIME="$(timer_start)"

echo "${COLOR_BOLD}=========================================${COLOR_RESET}"
echo "${COLOR_BOLD}  Welcome to DevForgeKit${COLOR_RESET}"
echo "${COLOR_BOLD}=========================================${COLOR_RESET}"

# --------------------------------------------------------------------------
# Preflight
# --------------------------------------------------------------------------

log_section "Preflight checks"
log_info "Preparing your machine..."

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

log_info "Installing packages..."
log_info "Profile: $PROFILE ($BREWFILE_PATH)"

if [[ "$DRY_RUN" -eq 1 ]]; then
    run_step "Homebrew present" command_exists brew
    run_step_optional "Brewfile is valid (brew bundle check)" brew bundle check --file="$BREWFILE_PATH" --no-upgrade
else
    run_step "Homebrew installed" ensure_homebrew
    run_step "Homebrew packages (brew bundle)" brew bundle --file="$BREWFILE_PATH"
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
# Global command
# --------------------------------------------------------------------------

log_section "Global command"

if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "Skipping global command symlink in --dry-run mode"
else
    run_step_optional "Install devforgekit as a global command" install_global_command
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
log_info "Running health checks..."
run_step_optional "Generate system report" "$DEV_SETUP_ROOT/scripts/report.sh"

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------

# Not a bare `print_summary; X=$?`: print_summary's exit status reflects
# whether any step FAILed, and under `set -e` a bare failing statement here
# would abort the script before the checklist/timing below ever printed.
if print_summary; then
    SUMMARY_OK=0
else
    SUMMARY_OK=1
fi

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
_check_tool() {
    if command_exists "$2"; then
        _check_result "$1" 0
    else
        _check_result "$1" 1
    fi
}
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
_check_tool "DevForgeKit" devforgekit
echo "${COLOR_BOLD}=========================================${COLOR_RESET}"

print_health_score

if [[ $SUMMARY_OK -eq 0 ]]; then
    log_success "DevForgeKit installation completed successfully."
else
    log_warn "DevForgeKit installation completed with failures - see summary above."
fi

echo "Execution time: $(timer_elapsed "$START_TIME")"

exit 0
