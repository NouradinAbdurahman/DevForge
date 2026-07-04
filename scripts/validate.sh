#!/usr/bin/env bash
# Static validation of everything in this repo: shell syntax, ShellCheck,
# Brewfile, mise.toml, JSON, YAML, and Markdown. Used locally and in CI
# (.github/workflows/shellcheck.yml, lint.yml).
#
# Usage: ./scripts/validate.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

log_section "Validating repository"

# --------------------------------------------------------------------------
# Shell syntax
# --------------------------------------------------------------------------

log_section "Shell syntax (bash -n)"

while IFS= read -r -d '' script; do
    run_step "Syntax: ${script#"$DEV_SETUP_ROOT"/}" bash -n "$script"
done < <(find "$DEV_SETUP_ROOT" \( -name "*.sh" \) -not -path "*/node_modules/*" -not -path "*/.git/*" -print0)

# --------------------------------------------------------------------------
# ShellCheck
# --------------------------------------------------------------------------

log_section "ShellCheck"

if command_exists shellcheck; then
    while IFS= read -r -d '' script; do
        run_step "ShellCheck: ${script#"$DEV_SETUP_ROOT"/}" shellcheck -x "$script"
    done < <(find "$DEV_SETUP_ROOT" \( -name "*.sh" \) -not -path "*/node_modules/*" -not -path "*/.git/*" -print0)
else
    log_warn "shellcheck not installed (brew install shellcheck) - skipping"
fi

# --------------------------------------------------------------------------
# Brewfile
# --------------------------------------------------------------------------

log_section "Brewfile"

if command_exists brew; then
    run_step_optional "brew bundle check" brew bundle check --file="$DEV_SETUP_ROOT/Brewfile" --no-upgrade
else
    log_warn "Homebrew not installed - skipping Brewfile check"
fi

# --------------------------------------------------------------------------
# mise.toml
# --------------------------------------------------------------------------

log_section "mise.toml"

if command_exists yq; then
    run_step "mise.toml is valid TOML" yq -p toml -o json '.' "$DEV_SETUP_ROOT/mise.toml"
else
    log_warn "yq not installed - skipping mise.toml TOML validation"
fi

if command_exists mise; then
    run_step "mise recognizes mise.toml" mise config ls -C "$DEV_SETUP_ROOT"
else
    log_warn "mise not installed - skipping mise config check"
fi

# --------------------------------------------------------------------------
# JSON files
# --------------------------------------------------------------------------

log_section "JSON files"

while IFS= read -r -d '' file; do
    run_step "JSON: ${file#"$DEV_SETUP_ROOT"/}" jq empty "$file"
done < <(find "$DEV_SETUP_ROOT" -name "*.json" -not -path "*/node_modules/*" -not -path "*/.git/*" -print0)

# --------------------------------------------------------------------------
# YAML files (GitHub workflows, dependabot.yml, docker-compose templates...)
# --------------------------------------------------------------------------

log_section "YAML files"

# shellcheck disable=SC2329 # invoked indirectly via run_step "$@"
_yq_validate() { yq eval '.' "$1" > /dev/null; }

if command_exists yq; then
    while IFS= read -r -d '' file; do
        run_step "YAML: ${file#"$DEV_SETUP_ROOT"/}" _yq_validate "$file"
    done < <(find "$DEV_SETUP_ROOT" \( -name "*.yml" -o -name "*.yaml" \) -not -path "*/node_modules/*" -not -path "*/.git/*" -print0)
else
    log_warn "yq not installed - skipping YAML validation"
fi

# --------------------------------------------------------------------------
# Markdown files (best effort - only if a linter is available)
# --------------------------------------------------------------------------

log_section "Markdown files"

if command_exists markdownlint; then
    while IFS= read -r -d '' file; do
        run_step_optional "Markdown: ${file#"$DEV_SETUP_ROOT"/}" markdownlint "$file"
    done < <(find "$DEV_SETUP_ROOT" -name "*.md" -not -path "*/node_modules/*" -not -path "*/.git/*" -print0)
else
    log_warn "markdownlint not installed - skipping Markdown lint (structure only)"
    while IFS= read -r -d '' file; do
        if [[ -s "$file" ]]; then
            record_result PASS "Markdown non-empty: ${file#"$DEV_SETUP_ROOT"/}"
        else
            record_result WARNING "Markdown empty: ${file#"$DEV_SETUP_ROOT"/}"
        fi
    done < <(find "$DEV_SETUP_ROOT" -name "*.md" -not -path "*/node_modules/*" -not -path "*/.git/*" -print0)
fi

if print_summary; then
    exit 0
else
    exit 1
fi
