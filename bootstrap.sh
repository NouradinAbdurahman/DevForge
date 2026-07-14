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
# shellcheck source=SCRIPTDIR/scripts/install_wizard.sh
source "$SCRIPT_DIR/scripts/install_wizard.sh"

SKIP_SERVICES=0
DRY_RUN=0
PROFILE_ARG=""
SKIP_EDITOR_EXTENSIONS=0
WIZARD_RAN=0
WIZARD_SERVICES_MODE="all"
WIZARD_SERVICE_LIST=""

# Preflight, Homebrew, Runtimes & config, DevForgeKit CLI, Global command,
# Services, Report, Verification - see log_step_section in common.sh.
STEP_TOTAL=8
STEP_CURRENT=0
next_step() { STEP_CURRENT=$((STEP_CURRENT + 1)); log_step_section "$STEP_TOTAL" "$STEP_CURRENT" "$1"; }

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

# Resume support: if a previous run left packages recorded as "failed" in
# ~/.config/devforgekit/install-state.json, offer to retry just those
# instead of a full reinstall - same tty/assume-yes gate as the wizard
# below, so CI/--yes/non-interactive runs are unaffected and always do a
# full run. Scoped to Homebrew packages only (what install-state tracks);
# the wizard's own extension/service choices aren't persisted, so a
# resumed run uses their normal defaults rather than re-prompting.
RESUME_MODE=0
if [[ "$DRY_RUN" -eq 0 && -t 0 && "${DEV_SETUP_ASSUME_YES:-0}" != "1" ]] && install_state_has_entries; then
    if confirm "Previous installation detected - resume where it left off?"; then
        RESUME_MODE=1
    else
        install_state_reset
    fi
fi

# On a first-ever, fully interactive install with no explicit profile
# choice, offer the wizard instead of silently defaulting to "full" (see
# docs/InstallationAudit.md). Non-interactive/CI/--yes/--dry-run runs, and
# any run with an explicit --profile/--minimal/--full flag, are completely
# unaffected - wizard_should_run mirrors confirm()'s own tty/assume-yes gate.
if [[ "$RESUME_MODE" -eq 1 ]]; then
    RESUME_BREWFILE="$(mktemp -t devforgekit-resume-brewfile.XXXXXX)"
    install_state_failed_lines > "$RESUME_BREWFILE"
    PROFILE="resume"
    BREWFILE_PATH="$RESUME_BREWFILE"
elif [[ "$DRY_RUN" -eq 0 ]] && wizard_should_run; then
    wizard_run
    WIZARD_RAN=1
    PROFILE="$WIZARD_PROFILE_LABEL"
    BREWFILE_PATH="$WIZARD_BREWFILE_PATH"
else
    PROFILE="$(resolve_profile "$PROFILE_ARG")"
    BREWFILE_PATH="$(profile_brewfile_path "$PROFILE")"
fi
if [[ ! -f "$BREWFILE_PATH" ]]; then
    log_error "Unknown profile '$PROFILE' (no such file: $BREWFILE_PATH). Run './scripts/profile.sh list' to see available profiles."
    exit 1
fi

# Reconcile the wizard's own services choice with --skip-services/--dry-run,
# which still win if passed explicitly (WIZARD_RAN is only ever 1 when
# neither was given, so there's no real conflict, but this keeps the
# precedence explicit).
if [[ "$WIZARD_RAN" -eq 1 && "$SKIP_SERVICES" -eq 0 && "$WIZARD_SERVICES_MODE" == "none" ]]; then
    SKIP_SERVICES=1
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

next_step "Preflight checks"
log_info "Preparing your machine..."

if ! os_is_macos; then
    log_error "This bootstrap only supports macOS (it hardcodes Homebrew for provisioning)."
    log_info "On Linux, install Node.js (>=18) and npm yourself, then run 'devforgekit <command>' directly - the Node CLI itself (doctor, check, new, component, etc.) is not macOS-only. See docs/PlatformSupport.md."
    # This is an expected, by-design early exit, not a crash - skip the
    # generic "aborted unexpectedly" EXIT trap below so a first-time Linux
    # user isn't left thinking something went wrong.
    trap - EXIT
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

next_step "Homebrew"

log_info "Installing packages..."
log_info "Profile: $PROFILE ($BREWFILE_PATH)"

if [[ "$DRY_RUN" -eq 1 ]]; then
    run_step "Homebrew present" command_exists brew
    run_step_optional "Brewfile is valid (brew bundle check)" brew bundle check --file="$BREWFILE_PATH" --no-upgrade
else
    run_step "Homebrew installed" ensure_homebrew
    # A resumed run keeps the state from last time (it's exactly what
    # we're retrying); any other run starts this install's own fresh
    # record so stale entries from a long-past install never linger.
    [[ "$RESUME_MODE" -eq 1 ]] || install_state_reset
    # install_brewfile tries one batched `brew bundle install` first (the
    # common case, unchanged from before) and only falls back to a slower
    # one-entry-at-a-time retry loop if that fails, since `brew bundle`
    # aborts entirely at the first broken entry rather than continuing
    # past it - see install_brewfile in scripts/common.sh.
    _brew_start_time="$(timer_start)"
    install_brewfile "$BREWFILE_PATH"
    log_info "Homebrew step took $(timer_elapsed "$_brew_start_time")"

    # A dedicated Succeeded/Failed breakdown for just this Homebrew step -
    # distinct from print_summary's final PASS/WARNING/FAIL tally over
    # every step in the whole run - plus a pointer to the one command
    # that retries exactly what's still broken.
    if [[ ${#INSTALL_FAILED[@]} -gt 0 ]]; then
        echo
        log_section "Installation Complete"
        if [[ ${#INSTALL_SUCCEEDED[@]} -gt 0 || ${#INSTALL_ALREADY[@]} -gt 0 ]]; then
            echo "Succeeded:"
            for _pkg in "${INSTALL_ALREADY[@]-}" "${INSTALL_SUCCEEDED[@]-}"; do
                [[ -n "$_pkg" ]] && printf '  %s%s%s %s\n' "$COLOR_SUCCESS" "$SYMBOL_PASS" "$COLOR_RESET" "$_pkg"
            done
        fi
        echo "Failed:"
        for _pkg in "${INSTALL_FAILED[@]}"; do
            printf '  %s%s%s %s\n' "$COLOR_ERROR" "$SYMBOL_FAIL" "$COLOR_RESET" "$_pkg"
        done
        echo
        log_info "Run 'devforgekit repair install' to retry the failed component(s) above."
    fi
fi

# --------------------------------------------------------------------------
# Runtimes and configuration
# --------------------------------------------------------------------------

next_step "Runtimes and configuration"

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
# DevForgeKit Core CLI (Layer 2 - see docs/PlatformArchitecture.md)
# --------------------------------------------------------------------------

next_step "DevForgeKit CLI"

if [[ "$DRY_RUN" -eq 1 ]]; then
    run_step "cli/package.json present" test -f "$DEV_SETUP_ROOT/cli/package.json"
else
    # Optional: a missing/failed Node CLI setup must never fail the whole
    # bootstrap - the `devforgekit` dispatcher falls back to bash scripts
    # until this has run successfully once.
    run_step_optional "DevForgeKit CLI dependencies" ensure_cli_dependencies
fi

# --------------------------------------------------------------------------
# Global command
# --------------------------------------------------------------------------

next_step "Global command"

if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "Skipping global command symlink in --dry-run mode"
else
    run_step_optional "Install devforgekit as a global command" install_global_command
fi

# --------------------------------------------------------------------------
# Services
# --------------------------------------------------------------------------

next_step "Services"
if [[ "$SKIP_SERVICES" -eq 0 ]]; then
    if [[ "$WIZARD_RAN" -eq 1 && "$WIZARD_SERVICES_MODE" == "choose" ]]; then
        # shellcheck disable=SC2086 # WIZARD_SERVICE_LIST is a deliberately word-split, space-separated service name list
        run_step "Start selected services" service_start_selected $WIZARD_SERVICE_LIST
    else
        run_step "Start PostgreSQL, MySQL, Redis" service_start_all
    fi
    sleep 2
    run_step_optional "Verify services are healthy" service_verify_all
else
    log_info "Skipping service startup (--skip-services, --dry-run, or wizard choice)"
fi

# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------

next_step "Report"
log_info "Running health checks..."
run_step_optional "Generate system report" "$DEV_SETUP_ROOT/scripts/report.sh"

# --------------------------------------------------------------------------
# Verification
# --------------------------------------------------------------------------

next_step "Verification"
if [[ "$DRY_RUN" -eq 0 ]]; then
    log_info "Running post-install verification..."
    verify_devforgekit_cli || true

    # Closes the loop for the Environment Configuration Engine
    # (core/environment/) for packages installed via this bash bootstrap/
    # Brewfile path rather than `devforgekit component install` (which
    # already registers environment metadata live via the
    # install.afterInstall plugin event - see core/environment/index.js).
    # Deliberately placed after verify_devforgekit_cli, not inside the
    # Homebrew step above: the Node CLI's own dependencies may not be
    # installed yet at that point in a fresh bootstrap, and this only
    # needs to run once, after the CLI is confirmed working.
    if command_exists devforgekit; then
        run_step_optional "Regenerate environment configuration" devforgekit env regenerate
    fi
else
    log_info "Skipping post-install verification in --dry-run mode"
fi

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
VERIFIED_TOOLS=()
_check_result() {
    local label="$1" present="$2"
    if [[ "$present" -eq 0 ]]; then
        printf '%s%s%s %s\n' "$COLOR_SUCCESS" "$SYMBOL_PASS" "$COLOR_RESET" "$label"
        VERIFIED_TOOLS+=("$label")
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

if [[ "$DRY_RUN" -eq 0 ]]; then
    echo
    log_info "Want a role-specific setup (Flutter, AI Engineer, Backend, DevOps, ...)? Run 'devforgekit profile list'."
fi

# On a real success, a real terminal, and never in --dry-run (nothing
# was actually installed), show the first-run welcome screen instead of
# silently dropping into the dashboard or back to the shell - it picks
# the next step itself (dashboard/doctor/new project/exit) and never
# returns here. `devforgekit` with no args already decides for itself
# whether the terminal can host the TUI (isTuiCapable in
# cli/src/tui/index.js); "Launch dashboard" reuses that logic rather
# than duplicating it.
if [[ "$SUMMARY_OK" -eq 0 && "$DRY_RUN" -eq 0 && -t 0 && -t 1 ]]; then
    print_welcome_screen "${VERIFIED_TOOLS[@]-}"
fi

exit 0
