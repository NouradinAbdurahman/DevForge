#!/usr/bin/env bash
# Shared helpers used by every script in this repository: logging, timers,
# OS/arch detection, safe file copying, and a fault-tolerant step runner.
#
# Usage: source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

# Resolve the repository root regardless of where this file is sourced from.
DEV_SETUP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DEV_SETUP_ROOT

# shellcheck source=SCRIPTDIR/colors.sh
source "$DEV_SETUP_ROOT/scripts/colors.sh"

REPORTS_DIR="$DEV_SETUP_ROOT/reports"
export REPORTS_DIR

# Results collected by run_step, printed by print_summary.
# Deliberately not `declare -a`/`-g`: this must run under the stock macOS
# /bin/bash (3.2) on a brand-new machine, before any newer bash is installed.
STEP_RESULTS=()

# --------------------------------------------------------------------------
# Logging
# --------------------------------------------------------------------------

log_info()    { printf '%s%s%s %s\n' "$COLOR_INFO" "$SYMBOL_INFO" "$COLOR_RESET" "$*"; }
log_success() { printf '%s%s%s %s\n' "$COLOR_SUCCESS" "$SYMBOL_PASS" "$COLOR_RESET" "$*"; }
log_warn()    { printf '%s%s%s %s\n' "$COLOR_WARNING" "$SYMBOL_WARN" "$COLOR_RESET" "$*" >&2; }
log_error()   { printf '%s%s%s %s\n' "$COLOR_ERROR" "$SYMBOL_FAIL" "$COLOR_RESET" "$*" >&2; }
log_step()    { printf '%s%s%s %s\n' "$COLOR_DIM" "$SYMBOL_ARROW" "$COLOR_RESET" "$*"; }

log_section() {
    printf '\n%s%s=== %s ===%s\n' "$COLOR_SECTION" "$COLOR_BOLD" "$*" "$COLOR_RESET"
}

# --------------------------------------------------------------------------
# Timing
# --------------------------------------------------------------------------

timer_start() { date +%s; }

# timer_elapsed <start_epoch> -> "Xm Ys"
timer_elapsed() {
    local start="$1" end elapsed
    end=$(date +%s)
    elapsed=$((end - start))
    printf '%dm %ds' "$((elapsed / 60))" "$((elapsed % 60))"
}

# --------------------------------------------------------------------------
# Environment detection
# --------------------------------------------------------------------------

command_exists() { command -v "$1" >/dev/null 2>&1; }

os_is_macos() { [[ "$(uname -s)" == "Darwin" ]]; }

# Prints "arm64" or "x86_64".
os_arch() { uname -m; }

# Prints the Homebrew prefix for the current architecture, whether or not
# Homebrew is actually installed yet.
os_brew_prefix() {
    if [[ "$(os_arch)" == "arm64" ]]; then
        echo "/opt/homebrew"
    else
        echo "/usr/local"
    fi
}

os_macos_version() { sw_vers -productVersion 2>/dev/null || echo "unknown"; }

# Loads the Homebrew shell environment for whichever prefix is present.
brew_load_shellenv() {
    local prefix
    prefix="$(os_brew_prefix)"
    if [[ -x "$prefix/bin/brew" ]]; then
        eval "$("$prefix/bin/brew" shellenv)"
        return 0
    fi
    return 1
}

net_has_internet() {
    curl -fsS --max-time 5 https://github.com -o /dev/null 2>/dev/null
}

# --------------------------------------------------------------------------
# Confirmation
# --------------------------------------------------------------------------

# confirm "Prompt text" -> 0 (yes) or 1 (no)
# Honors DEV_SETUP_ASSUME_YES=1 and non-interactive shells (defaults to yes,
# since bootstrap/backup/update are meant to run unattended in CI/cron).
confirm() {
    local prompt="$1" reply
    if [[ "${DEV_SETUP_ASSUME_YES:-0}" == "1" || ! -t 0 ]]; then
        return 0
    fi
    read -r -p "$prompt [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]]
}

# --------------------------------------------------------------------------
# Filesystem helpers
# --------------------------------------------------------------------------

fs_ensure_dir() { mkdir -p "$1"; }

_fs_checksum() {
    if command_exists shasum; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        cksum "$1" | awk '{print $1}'
    fi
}

# fs_safe_copy <src> <dest>
# Copies src to dest only when the content differs. If dest already exists
# with different content, it is preserved as dest.backup-<timestamp> first,
# so re-running bootstrap/restore never silently destroys local edits.
fs_safe_copy() {
    local src="$1" dest="$2"

    if [[ ! -f "$src" ]]; then
        log_warn "Source not found, skipping: $src"
        return 1
    fi

    if [[ -f "$dest" ]]; then
        if [[ "$(_fs_checksum "$src")" == "$(_fs_checksum "$dest")" ]]; then
            log_step "Up to date: $dest"
            return 0
        fi
        local backup
        backup="${dest}.backup-$(date +%Y%m%d%H%M%S)"
        cp "$dest" "$backup"
        log_warn "Existing file differed, backed up to $backup"
    fi

    fs_ensure_dir "$(dirname "$dest")"
    cp "$src" "$dest"
    log_success "Installed $dest"
}

# --------------------------------------------------------------------------
# Config file mapping (single source of truth for backup.sh and restore.sh)
# --------------------------------------------------------------------------

# Prints "repo-relative-path|absolute-home-path" pairs, one per line, for
# every plain config file that is mirrored between this repo and $HOME.
# Editor extensions lists are handled separately since they're generated
# from `--list-extensions` rather than copied byte-for-byte.
config_file_pairs() {
    cat <<EOF
.zshrc|$HOME/.zshrc
.gitconfig|$HOME/.gitconfig
.gitignore_global|$HOME/.gitignore_global
mise.toml|$HOME/.config/mise/config.toml
vscode/settings.json|$HOME/Library/Application Support/Code/User/settings.json
vscode/keybindings.json|$HOME/Library/Application Support/Code/User/keybindings.json
cursor/settings.json|$HOME/Library/Application Support/Cursor/User/settings.json
cursor/keybindings.json|$HOME/Library/Application Support/Cursor/User/keybindings.json
EOF
}

# --------------------------------------------------------------------------
# Fault-tolerant step runner
# --------------------------------------------------------------------------

# run_step "description" cmd [args...]
# Runs a command without letting failure abort the calling script (even
# under `set -e`), records the outcome, and prints a colored status line.
run_step() {
    local description="$1"
    shift

    set +e
    "$@"
    local status=$?
    set -e

    if [[ $status -eq 0 ]]; then
        STEP_RESULTS+=("PASS|$description")
        log_success "$description"
    else
        STEP_RESULTS+=("FAIL|$description (exit $status)")
        log_error "$description failed (exit $status)"
    fi

    return 0
}

# run_step_optional behaves like run_step but records WARNING instead of
# FAIL, for steps that are nice-to-have rather than required (e.g. an
# optional CLI that isn't installed on this machine).
run_step_optional() {
    local description="$1"
    shift

    set +e
    "$@"
    local status=$?
    set -e

    if [[ $status -eq 0 ]]; then
        STEP_RESULTS+=("PASS|$description")
        log_success "$description"
    else
        STEP_RESULTS+=("WARNING|$description (exit $status)")
        log_warn "$description skipped or failed (exit $status)"
    fi

    return 0
}

# --------------------------------------------------------------------------
# Homebrew
# --------------------------------------------------------------------------

# Installs Homebrew if it isn't already present, then loads its shellenv.
# Safe to call repeatedly - a no-op once Homebrew exists.
ensure_homebrew() {
    if ! brew_load_shellenv; then
        log_step "Homebrew not found, installing..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        brew_load_shellenv
    fi
    command_exists brew
}

# --------------------------------------------------------------------------
# Restore helpers (shared by bootstrap.sh and scripts/restore.sh)
# --------------------------------------------------------------------------

restore_zsh() {
    fs_safe_copy "$DEV_SETUP_ROOT/.zshrc" "$HOME/.zshrc"
}

restore_git() {
    fs_safe_copy "$DEV_SETUP_ROOT/.gitconfig" "$HOME/.gitconfig"
    fs_safe_copy "$DEV_SETUP_ROOT/.gitignore_global" "$HOME/.gitignore_global"
}

restore_mise() {
    fs_ensure_dir "$HOME/.config/mise"
    fs_safe_copy "$DEV_SETUP_ROOT/mise.toml" "$HOME/.config/mise/config.toml"
    if command_exists mise; then
        (cd "$DEV_SETUP_ROOT" && mise install)
    else
        log_warn "mise is not installed; skipping runtime install"
        return 1
    fi
}

# editor_app_support_dir <vscode|cursor> -> absolute path to the User dir
editor_app_support_dir() {
    case "$1" in
        vscode) echo "$HOME/Library/Application Support/Code/User" ;;
        cursor) echo "$HOME/Library/Application Support/Cursor/User" ;;
        *) return 1 ;;
    esac
}

# editor_cli <vscode|cursor> -> the CLI binary name used to manage extensions
editor_cli() {
    case "$1" in
        vscode) echo "code" ;;
        cursor) echo "cursor" ;;
        *) return 1 ;;
    esac
}

# restore_editor <vscode|cursor>
# Copies settings/keybindings into the app's User directory and installs
# every extension listed in <editor>/extensions.txt.
restore_editor() {
    local editor="$1" support_dir cli extensions_file
    support_dir="$(editor_app_support_dir "$editor")" || return 1
    cli="$(editor_cli "$editor")"
    extensions_file="$DEV_SETUP_ROOT/$editor/extensions.txt"

    fs_ensure_dir "$support_dir"
    fs_safe_copy "$DEV_SETUP_ROOT/$editor/settings.json" "$support_dir/settings.json"
    fs_safe_copy "$DEV_SETUP_ROOT/$editor/keybindings.json" "$support_dir/keybindings.json"

    if command_exists "$cli" && [[ -f "$extensions_file" ]]; then
        log_step "Installing $editor extensions..."
        while IFS= read -r extension; do
            [[ -z "$extension" ]] && continue
            "$cli" --install-extension "$extension" --force >/dev/null 2>&1 || \
                log_warn "$editor: failed to install extension $extension"
        done < "$extensions_file"
    else
        log_warn "$cli CLI not found on PATH; skipping $editor extension install"
    fi
}

# backup_editor <vscode|cursor>
# Reverse of restore_editor: pulls the live settings/keybindings and the
# current extension list back into the repo.
backup_editor() {
    local editor="$1" support_dir cli extensions_file
    support_dir="$(editor_app_support_dir "$editor")" || return 1
    cli="$(editor_cli "$editor")"
    extensions_file="$DEV_SETUP_ROOT/$editor/extensions.txt"

    [[ -f "$support_dir/settings.json" ]] && fs_safe_copy "$support_dir/settings.json" "$DEV_SETUP_ROOT/$editor/settings.json"
    [[ -f "$support_dir/keybindings.json" ]] && fs_safe_copy "$support_dir/keybindings.json" "$DEV_SETUP_ROOT/$editor/keybindings.json"

    if command_exists "$cli"; then
        "$cli" --list-extensions 2>/dev/null | sort > "$extensions_file"
        log_success "Captured $editor extension list"
    else
        log_warn "$cli CLI not found on PATH; leaving $extensions_file untouched"
    fi
}

# --------------------------------------------------------------------------
# Services
# --------------------------------------------------------------------------

SERVICE_LIST=("postgresql@17" "mysql" "redis")

service_start_all() {
    local svc
    for svc in "${SERVICE_LIST[@]}"; do
        brew services start "$svc" >/dev/null 2>&1 || log_warn "Could not start $svc"
    done
}

service_stop_all() {
    local svc
    for svc in "${SERVICE_LIST[@]}"; do
        brew services stop "$svc" >/dev/null 2>&1 || log_warn "Could not stop $svc"
    done
}

service_restart_all() {
    local svc
    for svc in "${SERVICE_LIST[@]}"; do
        brew services restart "$svc" >/dev/null 2>&1 || log_warn "Could not restart $svc"
    done
}

service_status_all() {
    if command_exists brew; then
        brew services list | grep -E "^(postgresql@17|mysql|redis)\b" || echo "No matching services registered"
    else
        log_warn "Homebrew not found; cannot query service status"
        return 1
    fi
}

# service_verify_all - checks that each service actually accepts connections,
# not just that launchd reports it as "started".
service_verify_all() {
    local ok=0

    if command_exists pg_isready; then
        if pg_isready -q; then
            record_result PASS "PostgreSQL is accepting connections"
        else
            record_result WARNING "PostgreSQL is not responding"
            ok=1
        fi
    fi

    if command_exists mysqladmin; then
        if mysqladmin ping --silent; then
            record_result PASS "MySQL is accepting connections"
        else
            record_result WARNING "MySQL is not responding"
            ok=1
        fi
    fi

    if command_exists redis-cli; then
        if [[ "$(redis-cli ping 2>/dev/null)" == "PONG" ]]; then
            record_result PASS "Redis is accepting connections"
        else
            record_result WARNING "Redis is not responding"
            ok=1
        fi
    fi

    return $ok
}

# record_result <PASS|WARNING|FAIL> "description"
# Used by check.sh/doctor.sh to log a precomputed diagnostic outcome using
# the same STEP_RESULTS ledger and print_summary tally as run_step.
record_result() {
    local status="$1" description="$2"
    STEP_RESULTS+=("$status|$description")
    case "$status" in
        PASS)    log_success "$description" ;;
        WARNING) log_warn "$description" ;;
        FAIL)    log_error "$description" ;;
    esac
}

print_summary() {
    local pass=0 warn=0 fail=0 entry status description

    log_section "Summary"

    for entry in "${STEP_RESULTS[@]}"; do
        status="${entry%%|*}"
        description="${entry#*|}"
        case "$status" in
            PASS)
                printf '  %s%s%s %s\n' "$COLOR_SUCCESS" "$SYMBOL_PASS" "$COLOR_RESET" "$description"
                ((pass++))
                ;;
            WARNING)
                printf '  %s%s%s %s\n' "$COLOR_WARNING" "$SYMBOL_WARN" "$COLOR_RESET" "$description"
                ((warn++))
                ;;
            FAIL)
                printf '  %s%s%s %s\n' "$COLOR_ERROR" "$SYMBOL_FAIL" "$COLOR_RESET" "$description"
                ((fail++))
                ;;
        esac
    done

    printf '\n%d passed, %d warnings, %d failed\n' "$pass" "$warn" "$fail"

    [[ $fail -eq 0 ]]
}
