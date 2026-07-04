#!/usr/bin/env bash
# Generates reports/system-report.txt: a timestamped snapshot of the
# machine's OS, hardware, installed tool versions, service state, and
# git/Flutter/Docker status. Used standalone and by bootstrap.sh.
#
# Usage: ./scripts/report.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

fs_ensure_dir "$REPORTS_DIR"
REPORT_FILE="$REPORTS_DIR/system-report.txt"

version_of() {
    local bin="$1"
    if command_exists "$bin"; then
        "$@" 2>&1 | head -n1
    else
        echo "not installed"
    fi
}

{
    echo "==========================================="
    echo "dev-setup system report"
    echo "Generated: $(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "==========================================="
    echo

    echo "--- OS ---"
    echo "macOS version : $(os_macos_version)"
    echo "Architecture  : $(os_arch)"
    echo "Hostname      : $(hostname)"
    echo

    echo "--- CPU ---"
    sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "unknown"
    echo "Cores: $(sysctl -n hw.ncpu 2>/dev/null || echo unknown)"
    echo

    echo "--- Memory ---"
    mem_bytes="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
    echo "Total RAM: $((mem_bytes / 1024 / 1024 / 1024)) GB"
    echo

    echo "--- Disk ---"
    df -h "$HOME"
    echo

    echo "--- Installed tools ---"
    printf '%-16s %s\n' "git"      "$(version_of git --version)"
    printf '%-16s %s\n' "brew"     "$(version_of brew --version)"
    printf '%-16s %s\n' "mise"     "$(version_of mise --version)"
    printf '%-16s %s\n' "node"     "$(version_of node -v)"
    printf '%-16s %s\n' "pnpm"     "$(version_of pnpm -v)"
    printf '%-16s %s\n' "python3"  "$(version_of python3 --version)"
    printf '%-16s %s\n' "java"     "$(version_of java -version)"
    printf '%-16s %s\n' "flutter"  "$(version_of flutter --version)"
    printf '%-16s %s\n' "docker"   "$(version_of docker --version)"
    printf '%-16s %s\n' "psql"     "$(version_of psql --version)"
    printf '%-16s %s\n' "mysql"    "$(version_of mysql --version)"
    printf '%-16s %s\n' "redis"    "$(version_of redis-server --version)"
    printf '%-16s %s\n' "supabase" "$(version_of supabase --version)"
    printf '%-16s %s\n' "firebase" "$(version_of firebase --version)"
    printf '%-16s %s\n' "aws"      "$(version_of aws --version)"
    printf '%-16s %s\n' "terraform" "$(version_of terraform version)"
    printf '%-16s %s\n' "kubectl"  "$(version_of kubectl version --client)"
    printf '%-16s %s\n' "helm"     "$(version_of helm version)"
    echo

    echo "--- Services ---"
    service_status_all 2>&1 || echo "unavailable"
    echo

    echo "--- Git status (this repo) ---"
    git -C "$DEV_SETUP_ROOT" status --short --branch 2>&1 || echo "not a git repo"
    echo

    echo "--- Flutter status ---"
    if command_exists flutter; then
        flutter doctor --machine 2>/dev/null | jq -r '.[] | "\(.category): \(.status // "unknown")"' 2>/dev/null \
            || flutter doctor 2>&1
    else
        echo "flutter not installed"
    fi
    echo

    echo "--- Docker status ---"
    if command_exists docker; then
        docker info --format 'Server Version: {{.ServerVersion}}, Containers: {{.Containers}}, Images: {{.Images}}' 2>&1 \
            || echo "Docker daemon not running"
    else
        echo "docker not installed"
    fi
    echo

    echo "==========================================="
    echo "End of report"
    echo "==========================================="
} > "$REPORT_FILE"

log_success "Report written to $REPORT_FILE"
