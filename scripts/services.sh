#!/usr/bin/env bash
# Start, stop, restart, or check the status of the local dev services
# (PostgreSQL, MySQL, Redis) managed by Homebrew.
#
# Usage: ./scripts/services.sh <start|stop|restart|status>
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

usage() {
    echo "Usage: $0 <start|stop|restart|status>"
    exit 1
}

[[ $# -eq 1 ]] || usage

if ! command_exists brew; then
    log_error "Homebrew is required to manage services"
    exit 1
fi

case "$1" in
    start)
        log_section "DevForgeKit Services: Start"
        service_start_all
        sleep 2
        service_verify_all
        ;;
    stop)
        log_section "DevForgeKit Services: Stop"
        service_stop_all
        ;;
    restart)
        log_section "DevForgeKit Services: Restart"
        service_restart_all
        sleep 2
        service_verify_all
        ;;
    status)
        log_section "DevForgeKit Services: Status"
        service_status_all || true
        echo
        service_verify_all
        ;;
    *)
        usage
        ;;
esac
