#!/usr/bin/env bash
# Deep diagnostics beyond check.sh: PATH hygiene, broken symlinks, git/ssh/
# GitHub auth, Docker daemon state, and the doctor commands each toolchain
# ships with (brew doctor, mise doctor, flutter doctor).
#
# Usage: ./scripts/doctor.sh [--fix]
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

FIX=0
case "${1:-}" in
    --fix) FIX=1 ;;
    -h|--help) echo "Usage: $0 [--fix]"; exit 0 ;;
    "") ;;
    *) log_error "Unknown option: $1"; exit 1 ;;
esac

log_section "Doctor: deep diagnostics"

# --------------------------------------------------------------------------
# PATH hygiene
# --------------------------------------------------------------------------

log_section "PATH"

# No associative arrays here on purpose: this must run under the stock
# macOS /bin/bash (3.2), which predates bash 4's `declare -A`.
IFS=':' read -r -a path_entries <<< "$PATH"
duplicates=()
missing=()

duplicate_values="$(printf '%s\n' "${path_entries[@]}" | grep -v '^$' | sort | uniq -d)"
if [[ -n "$duplicate_values" ]]; then
    while IFS= read -r dup; do
        duplicates+=("$dup")
    done <<< "$duplicate_values"
fi

for entry in "${path_entries[@]}"; do
    [[ -z "$entry" ]] && continue
    [[ -d "$entry" ]] || missing+=("$entry")
done

if [[ ${#duplicates[@]} -eq 0 ]]; then
    record_result PASS "No duplicate PATH entries"
else
    record_result WARNING "Duplicate PATH entries: ${duplicates[*]}"
fi

if [[ ${#missing[@]} -eq 0 ]]; then
    record_result PASS "All PATH entries exist on disk"
else
    record_result WARNING "PATH entries pointing to nonexistent directories: ${missing[*]}"
fi

# --------------------------------------------------------------------------
# PATH manager - installed tools that aren't on PATH (the inverse check:
# stale entries above vs. missing-but-needed entries here)
# --------------------------------------------------------------------------

log_section "PATH manager"

if path_manager_check; then
    log_success "Nothing to fix"
elif [[ "$FIX" -eq 1 ]]; then
    path_manager_fix
else
    log_info "Run './scripts/doctor.sh --fix' (or './dev doctor --fix') to add these to ~/.zshrc automatically."
fi

# --------------------------------------------------------------------------
# Shell integration
# --------------------------------------------------------------------------

log_section "Shell integration"

if [[ "$SHELL" == *zsh ]]; then
    record_result PASS "Default shell is zsh"
else
    record_result WARNING "Default shell is $SHELL, not zsh (this repo's .zshrc won't be loaded)"
fi

for tool in mise fzf pnpm; do
    if grep -q "$tool" "$HOME/.zshrc" 2>/dev/null; then
        record_result PASS "$tool integration present in ~/.zshrc"
    else
        record_result WARNING "$tool integration not found in ~/.zshrc"
    fi
done

# --------------------------------------------------------------------------
# Broken symlinks in common config locations
# --------------------------------------------------------------------------

log_section "Symlinks"

broken=0
while IFS= read -r -d '' link; do
    [[ -e "$link" ]] || { record_result WARNING "Broken symlink: $link"; broken=1; }
done < <(find "$HOME" -maxdepth 1 -type l -print0 2>/dev/null)

[[ $broken -eq 0 ]] && record_result PASS "No broken symlinks in \$HOME (top level)"

# --------------------------------------------------------------------------
# Permissions
# --------------------------------------------------------------------------

log_section "Permissions"

if [[ -w "$HOME" ]]; then
    record_result PASS "\$HOME is writable"
else
    record_result FAIL "\$HOME is not writable"
fi

if command_exists brew; then
    brew_prefix="$(brew --prefix)"
    if [[ -w "$brew_prefix" ]]; then
        record_result PASS "Homebrew prefix ($brew_prefix) is writable"
    else
        record_result FAIL "Homebrew prefix ($brew_prefix) is not writable"
    fi
fi

# --------------------------------------------------------------------------
# Git / SSH / GitHub
# --------------------------------------------------------------------------

log_section "Git, SSH, GitHub"

if command_exists git; then
    record_result PASS "git installed ($(git --version))"
    if git config --get user.email >/dev/null 2>&1; then
        record_result PASS "git user.email configured"
    else
        record_result WARNING "git user.email not configured"
    fi
else
    record_result FAIL "git not installed"
fi

if [[ -f "$HOME/.ssh/config" ]]; then
    record_result PASS "\$HOME/.ssh/config present"
else
    record_result WARNING "\$HOME/.ssh/config not found"
fi

if command_exists ssh-add && ssh-add -l >/dev/null 2>&1; then
    record_result PASS "ssh-agent has loaded keys"
else
    record_result WARNING "ssh-agent has no loaded keys"
fi

if command_exists gh; then
    if gh auth status >/dev/null 2>&1; then
        record_result PASS "GitHub CLI authenticated"
    else
        record_result WARNING "GitHub CLI not authenticated"
    fi
fi

# --------------------------------------------------------------------------
# Docker daemon
# --------------------------------------------------------------------------

log_section "Docker"

if command_exists docker; then
    if docker info >/dev/null 2>&1; then
        record_result PASS "Docker daemon is running"
    else
        record_result WARNING "Docker CLI installed but daemon is not running"
    fi
else
    record_result WARNING "Docker not installed"
fi

# --------------------------------------------------------------------------
# Toolchain doctors
# --------------------------------------------------------------------------

log_section "Toolchain doctors"

if command_exists brew; then
    log_step "brew doctor:"
    brew doctor || true
fi

if command_exists mise; then
    log_step "mise doctor:"
    mise doctor || true
fi

if command_exists flutter; then
    log_step "flutter doctor:"
    flutter doctor || true
fi

# --------------------------------------------------------------------------
# Service status and outdated packages
# --------------------------------------------------------------------------

log_section "Services"
service_status_all || true

log_section "Outdated Homebrew packages"
if command_exists brew; then
    outdated="$(brew outdated)"
    if [[ -z "$outdated" ]]; then
        record_result PASS "All Homebrew packages up to date"
    else
        record_result WARNING "Outdated packages present (run ./scripts/update.sh):"
        echo "$outdated"
    fi
fi

if print_summary; then
    STATUS=0
else
    STATUS=1
fi
print_health_score
exit $STATUS
