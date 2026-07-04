#!/usr/bin/env bash
# Lists, shows, and selects install profiles (subsets of Brewfile under
# profiles/) used by bootstrap.sh / scripts/install.sh.
#
# Usage: ./scripts/profile.sh <list|show|use> [name]
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

PROFILES_DIR="$DEV_SETUP_ROOT/profiles"

usage() {
    echo "Usage: ./devforgekit profile <list|show|use> [name]"
    exit 1
}

[[ $# -ge 1 ]] || usage

case "$1" in
    list)
        log_section "DevForgeKit Profiles"
        printf '%-9s - %s\n' "full" "everything in Brewfile (default)"
        for dir in "$PROFILES_DIR"/*/; do
            [[ -d "$dir" ]] || continue
            name="$(basename "$dir")"
            [[ "$name" == "full" ]] && continue
            desc="$(sed -n '1s/^# *//p' "$dir/README.md" 2>/dev/null)"
            printf '%-9s - %s\n' "$name" "${desc:-no description}"
        done
        echo
        echo "Current default: $(resolve_profile "")"
        echo "Switch with: ./devforgekit profile use <name>"
        ;;
    show)
        [[ $# -eq 2 ]] || { echo "Usage: ./devforgekit profile show <name>"; exit 1; }
        bf="$(profile_brewfile_path "$2")"
        if [[ ! -f "$bf" ]]; then
            log_error "Unknown profile '$2' - run './devforgekit profile list' to see available profiles"
            exit 1
        fi
        log_section "Profile: $2 ($bf)"
        cat "$bf"
        ;;
    use)
        [[ $# -eq 2 ]] || { echo "Usage: ./devforgekit profile use <name>"; exit 1; }
        bf="$(profile_brewfile_path "$2")"
        if [[ ! -f "$bf" ]]; then
            log_error "Unknown profile '$2' - run './devforgekit profile list' to see available profiles"
            exit 1
        fi
        echo "$2" > "$PROFILE_STATE_FILE"
        log_success "Default profile set to '$2'."
        log_info "Future ./bootstrap.sh / ./devforgekit install runs use it unless overridden with --profile/--minimal/--full."
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        usage
        ;;
esac
