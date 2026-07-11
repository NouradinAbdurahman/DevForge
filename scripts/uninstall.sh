#!/usr/bin/env bash
# Uninstalls what DevForgeKit installed: Homebrew packages, VS Code/Cursor
# extensions, restored configuration files, and running services. Always
# previews the concrete list before removing anything. See
# docs/InstallationAudit.md.
#
# Safety, by design, after a real incident: testing this script by piping
# "n" into it (assuming that would decline) instead actually ran a real
# uninstall on a real machine, because confirm() (scripts/common.sh)
# intentionally auto-confirms whenever stdin isn't a real tty - correct
# for unattended install/backup/update in CI, wrong for anything this
# destructive. So, unlike every other script in this repo, this one does
# NOT rely on confirm()'s default: it refuses to run at all in a
# non-interactive context unless --force is passed explicitly, checked
# *before* anything else runs. Every actual destructive operation below
# also goes through dfk_run_destructive/dfk_remove_file
# (scripts/common.sh) so DEVFORGEKIT_TEST_MODE=1 can exercise all of this
# script's real logic in tests with zero risk to the host machine, as a
# second, independent layer of defense.
#
# Usage: ./scripts/uninstall.sh [--all] [--packages] [--config] [--vscode] [--cursor] [--services] [--force|--yes]
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

DO_PACKAGES=0
DO_VSCODE=0
DO_CURSOR=0
DO_CONFIG=0
DO_SERVICES=0
ANY_FLAG=0
FORCE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --all) DO_PACKAGES=1; DO_VSCODE=1; DO_CURSOR=1; DO_CONFIG=1; DO_SERVICES=1; ANY_FLAG=1; shift ;;
        --packages) DO_PACKAGES=1; ANY_FLAG=1; shift ;;
        --config) DO_CONFIG=1; ANY_FLAG=1; shift ;;
        --vscode) DO_VSCODE=1; ANY_FLAG=1; shift ;;
        --cursor) DO_CURSOR=1; ANY_FLAG=1; shift ;;
        --services) DO_SERVICES=1; ANY_FLAG=1; shift ;;
        --force|-y|--yes) FORCE=1; shift ;;
        -h|--help)
            echo "Usage: $0 [--all] [--packages] [--config] [--vscode] [--cursor] [--services] [--force|--yes]"
            echo "  --all        every category below"
            echo "  --packages   Homebrew formulae/casks this machine's install-state.json (or the"
            echo "               current default profile's Brewfile, if no state file exists) recorded as installed"
            echo "  --config     .zshrc, .gitconfig, .gitignore_global, mise config, editor settings/keybindings"
            echo "               (each backed up as <file>.backup-<timestamp> before removal, never a bare delete)"
            echo "  --vscode     VS Code extensions"
            echo "  --cursor     Cursor extensions"
            echo "  --services   stop PostgreSQL/MySQL/Redis"
            echo "  --force, --yes, -y   required to run non-interactively; also skips the final confirm"
            echo
            echo "With no category flags in an interactive terminal, shows a checklist instead."
            echo "Refuses to run non-interactively without --force - this command is destructive"
            echo "and irreversible for anything not backed up, so it never silently no-ops or"
            echo "silently proceeds unattended."
            exit 0
            ;;
        *) log_error "Unknown option: $1"; exit 1 ;;
    esac
done

# The critical gate: a non-interactive context (piped stdin, CI, cron)
# MUST pass --force to do anything at all. This runs before category
# selection/checklist/preview - no flag combination bypasses it - so a
# script or a mistaken test invocation can never trigger a real
# uninstall by accident the way `confirm()`'s own default would allow.
if [[ "$FORCE" -eq 0 && ! -t 0 ]]; then
    log_error "Refusing to run non-interactively without --force - this command is destructive."
    log_error "Pass --force (and any of --all/--packages/--config/--vscode/--cursor/--services), or run in a real terminal."
    log_error "No changes were made."
    exit 1
fi

# _uninstall_checklist - the same bash-3.2-safe toggle-loop pattern
# scripts/install_wizard.sh's _wizard_custom_categories already
# established, reused here rather than reinvented. Everything starts
# checked, matching the PRD's own example.
_uninstall_checklist() {
    local items=("Installed packages" "VS Code extensions" "Cursor extensions" "Configuration" "Services")
    local selected=("${items[@]}")
    local finished=0 choice i it mark

    while [[ "$finished" -eq 0 ]]; do
        echo
        log_section "Remove"
        i=1
        for it in "${items[@]}"; do
            mark=" "
            case " ${selected[*]-} " in *" $it "*) mark="x" ;; esac
            printf '  %d) [%s] %s\n' "$i" "$mark" "$it"
            i=$((i + 1))
        done
        echo "  a) select all    n) select none    d) done selecting"
        read -r -p "Toggle a number, or a/n/d: " choice

        case "$choice" in
            a|A) selected=("${items[@]}") ;;
            n|N) selected=() ;;
            d|D) finished=1 ;;
            ''|*[!0-9]*) log_warn "Not a valid choice" ;;
            *)
                if (( choice >= 1 && choice <= ${#items[@]} )); then
                    it="${items[$((choice - 1))]}"
                    case " ${selected[*]-} " in
                        *" $it "*)
                            local new_selected=() s
                            for s in "${selected[@]}"; do
                                [[ "$s" == "$it" ]] || new_selected+=("$s")
                            done
                            if [[ ${#new_selected[@]} -eq 0 ]]; then selected=(); else selected=("${new_selected[@]}"); fi
                            ;;
                        *) selected+=("$it") ;;
                    esac
                else
                    log_warn "Not a valid choice"
                fi
                ;;
        esac
    done

    case " ${selected[*]-} " in *"Installed packages"*) DO_PACKAGES=1 ;; esac
    case " ${selected[*]-} " in *"VS Code extensions"*) DO_VSCODE=1 ;; esac
    case " ${selected[*]-} " in *"Cursor extensions"*) DO_CURSOR=1 ;; esac
    case " ${selected[*]-} " in *"Configuration"*) DO_CONFIG=1 ;; esac
    case " ${selected[*]-} " in *"Services"*) DO_SERVICES=1 ;; esac
}

if [[ "$ANY_FLAG" -eq 0 ]]; then
    if [[ -t 0 ]]; then
        _uninstall_checklist
    else
        # Only reachable with --force and no category flags (the tty
        # gate above already refused every other non-interactive case).
        log_error "No category selected. Pass an explicit flag: --all, --packages, --config, --vscode, --cursor, --services"
        exit 1
    fi
fi

if [[ "$DO_PACKAGES" -eq 0 && "$DO_VSCODE" -eq 0 && "$DO_CURSOR" -eq 0 && "$DO_CONFIG" -eq 0 && "$DO_SERVICES" -eq 0 ]]; then
    log_info "Nothing selected - nothing to do."
    exit 0
fi

# _package_lines_to_remove - install-state.json (what this machine's
# bootstrap.sh runs actually installed) if it has entries, else the
# current default profile's Brewfile, so --packages still does something
# sensible on a machine that predates the install-state file.
_package_lines_to_remove() {
    local lines
    lines="$(install_state_installed_lines)"
    if [[ -z "$lines" ]]; then
        local profile brewfile
        profile="$(resolve_profile "")"
        brewfile="$(profile_brewfile_path "$profile")"
        if [[ -f "$brewfile" ]]; then
            lines="$(grep -oE '^[[:space:]]*(brew|cask)[[:space:]]+"[^"]+"' "$brewfile" \
                | sed -E 's/^[[:space:]]*(brew|cask)[[:space:]]+"([^"]+)"/\1 "\2"/')"
        fi
    fi
    printf '%s\n' "$lines"
}

# --------------------------------------------------------------------------
# Preview
# --------------------------------------------------------------------------

log_section "Uninstall preview"

if [[ "$DO_PACKAGES" -eq 1 ]]; then
    _pkg_count="$(_package_lines_to_remove | grep -c . || true)"
    echo "  Packages:     ${_pkg_count:-0}"
fi
if [[ "$DO_VSCODE" -eq 1 ]]; then
    _vscode_count="$(wc -l < "$DEV_SETUP_ROOT/vscode/extensions.txt" 2>/dev/null || echo 0)"
    echo "  VS Code extensions: ${_vscode_count:-0}"
fi
if [[ "$DO_CURSOR" -eq 1 ]]; then
    _cursor_count="$(wc -l < "$DEV_SETUP_ROOT/cursor/extensions.txt" 2>/dev/null || echo 0)"
    echo "  Cursor extensions:  ${_cursor_count:-0}"
fi
if [[ "$DO_CONFIG" -eq 1 ]]; then
    echo "  Configuration: .zshrc, .gitconfig, .gitignore_global, mise config, editor settings/keybindings (each backed up first)"
fi
if [[ "$DO_SERVICES" -eq 1 ]]; then
    echo "  Services:     ${SERVICE_LIST[*]}"
fi
echo

if [[ "$FORCE" -eq 1 ]]; then
    log_info "Skipping confirmation (--force)."
elif ! confirm "Continue with uninstall?"; then
    log_info "Uninstall cancelled."
    exit 0
fi

# --------------------------------------------------------------------------
# Packages
# --------------------------------------------------------------------------

if [[ "$DO_PACKAGES" -eq 1 ]]; then
    log_section "Removing packages"
    _lines="$(_package_lines_to_remove)"
    if [[ -z "$_lines" ]]; then
        log_info "Nothing to remove."
    else
        _type=""
        _id=""
        while IFS=' ' read -r _type _id; do
            [[ -z "$_id" ]] && continue
            _id="$(printf '%s' "$_id" | tr -d '"')"
            case "$_type" in
                brew) run_step_optional "Uninstall $_id" dfk_run_destructive "Uninstall $_id" -- brew uninstall "$_id" ;;
                cask) run_step_optional "Uninstall $_id" dfk_run_destructive "Uninstall $_id" -- brew uninstall --cask "$_id" ;;
            esac
        done <<< "$_lines"
    fi
    install_state_reset
fi

# --------------------------------------------------------------------------
# Editor extensions
# --------------------------------------------------------------------------

_uninstall_editor_extensions() {
    local editor="$1" cli extensions_file
    cli="$(editor_cli "$editor")"
    extensions_file="$DEV_SETUP_ROOT/$editor/extensions.txt"

    if ! command_exists "$cli"; then
        log_warn "$cli CLI not found on PATH; skipping $editor extension removal"
        return 0
    fi
    if [[ ! -f "$extensions_file" ]]; then
        log_info "No $editor extensions.txt found."
        return 0
    fi

    log_section "Removing $editor extensions"
    local extension
    while IFS= read -r extension; do
        [[ -z "$extension" ]] && continue
        if dfk_run_destructive "Remove $editor extension $extension" -- "$cli" --uninstall-extension "$extension" >/dev/null 2>&1; then
            log_success "$extension"
        else
            log_warn "Failed to remove $extension"
        fi
    done < "$extensions_file"
}

[[ "$DO_VSCODE" -eq 1 ]] && _uninstall_editor_extensions vscode
[[ "$DO_CURSOR" -eq 1 ]] && _uninstall_editor_extensions cursor

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

_uninstall_backup_and_remove() {
    local target="$1"
    [[ -f "$target" ]] || return 0
    local backup
    backup="${target}.backup-$(date +%Y%m%d%H%M%S)"
    cp "$target" "$backup"
    dfk_remove_file "$target"
    log_success "Removed $target (backed up to $backup)"
}

if [[ "$DO_CONFIG" -eq 1 ]]; then
    log_section "Removing configuration"
    _uninstall_backup_and_remove "$HOME/.zshrc"
    _uninstall_backup_and_remove "$HOME/.gitconfig"
    _uninstall_backup_and_remove "$HOME/.gitignore_global"
    _uninstall_backup_and_remove "$HOME/.config/mise/config.toml"
    _editor=""
    _support_dir=""
    for _editor in vscode cursor; do
        _support_dir="$(editor_app_support_dir "$_editor" 2>/dev/null || true)"
        [[ -n "$_support_dir" ]] || continue
        _uninstall_backup_and_remove "$_support_dir/settings.json"
        _uninstall_backup_and_remove "$_support_dir/keybindings.json"
    done
fi

# --------------------------------------------------------------------------
# Services
# --------------------------------------------------------------------------

if [[ "$DO_SERVICES" -eq 1 ]]; then
    log_section "Stopping services"
    service_stop_all
fi

echo
log_success "Uninstall complete."
