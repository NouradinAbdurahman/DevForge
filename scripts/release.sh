#!/usr/bin/env bash
# Cuts a new release: bumps VERSION (semver), drafts a CHANGELOG entry from
# the commits since the last tag, commits, tags, and pushes. Pushing the tag
# is what actually publishes the GitHub release - .github/workflows/release.yml
# already builds release notes and attaches assets when a v*.*.* tag lands,
# so this script deliberately doesn't duplicate that logic.
#
# Usage: ./scripts/release.sh <patch|minor|major> [-y|--yes]
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

usage() {
    echo "Usage: $0 <patch|minor|major> [-y|--yes]"
    exit 1
}

BUMP=""
for arg in "$@"; do
    case "$arg" in
        patch|minor|major) BUMP="$arg" ;;
        -y|--yes) export DEV_SETUP_ASSUME_YES=1 ;;
        *) usage ;;
    esac
done
[[ -n "$BUMP" ]] || usage

cd "$DEV_SETUP_ROOT"

# --------------------------------------------------------------------------
# Preflight - abort (don't just warn) if any of these fail
# --------------------------------------------------------------------------

log_section "Preflight"

if [[ -n "$(git status --porcelain)" ]]; then
    log_error "Working tree is not clean. Commit or stash your changes before releasing."
    git status --short
    exit 1
fi
log_success "Working tree is clean"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
    log_warn "You are on branch '$CURRENT_BRANCH', not 'main'."
    if ! confirm "Continue releasing from '$CURRENT_BRANCH'?"; then
        exit 1
    fi
fi

log_step "Running scripts/validate.sh (shell syntax, ShellCheck, Brewfile, mise.toml, JSON, Markdown)..."
if ! "$DEV_SETUP_ROOT/scripts/validate.sh"; then
    log_error "validate.sh failed - fix the issues above before releasing."
    exit 1
fi
log_success "validate.sh passed"

log_step "Running bootstrap.sh --dry-run (bootstrap validation)..."
if ! "$DEV_SETUP_ROOT/bootstrap.sh" --dry-run --yes; then
    log_error "bootstrap.sh --dry-run failed - fix the issues above before releasing."
    exit 1
fi
log_success "bootstrap.sh --dry-run passed"

HEAD_SHA="$(git rev-parse HEAD)"
if command_exists gh && gh auth status >/dev/null 2>&1; then
    log_step "Checking CI status for $HEAD_SHA..."
    CI_CONCLUSIONS="$(gh run list --commit "$HEAD_SHA" --limit 20 --json conclusion --jq '.[].conclusion' 2>/dev/null || true)"
    if echo "$CI_CONCLUSIONS" | grep -qx "failure"; then
        log_error "At least one GitHub Actions run for $HEAD_SHA failed. Fix CI before releasing."
        exit 1
    elif [[ -z "$CI_CONCLUSIONS" ]]; then
        log_warn "No GitHub Actions runs found yet for $HEAD_SHA (may not have finished triggering)."
    else
        log_success "No failed GitHub Actions runs for $HEAD_SHA"
    fi
else
    log_warn "gh CLI not available/authenticated - skipping remote CI status check"
fi

# --------------------------------------------------------------------------
# Version bump
# --------------------------------------------------------------------------

log_section "Version bump ($BUMP)"

CURRENT_VERSION="$(tr -d '[:space:]' < VERSION)"
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case "$BUMP" in
    major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
    patch) PATCH=$((PATCH + 1)) ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
log_info "Current version: $CURRENT_VERSION"
log_info "New version:     $NEW_VERSION"

# --------------------------------------------------------------------------
# Draft CHANGELOG entry from commits since the last tag
# --------------------------------------------------------------------------

log_section "Changelog"

LAST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
if [[ -n "$LAST_TAG" ]]; then
    COMMIT_LIST="$(git log "$LAST_TAG"..HEAD --no-merges --pretty=format:'- %s')"
else
    COMMIT_LIST="$(git log --no-merges --pretty=format:'- %s')"
fi

if [[ -z "$COMMIT_LIST" ]]; then
    COMMIT_LIST="- No user-facing changes recorded."
fi

RELEASE_DATE="$(date +%Y-%m-%d)"
ENTRY_FILE="$(mktemp)"
{
    echo "## [$NEW_VERSION] - $RELEASE_DATE"
    echo
    echo "### Changed"
    echo
    echo "$COMMIT_LIST"
} > "$ENTRY_FILE"

echo
cat "$ENTRY_FILE"
echo

if ! confirm "Insert this section into CHANGELOG.md and continue with the release?"; then
    log_info "Aborted - CHANGELOG.md was not modified."
    rm -f "$ENTRY_FILE"
    exit 1
fi

# Insert the new entry right after the header/preamble, before the first
# existing "## [" section (or at the end of the file if there is none yet).
NEW_CHANGELOG="$(mktemp)"
awk -v entryfile="$ENTRY_FILE" '
    BEGIN { inserted = 0 }
    /^## \[/ && !inserted {
        while ((getline line < entryfile) > 0) print line
        print ""
        inserted = 1
    }
    { print }
    END {
        if (!inserted) {
            while ((getline line < entryfile) > 0) print line
        }
    }
' CHANGELOG.md > "$NEW_CHANGELOG"
mv "$NEW_CHANGELOG" CHANGELOG.md
rm -f "$ENTRY_FILE"

log_success "CHANGELOG.md updated"

# --------------------------------------------------------------------------
# VERSION, commit, tag, push
# --------------------------------------------------------------------------

log_section "Committing and tagging v$NEW_VERSION"

echo "$NEW_VERSION" > VERSION

git add VERSION CHANGELOG.md
git commit -m "chore(release): v$NEW_VERSION"
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"

if confirm "Push commit and tag v$NEW_VERSION to origin?"; then
    git push origin "$CURRENT_BRANCH"
    git push origin "v$NEW_VERSION"
    log_success "Pushed v$NEW_VERSION - the Release workflow will now build and publish the GitHub release."
else
    log_info "Commit and tag created locally but not pushed. Push manually when ready:"
    log_info "  git push origin $CURRENT_BRANCH && git push origin v$NEW_VERSION"
fi
