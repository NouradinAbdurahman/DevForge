#!/usr/bin/env bash
# Health check: verifies every tool this environment depends on is present
# and minimally functional. Prints PASS/WARNING/FAIL for each, in color.
# Exits non-zero if anything FAILed.
#
# Usage: ./scripts/check.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

log_section "DevForgeKit Health Check"

# check_cli <label> <binary> [version-flag]
# FAIL if the binary is entirely missing, PASS otherwise.
check_cli() {
    local label="$1" bin="$2"
    if command_exists "$bin"; then
        record_result PASS "$label"
    else
        record_result FAIL "$label (missing: $bin)"
    fi
}

# check_optional_app <label> <path>
# For GUI-only apps that aren't reliably brew-managed; missing is a WARNING.
check_optional_app() {
    local label="$1" path="$2"
    if [[ -e "$path" ]]; then
        record_result PASS "$label"
    else
        record_result WARNING "$label not found at $path"
    fi
}

# --------------------------------------------------------------------------
# Core toolchain
# --------------------------------------------------------------------------

check_cli "Homebrew" brew
check_cli "Git" git
check_cli "mise" mise
check_cli "Node" node
check_cli "npm" npm
check_cli "pnpm" pnpm
check_cli "Python" python3
check_cli "Java" java
check_cli "Docker" docker
check_cli "Flutter" flutter
check_cli "Dart" dart
check_cli "CocoaPods" pod
check_cli "Git LFS" git-lfs
check_cli "fzf" fzf
check_cli "jq" jq
check_cli "yq" yq
check_cli "SQLite" sqlite3

# --------------------------------------------------------------------------
# Cloud / infra CLIs
# --------------------------------------------------------------------------

check_cli "Supabase CLI" supabase
check_cli "Firebase CLI" firebase
check_cli "AWS CLI" aws
check_cli "Terraform" terraform
check_cli "kubectl" kubectl
check_cli "Helm" helm

# --------------------------------------------------------------------------
# Databases
# --------------------------------------------------------------------------

check_cli "PostgreSQL client" psql
check_cli "MySQL client" mysql
check_cli "Redis CLI" redis-cli

# --------------------------------------------------------------------------
# Docker Compose (subcommand, not a standalone binary)
# --------------------------------------------------------------------------

if command_exists docker && docker compose version >/dev/null 2>&1; then
    record_result PASS "Docker Compose"
elif command_exists docker; then
    record_result WARNING "Docker Compose plugin not available"
else
    record_result FAIL "Docker Compose (Docker itself missing)"
fi

# --------------------------------------------------------------------------
# Git / GitHub / SSH
# --------------------------------------------------------------------------

if git config --get user.email >/dev/null 2>&1 && git config --get user.name >/dev/null 2>&1; then
    record_result PASS "Git identity configured ($(git config --get user.name) <$(git config --get user.email)>)"
else
    record_result WARNING "Git user.name/user.email not configured"
fi

if command_exists gh; then
    if gh auth status >/dev/null 2>&1; then
        record_result PASS "GitHub CLI authenticated"
    else
        record_result WARNING "GitHub CLI installed but not authenticated (run: gh auth login)"
    fi
else
    record_result FAIL "GitHub CLI (missing: gh)"
fi

if [[ -f "$HOME/.ssh/id_ed25519" || -f "$HOME/.ssh/id_rsa" ]]; then
    record_result PASS "SSH key present"
else
    record_result WARNING "No SSH key found in ~/.ssh"
fi

# --------------------------------------------------------------------------
# Android SDK
# --------------------------------------------------------------------------

if [[ -d "${ANDROID_HOME:-$HOME/Library/Android/sdk}" ]]; then
    record_result PASS "Android SDK"
else
    record_result WARNING "Android SDK not found at \$ANDROID_HOME"
fi

# --------------------------------------------------------------------------
# DevForgeKit itself
# --------------------------------------------------------------------------

if command_exists devforgekit; then
    record_result PASS "DevForgeKit"
else
    record_result WARNING "DevForgeKit CLI not on PATH (run ./bootstrap.sh to install the global command)"
fi

# --------------------------------------------------------------------------
# GUI applications (not reliably brew-managed / not on PATH)
# --------------------------------------------------------------------------

check_optional_app "VS Code" "/Applications/Visual Studio Code.app"
check_optional_app "Cursor" "/Applications/Cursor.app"
check_optional_app "Android Studio" "/Applications/Android Studio.app"
check_optional_app "Xcode" "/Applications/Xcode.app"

# --------------------------------------------------------------------------
# Services
# --------------------------------------------------------------------------

log_section "Services"
service_verify_all || true

if print_summary; then
    STATUS=0
else
    STATUS=1
fi
print_health_score
exit $STATUS
