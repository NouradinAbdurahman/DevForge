#!/usr/bin/env bash
# Bash-side fixes for `devforgekit repair install` (cli/src/core/repair.js's
# "CLI install" scanner) - the Node CLI shells back into Layer 1 for these,
# the same pattern core/recipes.js's runConfigureStep already uses, rather
# than reimplementing install_global_command/ensure_cli_dependencies/
# install_brewfile_per_line in JS.
#
# Usage: ./scripts/repair_install.sh <symlink|deps|packages>
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

usage() {
    echo "Usage: $0 <symlink|deps|packages>" >&2
    exit 1
}

[[ $# -eq 1 ]] || usage

case "$1" in
    symlink)
        install_global_command
        ;;
    deps)
        ensure_cli_dependencies
        ;;
    packages)
        failed_lines="$(install_state_failed_lines)"
        if [[ -z "$failed_lines" ]]; then
            log_info "No failed packages recorded in install-state.json - nothing to retry."
            exit 0
        fi
        tmp_brewfile="$(mktemp -t devforgekit-repair-install.XXXXXX)"
        printf '%s\n' "$failed_lines" > "$tmp_brewfile"
        install_brewfile_per_line "$tmp_brewfile"
        rm -f "$tmp_brewfile"
        # install_brewfile_per_line never fails hard (it tracks pass/fail
        # in STEP_RESULTS/INSTALL_FAILED and always returns 0) - report a
        # real, checkable exit code here so the calling repair action
        # knows whether this specific retry actually succeeded.
        [[ ${#INSTALL_FAILED[@]} -eq 0 ]]
        ;;
    *)
        usage
        ;;
esac
