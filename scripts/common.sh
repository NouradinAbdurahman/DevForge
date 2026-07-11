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

# log_step_section <total> <current> <title> - like log_section, but
# prefixed with a "Step N/total" line so a long-running install reads as
# a known-length sequence instead of an unbroken wall of output. Callers
# track their own current-step counter (bootstrap.sh increments a plain
# STEP_CURRENT variable) rather than this function owning global state,
# since bash 3.2 has no static/local-persisting-across-calls counters.
log_step_section() {
    local total="$1" current="$2" title="$3"
    printf '\n%s%sStep %d/%d%s\n' "$COLOR_DIM" "$COLOR_BOLD" "$current" "$total" "$COLOR_RESET"
    log_section "$title"
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

# version_of <binary> [args...] -> first line of `binary args...` output,
# or "not installed" if the binary is missing. Used by report.sh/inventory.sh
# to render tool-version tables without each duplicating the same guard.
version_of() {
    local bin="$1"
    if command_exists "$bin"; then
        "$@" 2>&1 | head -n1
    else
        echo "not installed"
    fi
}

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
# Safe test mode for destructive operations
# --------------------------------------------------------------------------
#
# Real incident this exists to prevent: testing scripts/uninstall.sh by
# piping "n" into it (assuming that would decline) instead actually
# uninstalled a real package on a real machine - `confirm()`'s non-tty
# auto-yes (intentional, above, for unattended install/backup/update in
# CI) is the wrong default for anything destructive. Two separate fixes:
#
# 1. Destructive commands (uninstall.sh) must gate on a real tty or an
#    explicit --force flag *before* ever reaching confirm() - see
#    scripts/uninstall.sh's own option parsing, not this file.
# 2. Every actual destructive operation - `brew uninstall`, `brew
#    services stop/start`, an editor's --uninstall-extension, deleting a
#    file - should be routed through dfk_run_destructive/dfk_remove_file
#    below, so tests can set DEVFORGEKIT_TEST_MODE=1 and exercise the
#    real surrounding logic (flag parsing, category selection, preview
#    generation, install-state bookkeeping) with zero risk of touching
#    the machine actually running the test, regardless of whether the
#    tty/--force gate has a bug. Defense in depth, not a substitute for (1).
DEVFORGEKIT_TEST_MODE="${DEVFORGEKIT_TEST_MODE:-0}"
DEVFORGEKIT_TEST_LOG="${DEVFORGEKIT_TEST_LOG:-}"

# dfk_run_destructive <description> -- <cmd...> - the one chokepoint
# every destructive external command (brew install/uninstall, brew
# services start/stop, `code`/`cursor` --install-extension/
# --uninstall-extension, ...) should run through instead of calling the
# real command directly. In test mode: logs "<description>: <cmd...>" to
# DEVFORGEKIT_TEST_LOG (if set) and returns success without running
# anything. Otherwise: runs the real command and returns its real exit
# status.
dfk_run_destructive() {
    local description="$1"
    shift
    [[ "${1:-}" == "--" ]] && shift

    if [[ "$DEVFORGEKIT_TEST_MODE" == "1" ]]; then
        log_step "[test-mode] $description: $*"
        if [[ -n "$DEVFORGEKIT_TEST_LOG" ]]; then
            printf '%s: %s\n' "$description" "$*" >> "$DEVFORGEKIT_TEST_LOG"
        fi
        return 0
    fi

    "$@"
}

# dfk_remove_file <path> - the file-deletion equivalent of
# dfk_run_destructive (a bare `rm` has no "command + args" shape worth
# logging the same way, and callers care about "did this path get
# removed", not a generic command's exit status).
dfk_remove_file() {
    local target="$1"
    if [[ "$DEVFORGEKIT_TEST_MODE" == "1" ]]; then
        log_step "[test-mode] would remove: $target"
        if [[ -n "$DEVFORGEKIT_TEST_LOG" ]]; then
            printf 'remove: %s\n' "$target" >> "$DEVFORGEKIT_TEST_LOG"
        fi
        return 0
    fi
    rm -f "$target"
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
    # Write to a same-directory temp file and mv it into place rather than
    # `cp "$src" "$dest"` directly - if $dest were swapped for a symlink
    # between the `[[ -f "$dest" ]]` check above and this write (a TOCTOU
    # race), a plain cp follows the symlink and overwrites whatever it
    # points at; mv replaces the dest directory entry itself instead
    # (same mktemp+mv idiom this file already uses for INSTALL_STATE_FILE).
    local tmp
    tmp="$(mktemp "${dest}.XXXXXX")"
    # -p: mktemp creates $tmp at mode 0600 regardless of $src's own mode;
    # without -p that 0600 would survive the mv below, silently tightening
    # every file this function has ever copied (.zshrc, .gitconfig, editor
    # settings) instead of just fixing the symlink race.
    cp -p "$src" "$tmp"
    mv "$tmp" "$dest"
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
# macOS preference domain mapping (single source of truth for
# scripts/preferences.sh). Many of the UI categories users think of
# (Mission Control, Hot Corners, Stage Manager) are actually stored in the
# com.apple.dock domain; Menu Bar and Control Center both live in
# com.apple.controlcenter; Keyboard/Mouse/Dark Mode live in NSGlobalDomain.
# Format: "defaults-domain|backup-filename|optional(0/1)"
# optional=1 domains (Trackpad, Safari) commonly fail on machines without
# that hardware, or without Full Disk Access - failures there are warnings,
# not errors.
# --------------------------------------------------------------------------

preference_domain_pairs() {
    cat <<EOF
NSGlobalDomain|global.plist|0
com.apple.dock|dock.plist|0
com.apple.finder|finder.plist|0
com.apple.screencapture|screenshots.plist|0
com.apple.Terminal|terminal.plist|0
com.apple.controlcenter|controlcenter.plist|0
com.apple.AppleMultitouchTrackpad|trackpad.plist|1
com.apple.Safari|safari.plist|1
EOF
}

# --------------------------------------------------------------------------
# Install profiles (subsets of Brewfile - see profiles/)
# --------------------------------------------------------------------------

# Local, gitignored file recording the profile last selected via
# `./devforgekit profile use <name>` / `scripts/profile.sh use <name>`. When present,
# bootstrap.sh/scripts/install.sh use it as the default profile instead of
# "full", unless overridden with an explicit --profile/--minimal/--full flag.
PROFILE_STATE_FILE="$DEV_SETUP_ROOT/.devprofile"

# profile_brewfile_path <profile-name> -> absolute path to that profile's
# Brewfile. "full" (or an empty name) resolves to the root Brewfile; any
# other name resolves to profiles/<name>/Brewfile. Does not check the file
# actually exists - callers should validate that themselves so they can
# give a clear "unknown profile" error.
profile_brewfile_path() {
    local name="${1:-full}"
    if [[ -z "$name" || "$name" == "full" ]]; then
        echo "$DEV_SETUP_ROOT/Brewfile"
    else
        echo "$DEV_SETUP_ROOT/profiles/$name/Brewfile"
    fi
}

# resolve_profile [explicit-profile] -> the profile to use: the explicit
# argument if given, else the last profile set via PROFILE_STATE_FILE, else
# "full".
resolve_profile() {
    local explicit="${1:-}"
    if [[ -n "$explicit" ]]; then
        echo "$explicit"
    elif [[ -f "$PROFILE_STATE_FILE" ]]; then
        tr -d '[:space:]' < "$PROFILE_STATE_FILE"
    else
        echo "full"
    fi
}

# --------------------------------------------------------------------------
# PATH manager
# --------------------------------------------------------------------------

# Prints "label|directory" pairs for well-known dev-tool directories that
# commonly need to be on PATH. A directory is only relevant if it actually
# exists on disk (meaning the tool is installed); path_manager_check/_fix
# silently skip labels whose directory doesn't exist rather than treating
# "not installed" as a problem.
path_manager_known_dirs() {
    local brew_prefix
    brew_prefix="$(os_brew_prefix)"
    cat <<EOF
Android SDK platform-tools|$HOME/Library/Android/sdk/platform-tools
Android SDK cmdline-tools|$HOME/Library/Android/sdk/cmdline-tools/latest/bin
Android SDK emulator|$HOME/Library/Android/sdk/emulator
pnpm|$HOME/Library/pnpm
mise shims|$HOME/.local/share/mise/shims
Homebrew bin|$brew_prefix/bin
GNU coreutils|$brew_prefix/opt/coreutils/libexec/gnubin
GNU findutils|$brew_prefix/opt/findutils/libexec/gnubin
GNU sed|$brew_prefix/opt/gnu-sed/libexec/gnubin
GNU tar|$brew_prefix/opt/gnu-tar/libexec/gnubin
GNU time|$brew_prefix/opt/gnu-time/libexec/gnubin
GNU awk (gawk)|$brew_prefix/opt/gawk/libexec/gnubin
GNU grep|$brew_prefix/opt/grep/libexec/gnubin
EOF
}

# path_manager_check - PASS when a known, installed tool directory is on
# PATH; WARNING when it's installed but missing from PATH. Returns non-zero
# if anything is missing (so callers can decide whether to offer a fix).
path_manager_check() {
    local label dir missing=0
    while IFS='|' read -r label dir; do
        [[ -z "$label" ]] && continue
        [[ -d "$dir" ]] || continue
        case ":$PATH:" in
            *":$dir:"*) record_result PASS "$label is on PATH" ;;
            *)
                record_result WARNING "$label installed at $dir but not on PATH"
                missing=1
                ;;
        esac
    done < <(path_manager_known_dirs)
    return $missing
}

# path_manager_fix - appends any missing-but-installed directories to a
# clearly marked, idempotent block in the live ~/.zshrc (removing any
# previous block first, so re-running never accumulates duplicates).
path_manager_fix() {
    local label dir zshrc="$HOME/.zshrc" missing=() d

    while IFS='|' read -r label dir; do
        [[ -z "$label" ]] && continue
        [[ -d "$dir" ]] || continue
        case ":$PATH:" in
            *":$dir:"*) ;;
            *) missing+=("$dir") ;;
        esac
    done < <(path_manager_known_dirs)

    if [[ ${#missing[@]} -eq 0 ]]; then
        log_success "Nothing to fix - all installed tools are already on PATH"
        return 0
    fi

    if [[ -f "$zshrc" ]]; then
        sed -i.path-manager-backup '/# >>> DevForgeKit path-manager >>>/,/# <<< DevForgeKit path-manager <<</d' "$zshrc"
    fi

    {
        echo "# >>> DevForgeKit path-manager >>>"
        echo "# Managed by 'scripts/doctor.sh --fix' - safe to delete, will be"
        echo "# regenerated. Do not hand-edit; changes are lost on the next fix."
        for d in "${missing[@]}"; do
            # shellcheck disable=SC2016 # $PATH must stay literal - it's written into ~/.zshrc to expand at shell startup, not now
            printf 'export PATH="%s:$PATH"\n' "$d"
        done
        echo "# <<< DevForgeKit path-manager <<<"
    } >> "$zshrc"

    log_success "Added ${#missing[@]} missing PATH entries to ~/.zshrc - restart your shell (or run 'exec zsh') to apply"
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

# _brewfile_tap_lines <brewfile> - every `tap "..."` line in a Brewfile,
# needed on any single-entry Brewfile built from it (e.g. terraform's
# hashicorp/tap entry won't resolve without its tap line present).
_brewfile_tap_lines() {
    grep -E '^[[:space:]]*tap[[:space:]]+"' "$1" 2>/dev/null || true
}

# --------------------------------------------------------------------------
# Already-installed detection
# --------------------------------------------------------------------------

# _already_installed_ids <formula|cask> -> space-separated ids Homebrew
# already reports as installed. One batched `brew list` call (not one
# per package) so install_brewfile_per_line can report "Already
# installed" instead of quietly re-running a no-op `brew bundle install`
# for something that's already satisfied.
_already_installed_ids() {
    case "$1" in
        formula) brew list --formula 2>/dev/null | tr '\n' ' ' ;;
        cask) brew list --cask 2>/dev/null | tr '\n' ' ' ;;
    esac
}

# --------------------------------------------------------------------------
# Install state (resume support)
# --------------------------------------------------------------------------

# ~/.config/devforgekit/install-state.json tracks the outcome of the most
# recent Homebrew install run (one entry per brew/cask id: "installed" or
# "failed") so a later `./bootstrap.sh` can offer to resume instead of
# reinstalling everything - see install_state_* below and the resume
# prompt in bootstrap.sh. Genuinely valid JSON (not just JSON-shaped), so
# it's inspectable outside this repo, but read back with plain grep/sed
# rather than requiring jq - the whole point of this file is to survive
# an install that was interrupted before jq itself got installed.
INSTALL_STATE_FILE="$HOME/.config/devforgekit/install-state.json"

# install_state_reset - starts a fresh state file for a new install run.
install_state_reset() {
    fs_ensure_dir "$(dirname "$INSTALL_STATE_FILE")"
    printf '{}\n' > "$INSTALL_STATE_FILE"
}

# install_state_set <id> <installed|failed> <brew|cask> - records one
# package's outcome and its Brewfile type (needed to reconstruct a
# `brew "id"` vs `cask "id"` line on resume). Rewrites the whole (small)
# file each time rather than appending - simplest way to keep it valid
# JSON with no duplicate keys when a package is retried after a prior
# failure.
install_state_set() {
    local id="$1" status="$2" type="$3"
    [[ -f "$INSTALL_STATE_FILE" ]] || install_state_reset

    local tmp
    tmp="$(mktemp -t devforgekit-install-state.XXXXXX)"
    {
        echo "{"
        # `|| true`: an empty/fresh state file means this grep|grep pipe
        # legitimately matches nothing, which is not an error - without
        # this, pipefail would report the pipe's non-zero exit status,
        # and under errexit that would abort the entire calling script
        # the very first time a package's outcome is ever recorded
        # (confirmed live - this exact shape crashed install_brewfile_per_line
        # after its first entry, same bug class as _wizard_size_lookup).
        grep -oE '"[a-zA-Z0-9@/_.-]+": *"(installed|failed):(brew|cask)"' "$INSTALL_STATE_FILE" 2>/dev/null \
            | grep -vF "\"$id\":" | sed 's/^/  /; s/$/,/' || true
        printf '  "%s": "%s:%s"\n' "$id" "$status" "$type"
        echo "}"
    } > "$tmp"
    mv "$tmp" "$INSTALL_STATE_FILE"
}

# install_state_failed_lines -> "brew \"id\"" / "cask \"id\"" lines (one
# per line, ready to drop straight into a Brewfile) for every package
# the last run recorded as failed - what a resumed install actually
# needs to retry, without re-attempting anything already installed.
install_state_failed_lines() {
    [[ -f "$INSTALL_STATE_FILE" ]] || return 0
    grep -oE '"[a-zA-Z0-9@/_.-]+": *"failed:(brew|cask)"' "$INSTALL_STATE_FILE" 2>/dev/null \
        | sed -E 's/^"([^"]+)": *"failed:(brew|cask)"/\2 "\1"/' || true
}

# install_state_installed_lines -> "brew \"id\"" / "cask \"id\"" lines for
# every package the state file records as installed - what
# `devforgekit uninstall --packages` actually removes, since it's a more
# accurate record of what THIS machine has than assuming any particular
# Brewfile/profile.
install_state_installed_lines() {
    [[ -f "$INSTALL_STATE_FILE" ]] || return 0
    grep -oE '"[a-zA-Z0-9@/_.-]+": *"installed:(brew|cask)"' "$INSTALL_STATE_FILE" 2>/dev/null \
        | sed -E 's/^"([^"]+)": *"installed:(brew|cask)"/\2 "\1"/' || true
}

# install_state_has_entries - true if the state file exists and records
# at least one package (used to decide whether resume is even offered).
install_state_has_entries() {
    [[ -f "$INSTALL_STATE_FILE" ]] && grep -q '": "' "$INSTALL_STATE_FILE" 2>/dev/null
}

# install_brewfile_per_line <brewfile>
# Installs one Brewfile entry at a time via its own single-entry Brewfile,
# instead of one `brew bundle install` call for the whole file. Used as a
# fallback (see install_brewfile below) because `brew bundle install`
# aborts entirely at the first broken entry and never attempts the rest -
# confirmed live: a bogus formula ahead of a real one caused the real one
# to never even be attempted. Reuses run_step's STEP_RESULTS ledger for
# the pass/fail tally, then offers to retry whatever failed.
install_brewfile_per_line() {
    local brewfile="$1" tap_lines failed=() line id type status
    local installed_formulae installed_casks

    tap_lines="$(_brewfile_tap_lines "$brewfile")"
    installed_formulae=" $(_already_installed_ids formula) "
    installed_casks=" $(_already_installed_ids cask) "

    INSTALL_SUCCEEDED=()
    INSTALL_FAILED=()
    INSTALL_ALREADY=()

    while IFS= read -r line; do
        case "$line" in
            brew\ \"*) type="brew" ;;
            cask\ \"*) type="cask" ;;
            vscode\ \"*|npm\ \"*) continue ;;
            *) continue ;;
        esac
        id="$(printf '%s' "$line" | sed -E 's/^[a-z]+[[:space:]]+"([^"]+)".*/\1/')"

        if { [[ "$type" == "brew" ]] && [[ "$installed_formulae" == *" $id "* ]]; } \
            || { [[ "$type" == "cask" ]] && [[ "$installed_casks" == *" $id "* ]]; }; then
            STEP_RESULTS+=("PASS|$id already installed")
            log_success "$id - already installed"
            INSTALL_ALREADY+=("$id")
            install_state_set "$id" "installed" "$type"
            continue
        fi

        local tmp_single
        tmp_single="$(mktemp -t devforgekit-brewfile-line.XXXXXX)"
        { [[ -n "$tap_lines" ]] && printf '%s\n' "$tap_lines"; printf '%s\n' "$line"; } > "$tmp_single"

        set +e
        dfk_run_destructive "Install $id" -- brew bundle install --file="$tmp_single" >/dev/null 2>&1
        status=$?
        set -e
        rm -f "$tmp_single"

        if [[ $status -eq 0 ]]; then
            STEP_RESULTS+=("PASS|Installed $id")
            log_success "Installed $id"
            INSTALL_SUCCEEDED+=("$id")
            install_state_set "$id" "installed" "$type"
        else
            failed+=("$line")
            STEP_RESULTS+=("FAIL|$id failed to install (exit $status)")
            log_error "$id failed to install (exit $status)"
            INSTALL_FAILED+=("$id")
            install_state_set "$id" "failed" "$type"
        fi
    done < "$brewfile"

    if [[ ${#failed[@]} -gt 0 ]]; then
        log_warn "${#failed[@]} package(s) failed to install."
        if confirm "Retry the ${#failed[@]} failed package(s)?"; then
            local retry_brewfile retry_status retry_id
            retry_brewfile="$(mktemp -t devforgekit-brewfile-retry.XXXXXX)"
            { [[ -n "$tap_lines" ]] && printf '%s\n' "$tap_lines"; printf '%s\n' "${failed[@]}"; } > "$retry_brewfile"
            set +e
            dfk_run_destructive "Retry failed packages" -- brew bundle install --file="$retry_brewfile"
            retry_status=$?
            set -e
            rm -f "$retry_brewfile"
            if [[ $retry_status -eq 0 ]]; then
                STEP_RESULTS+=("PASS|Retry failed packages")
                log_success "Retry failed packages"
                local retry_type
                for line in "${failed[@]}"; do
                    retry_id="$(printf '%s' "$line" | sed -E 's/^[a-z]+[[:space:]]+"([^"]+)".*/\1/')"
                    case "$line" in brew\ \"*) retry_type="brew" ;; *) retry_type="cask" ;; esac
                    install_state_set "$retry_id" "installed" "$retry_type"
                    INSTALL_SUCCEEDED+=("$retry_id")
                done
                INSTALL_FAILED=()
            else
                STEP_RESULTS+=("WARNING|Retry failed packages (exit $retry_status)")
                log_warn "Retry failed packages skipped or failed (exit $retry_status)"
            fi
        fi
    fi

    return 0
}

# install_brewfile <brewfile>
# Tries the normal, fast single `brew bundle install` call first - the
# common case where everything succeeds is unchanged from before. Only
# falls back to the slower one-entry-at-a-time path (see
# install_brewfile_per_line above) when that call actually fails, so one
# broken formula doesn't block every other package in the file. Populates
# the same INSTALL_SUCCEEDED/INSTALL_FAILED/INSTALL_ALREADY globals and
# install-state file either way, so bootstrap.sh's post-install summary
# and resume support work the same regardless of which path ran.
install_brewfile() {
    local brewfile="$1"
    local installed_formulae installed_casks line type id

    installed_formulae=" $(_already_installed_ids formula) "
    installed_casks=" $(_already_installed_ids cask) "
    INSTALL_SUCCEEDED=()
    INSTALL_FAILED=()
    INSTALL_ALREADY=()

    if dfk_run_destructive "Homebrew packages (brew bundle)" -- brew bundle install --file="$brewfile"; then
        STEP_RESULTS+=("PASS|Homebrew packages (brew bundle)")
        log_success "Homebrew packages (brew bundle)"

        while IFS= read -r line; do
            case "$line" in
                brew\ \"*) type="brew" ;;
                cask\ \"*) type="cask" ;;
                *) continue ;;
            esac
            id="$(printf '%s' "$line" | sed -E 's/^[a-z]+[[:space:]]+"([^"]+)".*/\1/')"
            install_state_set "$id" "installed" "$type"
            if { [[ "$type" == "brew" ]] && [[ "$installed_formulae" == *" $id "* ]]; } \
                || { [[ "$type" == "cask" ]] && [[ "$installed_casks" == *" $id "* ]]; }; then
                INSTALL_ALREADY+=("$id")
            else
                INSTALL_SUCCEEDED+=("$id")
            fi
        done < "$brewfile"

        return 0
    fi

    log_warn "brew bundle install failed - Homebrew aborts on the first broken entry rather than continuing past it."
    log_warn "Retrying one package at a time so a single bad formula/cask doesn't block the rest..."
    install_brewfile_per_line "$brewfile"
}

# install_global_command - symlinks this repo's `devforgekit` CLI into the
# Homebrew prefix's bin directory (already on PATH via brew shellenv) so it
# can be run as a plain `devforgekit` command from anywhere, not just
# `./devforgekit` from inside the repo. Never invokes sudo automatically -
# that would hang a non-interactive/CI run waiting on a password prompt -
# if the target directory isn't writable, it just tells you the command to
# run yourself.
install_global_command() {
    local target_dir target link_path
    target_dir="$(os_brew_prefix)/bin"
    target="$DEV_SETUP_ROOT/devforgekit"
    link_path="$target_dir/devforgekit"

    if [[ ! -w "$target_dir" ]]; then
        log_warn "$target_dir is not writable - install the global command yourself with:"
        log_warn "  sudo ln -sf \"$target\" \"$link_path\""
        return 1
    fi

    if [[ -L "$link_path" && "$(readlink "$link_path")" == "$target" ]]; then
        log_step "Up to date: $link_path -> $target"
        return 0
    fi

    fs_ensure_dir "$target_dir"
    ln -sf "$target" "$link_path"
    log_success "Linked $link_path -> $target (run 'devforgekit' from anywhere)"
}

# verify_global_command - bounded post-install check that `devforgekit`
# resolves on PATH to this repo's dispatcher and the Node CLI dependencies
# it needs are present; retries install_global_command/
# ensure_cli_dependencies once on failure before giving up. This is
# intentionally narrow (symlink + node_modules only) - not the full
# repair-engine "CLI install" category, which is separate follow-up work
# (see docs/InstallationAudit.md).
verify_global_command() {
    local resolved target ok=0

    target="$DEV_SETUP_ROOT/devforgekit"
    resolved="$(command -v devforgekit 2>/dev/null || true)"
    if [[ -z "$resolved" ]] || [[ "$(readlink "$resolved" 2>/dev/null || echo "$resolved")" != "$target" ]]; then
        log_warn "'devforgekit' does not resolve to this repo's dispatcher yet - retrying the symlink..."
        install_global_command || ok=1
    fi

    if [[ ! -d "$DEV_SETUP_ROOT/cli/node_modules" ]]; then
        log_warn "cli/node_modules is missing - retrying the Node CLI setup..."
        ensure_cli_dependencies || ok=1
    fi

    resolved="$(command -v devforgekit 2>/dev/null || true)"
    if [[ -z "$resolved" ]] || [[ "$(readlink "$resolved" 2>/dev/null || echo "$resolved")" != "$target" ]]; then
        ok=1
    fi
    [[ ! -d "$DEV_SETUP_ROOT/cli/node_modules" ]] && ok=1

    return $ok
}

# _verify_run <description> <cmd...> - like run_step (STEP_RESULTS entry,
# never aborts the caller under errexit), but returns the wrapped
# command's real exit status instead of always 0 - run_step deliberately
# always returns 0 so a failing step never aborts the script, which also
# means callers can't use `run_step ... || ...` to learn whether it
# actually passed. verify_devforgekit_cli needs that (its own caller
# needs to know whether every check really passed).
_verify_run() {
    local description="$1"
    shift
    set +e
    "$@" >/dev/null 2>&1
    local status=$?
    set -e
    if [[ $status -eq 0 ]]; then
        STEP_RESULTS+=("PASS|$description")
        log_success "$description"
    else
        STEP_RESULTS+=("FAIL|$description (exit $status)")
        log_error "$description failed (exit $status)"
    fi
    return $status
}

# verify_devforgekit_cli - the mandatory post-install check: not just
# inferring the install worked from file/symlink presence, but actually
# executing real commands and checking their exit codes.
# verify_global_command's symlink/node_modules check runs first (with
# its own auto-repair), then three real invocations: `devforgekit
# --version`, `devforgekit check` (the fast, read-only PASS/WARNING/FAIL
# sweep - safe to run unattended right after install), and devforgekit
# itself forced down its non-TTY fallback path
# (DEVFORGEKIT_NO_TUI=1 - the same env var isTuiCapable() already
# documents) so verification never hangs waiting on an interactive
# dashboard it can't actually test headlessly.
verify_devforgekit_cli() {
    run_step_optional "devforgekit command resolves correctly" verify_global_command

    if ! command_exists devforgekit; then
        log_warn "devforgekit still isn't on PATH - skipping command execution checks."
        return 1
    fi

    local ok=0
    _verify_run "devforgekit --version" devforgekit --version || ok=1
    _verify_run "devforgekit check" devforgekit check || ok=1
    _verify_run "devforgekit (dashboard fallback)" env DEVFORGEKIT_NO_TUI=1 devforgekit || ok=1

    if [[ $ok -eq 0 ]]; then
        log_success "Everything works."
    fi
    return $ok
}

# --------------------------------------------------------------------------
# DevForgeKit Core CLI (Layer 2 - see docs/PlatformArchitecture.md)
# --------------------------------------------------------------------------

# ensure_cli_dependencies - installs cli/'s own npm dependencies so the
# root `devforgekit` dispatcher can delegate to it (see cli_available in
# the `devforgekit` file). Uses `mise exec -- npm` (not a bare `npm`)
# specifically because the node/npm mise.toml just pinned may not be on
# *this* process's $PATH yet - restore_mise's `mise install` only
# installs the tool, it doesn't re-exec the shell - so resolving through
# `mise exec` works regardless of whether mise's shims are already on
# PATH. Never fails the caller hard: a missing/failed CLI setup just
# means the `devforgekit` dispatcher keeps using its bash fallback path.
ensure_cli_dependencies() {
    local cli_dir="$DEV_SETUP_ROOT/cli"
    [[ -f "$cli_dir/package.json" ]] || return 0

    local npm_cmd
    if command_exists mise; then
        npm_cmd=(mise exec -- npm)
    elif command_exists npm; then
        npm_cmd=(npm)
    else
        log_warn "npm not found (mise not installed and npm not on PATH); skipping DevForgeKit CLI setup"
        return 1
    fi

    if [[ -f "$cli_dir/package-lock.json" ]]; then
        (cd "$cli_dir" && "${npm_cmd[@]}" ci --no-audit --no-fund)
    else
        (cd "$cli_dir" && "${npm_cmd[@]}" install --no-audit --no-fund)
    fi
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

    if [[ "${SKIP_EDITOR_EXTENSIONS:-0}" == "1" ]]; then
        log_step "Skipping $editor extension install (install wizard choice)"
        return 0
    fi

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
        dfk_run_destructive "Start $svc" -- brew services start "$svc" >/dev/null 2>&1 || log_warn "Could not start $svc"
    done
}

# service_start_selected <svc...> - like service_start_all but only for an
# explicit subset (the install wizard's "Choose" services option). A call
# with zero arguments is a deliberate no-op, not an error.
service_start_selected() {
    local svc
    for svc in "$@"; do
        dfk_run_destructive "Start $svc" -- brew services start "$svc" >/dev/null 2>&1 || log_warn "Could not start $svc"
    done
}

service_stop_all() {
    local svc
    for svc in "${SERVICE_LIST[@]}"; do
        dfk_run_destructive "Stop $svc" -- brew services stop "$svc" >/dev/null 2>&1 || log_warn "Could not stop $svc"
    done
}

service_restart_all() {
    local svc
    for svc in "${SERVICE_LIST[@]}"; do
        dfk_run_destructive "Restart $svc" -- brew services restart "$svc" >/dev/null 2>&1 || log_warn "Could not restart $svc"
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

# print_health_score - a 0-100 score computed from the same STEP_RESULTS
# print_summary just reported on (PASS = full credit, WARNING = half
# credit, FAIL = no credit), plus a Ready/Needs Attention verdict. Call
# after print_summary, e.g.:
#   if print_summary; then STATUS=0; else STATUS=1; fi
#   print_health_score
#   exit $STATUS
# _health_score_value - the pure 0-100 computation (PASS=full credit,
# WARNING=half, FAIL=none) over STEP_RESULTS, shared by print_health_score
# and the post-install welcome screen so both stay in sync instead of
# duplicating the formula.
_health_score_value() {
    local pass warn fail
    read -r pass warn fail <<< "$(_health_score_counts)"

    local total=$((pass + warn + fail))
    if [[ $total -eq 0 ]]; then
        echo 100
    else
        echo $(((pass * 100 + warn * 50) / total))
    fi
}

# _health_score_counts - "pass warn fail" over STEP_RESULTS, the same
# tally _health_score_value folds into one percentage - split out so the
# welcome screen can show "N verified, M warnings" without re-deriving
# the loop.
_health_score_counts() {
    local pass=0 warn=0 fail=0 entry status

    for entry in "${STEP_RESULTS[@]}"; do
        status="${entry%%|*}"
        case "$status" in
            PASS)    ((pass++)) ;;
            WARNING) ((warn++)) ;;
            FAIL)    ((fail++)) ;;
        esac
    done

    echo "$pass $warn $fail"
}

# ui_health_bar <score> - a 24-cell block bar, same fill characters
# (█/░) and 90/70 color thresholds as the Node CLI's lib/ui.js
# healthBar() - one shared visual language for "percent done" whether a
# score was computed by bash or Node.
ui_health_bar() {
    local score="$1" bar_width=24 filled empty i bar="" color
    filled=$(((score * bar_width + 50) / 100))
    [[ $filled -gt $bar_width ]] && filled=$bar_width
    empty=$((bar_width - filled))
    if [[ $score -ge 90 ]]; then color="$COLOR_SUCCESS"; elif [[ $score -ge 70 ]]; then color="$COLOR_WARNING"; else color="$COLOR_ERROR"; fi
    for ((i = 0; i < filled; i++)); do bar+="█"; done
    for ((i = 0; i < empty; i++)); do bar+="░"; done
    printf '%s%s  %d%%%s\n' "$color" "$bar" "$score" "$COLOR_RESET"
}

print_health_score() {
    local score
    score="$(_health_score_value)"

    echo
    ui_health_bar "$score"
    if [[ $score -ge 90 ]]; then
        printf '%sHealth Score: %d%%%s\n' "$COLOR_SUCCESS" "$score" "$COLOR_RESET"
        printf '%sMachine Ready%s\n' "$COLOR_SUCCESS" "$COLOR_RESET"
    elif [[ $score -ge 70 ]]; then
        printf '%sHealth Score: %d%%%s\n' "$COLOR_WARNING" "$score" "$COLOR_RESET"
        printf '%sMachine Mostly Ready - see warnings above%s\n' "$COLOR_WARNING" "$COLOR_RESET"
    else
        printf '%sHealth Score: %d%%%s\n' "$COLOR_ERROR" "$score" "$COLOR_RESET"
        printf '%sMachine Needs Attention%s\n' "$COLOR_ERROR" "$COLOR_RESET"
    fi
}

# print_welcome_screen <verified-tool...>
# The first-run "you're all set" summary shown instead of silently
# handing off to the dashboard or dropping back to the shell: health
# score (same computation print_health_score uses), which tools this
# run actually verified, and a numbered next-steps menu. Only ever
# called on a real success, a real tty, and never in --dry-run - see the
# gate around this call in bootstrap.sh. Exits the caller via exec/exit
# itself based on the menu choice, so nothing after this call runs.
print_welcome_screen() {
    local installed=("$@") score pass warn fail tool choice

    score="$(_health_score_value)"
    read -r pass warn fail <<< "$(_health_score_counts)"

    echo
    echo "${COLOR_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}"
    echo "${COLOR_BOLD}DevForgeKit is ready.${COLOR_RESET}"
    echo
    ui_health_bar "$score"
    printf '%s%d verified%s, %s%d warning(s)%s, %s%d failed%s\n' \
        "$COLOR_SUCCESS" "$pass" "$COLOR_RESET" \
        "$COLOR_WARNING" "$warn" "$COLOR_RESET" \
        "$COLOR_ERROR" "$fail" "$COLOR_RESET"

    if [[ ${#installed[@]} -gt 0 ]]; then
        echo
        echo "Installed:"
        for tool in "${installed[@]-}"; do
            [[ -n "$tool" ]] && printf '  %s%s%s %s\n' "$COLOR_SUCCESS" "$SYMBOL_PASS" "$COLOR_RESET" "$tool"
        done
    fi

    echo
    echo "Configuration:"
    printf '  %s%s%s .zshrc, .gitconfig, mise.toml restored\n' "$COLOR_SUCCESS" "$SYMBOL_PASS" "$COLOR_RESET"

    echo
    echo "Next steps:"
    echo "  1) Launch dashboard"
    echo "  2) Run doctor"
    echo "  3) Generate first project"
    echo "  4) Exit"
    echo
    echo "Docs: docs/CommandReference.md - docs/Troubleshooting.md - docs/PlatformArchitecture.md"
    echo "${COLOR_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}"

    read -r -p "Enter a number [1-4] (default 1): " choice
    case "${choice:-1}" in
        2) exec "$DEV_SETUP_ROOT/devforgekit" doctor ;;
        3) exec "$DEV_SETUP_ROOT/devforgekit" new ;;
        4) exit 0 ;;
        *) exec "$DEV_SETUP_ROOT/devforgekit" ;;
    esac
}
