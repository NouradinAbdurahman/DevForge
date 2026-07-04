#!/usr/bin/env bash
# Backs up and restores macOS UI preferences (Dock, Finder, Trackpad,
# Keyboard, Mouse, Screenshots, Terminal, Appearance/Dark Mode, Mission
# Control, Desktop, Stage Manager, Menu Bar, Control Center, Hot Corners,
# and optionally Safari) via `defaults export`/`defaults import`.
#
# Many of those named categories share the same underlying `defaults`
# domain (Mission Control/Hot Corners/Stage Manager all live in
# com.apple.dock; Menu Bar/Control Center both live in
# com.apple.controlcenter; Keyboard/Mouse/Dark Mode live in
# NSGlobalDomain) - see preference_domain_pairs() in common.sh for the
# authoritative domain -> file mapping.
#
# Usage: ./scripts/preferences.sh <backup|restore|status>
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

PREFERENCES_DIR="$DEV_SETUP_ROOT/preferences"

usage() {
    echo "Usage: $0 <backup|restore|status>"
    exit 1
}

[[ $# -eq 1 ]] || usage

if ! os_is_macos; then
    log_error "Preferences are macOS-specific."
    exit 1
fi

# _backup_domain <domain> <filename>
# Exports the live domain to a temp file; if a backup already exists and
# differs, asks for confirmation before overwriting (fs_safe_copy then
# additionally preserves the previous backup as a timestamped .backup file).
# shellcheck disable=SC2317,SC2329 # invoked indirectly via run_step/run_step_optional "$@"; body is not actually unreachable
_backup_domain() {
    local domain="$1" filename="$2" dest tmp
    dest="$PREFERENCES_DIR/$filename"
    tmp="$(mktemp)"

    defaults export "$domain" "$tmp"

    if [[ -f "$dest" ]] && ! cmp -s "$tmp" "$dest"; then
        if ! confirm "$filename already exists and differs from the live $domain settings - overwrite?"; then
            log_info "Kept existing backup: $filename"
            rm -f "$tmp"
            return 0
        fi
    fi

    fs_ensure_dir "$PREFERENCES_DIR"
    fs_safe_copy "$tmp" "$dest"
    rm -f "$tmp"
}

# _restore_domain <domain> <filename>
# shellcheck disable=SC2317,SC2329 # invoked indirectly via run_step/run_step_optional "$@"; body is not actually unreachable
_restore_domain() {
    local domain="$1" filename="$2" src
    src="$PREFERENCES_DIR/$filename"
    if [[ ! -f "$src" ]]; then
        log_warn "No backup found for $domain ($filename) - run 'backup' first"
        return 1
    fi
    defaults import "$domain" "$src"
}

# _status_domain <domain> <filename>
_status_domain() {
    local domain="$1" filename="$2" dest tmp
    dest="$PREFERENCES_DIR/$filename"

    if [[ ! -f "$dest" ]]; then
        record_result WARNING "$filename: no backup yet"
        return 0
    fi

    tmp="$(mktemp)"
    defaults export "$domain" "$tmp"
    if cmp -s "$tmp" "$dest"; then
        record_result PASS "$filename: in sync with live $domain"
    else
        record_result WARNING "$filename: live $domain has changed since last backup"
    fi
    rm -f "$tmp"
}

case "$1" in
    backup)
        log_section "DevForgeKit Preferences: Backup"
        log_info "Backing up macOS preferences to $PREFERENCES_DIR"
        while IFS='|' read -r domain filename optional; do
            [[ -z "$domain" ]] && continue
            if [[ "$optional" -eq 1 ]]; then
                run_step_optional "Backup $domain -> $filename" _backup_domain "$domain" "$filename"
            else
                run_step "Backup $domain -> $filename" _backup_domain "$domain" "$filename"
            fi
        done < <(preference_domain_pairs)
        ;;
    restore)
        log_section "DevForgeKit Preferences: Restore"
        log_info "Restoring macOS preferences from $PREFERENCES_DIR"
        while IFS='|' read -r domain filename optional; do
            [[ -z "$domain" ]] && continue
            if [[ "$optional" -eq 1 ]]; then
                run_step_optional "Restore $domain <- $filename" _restore_domain "$domain" "$filename"
            else
                run_step "Restore $domain <- $filename" _restore_domain "$domain" "$filename"
            fi
        done < <(preference_domain_pairs)

        log_step "Restarting affected apps to apply changes..."
        for app in Dock Finder SystemUIServer cfprefsd; do
            killall "$app" >/dev/null 2>&1 || true
        done
        log_info "Some changes (Appearance, Stage Manager) may need a logout/restart to fully apply."
        ;;
    status)
        log_section "DevForgeKit Preferences: Status ($PREFERENCES_DIR)"
        while IFS='|' read -r domain filename optional; do
            [[ -z "$domain" ]] && continue
            _status_domain "$domain" "$filename"
        done < <(preference_domain_pairs)
        ;;
    *)
        usage
        ;;
esac

if print_summary; then
    exit 0
else
    exit 1
fi
