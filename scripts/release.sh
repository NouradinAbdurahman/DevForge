#!/usr/bin/env bash
# Two-phase release process, redesigned to be branch-protection compatible:
# this repo's own ruleset requires every change to main go through a PR,
# with no bypass actors - so the release process has to go through one too,
# rather than assuming it can push a release commit directly (confirmed
# live: the original single-phase design hit exactly this rejection
# cutting v3.0.0-rc1 - "Changes must be made through a pull request").
#
# Phase 1 - create (this script's <patch|minor|major|rc|promote> mode):
#   bump VERSION, update CHANGELOG.md, commit on a new release/vX.Y.Z
#   branch, push it, open a PR. Does NOT tag anything - a tag must only
#   ever point at a commit that's actually on main.
#
# Phase 2 - finalize (this script's `finalize` mode), run once the
#   release PR above has been reviewed and merged:
#   verify the merge really landed (via `gh pr view`, not guessed),
#   verify main's VERSION/CHANGELOG really match what create staged,
#   tag the merge commit, push *only* the tag (never main - main was
#   already updated by the PR merge itself), wait for the release
#   workflow, verify the resulting GitHub Release exists as a draft.
#
# A small state file (.devforgekit-release-state.json, gitignored)
# records what create started, so finalize knows exactly which PR/
# version/CHANGELOG heading to verify against - and so both halves are
# restartable: re-running create refuses to clobber a release already
# in progress; re-running finalize after it already tagged and verified
# picks up from wherever it actually got to (checked against real
# GitHub/git state each time, never assumed from the state file alone).
#
# Usage:
#   ./scripts/release.sh <patch|minor|major|rc|promote> [-y|--yes]
#   ./scripts/release.sh finalize [-y|--yes]
#
#   patch|minor|major  Normal semver bump. Drafts a new, auto-generated
#                       CHANGELOG section from `git log` since the last tag.
#   rc                  Cuts a release candidate of the *current* VERSION -
#                       v3.0.0 -> v3.0.0-rc1 -> v3.0.0-rc2, no MAJOR/MINOR/
#                       PATCH bump. Renames the existing "## [Unreleased]"
#                       CHANGELOG section to the new versioned heading
#                       (preserving its hand-written content) instead of
#                       auto-generating a new one, and adds a fresh empty
#                       "## [Unreleased]" above it.
#   promote             Strips the -rcN suffix from the current version
#                       (v3.0.0-rc3 -> v3.0.0) for the final release. Same
#                       CHANGELOG rename behavior as `rc`.
#   finalize             Phase 2 - tag the merged release PR and wait for
#                       the release workflow. See above.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

usage() {
    echo "Usage: $0 <patch|minor|major|rc|promote|finalize> [-y|--yes]"
    exit 1
}

MODE=""
for arg in "$@"; do
    case "$arg" in
        patch|minor|major|rc|promote|finalize) MODE="$arg" ;;
        -y|--yes) export DEV_SETUP_ASSUME_YES=1 ;;
        *) usage ;;
    esac
done
[[ -n "$MODE" ]] || usage

cd "$DEV_SETUP_ROOT"

RELEASE_STATE_FILE="$DEV_SETUP_ROOT/.devforgekit-release-state.json"

require_gh() {
    if ! command_exists gh; then
        log_error "gh CLI is required for '$MODE' but is not installed."
        exit 1
    fi
    if ! gh auth status >/dev/null 2>&1; then
        log_error "gh CLI is not authenticated (run 'gh auth login') - required for '$MODE'."
        exit 1
    fi
}

require_jq() {
    if ! command_exists jq; then
        log_error "jq is required to read/write $RELEASE_STATE_FILE but is not installed."
        exit 1
    fi
}

# --------------------------------------------------------------------------
# Phase 1: create
# --------------------------------------------------------------------------

run_create() {
    local bump="$1"
    require_gh
    require_jq

    log_section "DevForgeKit Release - Create ($bump)"

    if [[ -f "$RELEASE_STATE_FILE" ]]; then
        local existing_version existing_pr existing_stage
        existing_version="$(jq -r .version "$RELEASE_STATE_FILE")"
        existing_pr="$(jq -r .prNumber "$RELEASE_STATE_FILE")"
        existing_stage="$(jq -r .stage "$RELEASE_STATE_FILE")"
        log_error "A release is already pending: v$existing_version (PR #$existing_pr, stage: $existing_stage)."
        log_error "Finish it with '$0 finalize' once that PR is merged, or remove $RELEASE_STATE_FILE if it's stale (e.g. the PR was closed without merging)."
        exit 1
    fi

    log_section "Preflight"

    if [[ -n "$(git status --porcelain)" ]]; then
        log_error "Working tree is not clean. Commit or stash your changes before releasing."
        git status --short
        exit 1
    fi
    log_success "Working tree is clean"

    CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
    if [[ "$CURRENT_BRANCH" == "HEAD" ]]; then
        log_error "Detached HEAD - checkout 'main' before releasing."
        exit 1
    fi
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

    log_section "Version bump ($bump)"

    CURRENT_VERSION="$(tr -d '[:space:]' < VERSION)"
    BASE_VERSION="${CURRENT_VERSION%%-*}"
    CURRENT_SUFFIX="${CURRENT_VERSION#"$BASE_VERSION"}"

    case "$bump" in
        major|minor|patch)
            if [[ -n "$CURRENT_SUFFIX" ]]; then
                log_error "Current version $CURRENT_VERSION is a pre-release. Run '$0 promote' to finish it, or '$0 rc' to continue the RC cycle."
                exit 1
            fi
            IFS='.' read -r MAJOR MINOR PATCH <<< "$BASE_VERSION"
            case "$bump" in
                major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
                minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
                patch) PATCH=$((PATCH + 1)) ;;
            esac
            NEW_VERSION="$MAJOR.$MINOR.$PATCH"
            ;;
        rc)
            if [[ "$CURRENT_SUFFIX" =~ ^-rc([0-9]+)$ ]]; then
                NEXT_RC=$(( BASH_REMATCH[1] + 1 ))
            else
                NEXT_RC=1
            fi
            NEW_VERSION="${BASE_VERSION}-rc${NEXT_RC}"
            ;;
        promote)
            if [[ -z "$CURRENT_SUFFIX" ]]; then
                log_error "Current version $CURRENT_VERSION is not a pre-release - nothing to promote."
                exit 1
            fi
            NEW_VERSION="$BASE_VERSION"
            ;;
    esac

    log_info "Current version: $CURRENT_VERSION"
    log_info "New version:     $NEW_VERSION"

    RELEASE_BRANCH="release/v$NEW_VERSION"
    if git show-ref --verify --quiet "refs/heads/$RELEASE_BRANCH" || git ls-remote --exit-code --heads origin "$RELEASE_BRANCH" >/dev/null 2>&1; then
        log_error "Branch $RELEASE_BRANCH already exists - a release for v$NEW_VERSION may already be in progress (locally or on origin)."
        exit 1
    fi
    if git ls-remote --exit-code --tags origin "refs/tags/v$NEW_VERSION" >/dev/null 2>&1; then
        log_error "Tag v$NEW_VERSION already exists on origin - refusing to start a duplicate release."
        exit 1
    fi

    log_section "Changelog"

    RELEASE_DATE="$(date +%Y-%m-%d)"
    CHANGELOG_HEADING="## [$NEW_VERSION] - $RELEASE_DATE"

    if [[ "$bump" == "rc" || "$bump" == "promote" ]]; then
        # rc/promote: rename the existing "## [Unreleased]" heading to the
        # new versioned one, preserving whatever's hand-written underneath
        # it, rather than discarding it in favor of an auto-generated
        # git-log dump. `rc` also adds a fresh empty "## [Unreleased]"
        # above it for whatever comes next; `promote` does not.
        if ! grep -q "^## \[Unreleased\]" CHANGELOG.md; then
            log_error "No '## [Unreleased]' section found in CHANGELOG.md - nothing to promote to v$NEW_VERSION."
            exit 1
        fi

        echo
        log_info "This will rename '## [Unreleased]' to '$CHANGELOG_HEADING' in place."
        if [[ "$bump" == "rc" ]]; then
            log_info "A fresh, empty '## [Unreleased]' will be added above it."
        fi

        if ! confirm "Update CHANGELOG.md and continue with the release?"; then
            log_info "Aborted - CHANGELOG.md was not modified."
            exit 1
        fi

        NEW_CHANGELOG="$(mktemp)"
        awk -v newheading="$CHANGELOG_HEADING" -v addunreleased="$([[ "$bump" == "rc" ]] && echo 1 || echo 0)" '
            BEGIN { renamed = 0 }
            /^## \[Unreleased\]/ && !renamed {
                if (addunreleased == 1) { print "## [Unreleased]"; print "" }
                print newheading
                renamed = 1
                next
            }
            { print }
        ' CHANGELOG.md > "$NEW_CHANGELOG"
        mv "$NEW_CHANGELOG" CHANGELOG.md
    else
        # patch/minor/major: auto-generate a new section from commits since
        # the last tag - there's no hand-written "Unreleased" entry to
        # expect for a routine bump like this.
        LAST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
        if [[ -n "$LAST_TAG" ]]; then
            COMMIT_LIST="$(git log "$LAST_TAG"..HEAD --no-merges --pretty=format:'- %s')"
        else
            COMMIT_LIST="$(git log --no-merges --pretty=format:'- %s')"
        fi

        if [[ -z "$COMMIT_LIST" ]]; then
            COMMIT_LIST="- No user-facing changes recorded."
        fi

        ENTRY_FILE="$(mktemp)"
        {
            echo "$CHANGELOG_HEADING"
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
    fi

    log_success "CHANGELOG.md updated"

    log_section "Creating the release branch"

    git checkout -b "$RELEASE_BRANCH"
    echo "$NEW_VERSION" > VERSION
    git add VERSION CHANGELOG.md
    git commit -m "chore(release): v$NEW_VERSION"
    RELEASE_SHA="$(git rev-parse HEAD)"
    log_success "Committed on $RELEASE_BRANCH ($RELEASE_SHA)"

    if ! confirm "Push $RELEASE_BRANCH and open a release PR?"; then
        log_info "Branch and commit created locally but not pushed. Push manually when ready:"
        log_info "  git push -u origin $RELEASE_BRANCH"
        log_info "Then open a PR and run '$0 finalize' once it's merged."
        git checkout "$CURRENT_BRANCH"
        exit 0
    fi

    git push -u origin "$RELEASE_BRANCH"

    PR_URL="$(gh pr create \
        --title "chore(release): v$NEW_VERSION" \
        --body "Release preparation for v$NEW_VERSION - bumps VERSION and updates CHANGELOG.md. No code changes. Once merged, run \`scripts/release.sh finalize\` to tag the merge commit and publish a draft GitHub Release." \
        --head "$RELEASE_BRANCH")"
    PR_NUMBER="$(gh pr view "$RELEASE_BRANCH" --json number --jq .number)"

    jq -n \
        --arg version "$NEW_VERSION" \
        --arg bump "$bump" \
        --arg branch "$RELEASE_BRANCH" \
        --arg branchSha "$RELEASE_SHA" \
        --arg heading "$CHANGELOG_HEADING" \
        --argjson prNumber "$PR_NUMBER" \
        --arg stage "pr-open" \
        --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '{version:$version, bump:$bump, releaseBranch:$branch, releaseBranchSha:$branchSha, changelogHeading:$heading, prNumber:$prNumber, stage:$stage, createdAt:$createdAt}' \
        > "$RELEASE_STATE_FILE"

    log_success "Opened PR #$PR_NUMBER: $PR_URL"
    log_info "Once it's reviewed, CI is green, and it's merged, run:"
    log_info "  $0 finalize"

    git checkout "$CURRENT_BRANCH"
}

# --------------------------------------------------------------------------
# Phase 2: finalize
# --------------------------------------------------------------------------

wait_for_release_workflow() {
    local tag="$1" run_id="" attempts=0
    log_step "Waiting for the release workflow triggered by $tag..."
    while [[ -z "$run_id" && $attempts -lt 30 ]]; do
        run_id="$(gh run list --workflow=release.yml --branch "$tag" --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)"
        [[ -n "$run_id" ]] && break
        attempts=$((attempts + 1))
        sleep 10
    done
    if [[ -z "$run_id" ]]; then
        log_warn "No release workflow run found for $tag after 5 minutes - check the Actions tab manually."
        return 0
    fi
    log_info "Watching run $run_id..."
    if gh run watch "$run_id" --exit-status; then
        log_success "Release workflow completed successfully"
    else
        log_error "Release workflow failed for $tag - check the run before proceeding."
        exit 1
    fi
}

verify_draft_release() {
    local tag="$1"
    log_step "Verifying the draft GitHub Release for $tag..."
    local is_draft
    is_draft="$(gh release view "$tag" --json isDraft --jq .isDraft 2>/dev/null || echo "")"
    if [[ "$is_draft" != "true" ]]; then
        log_error "Release $tag is not a draft (or doesn't exist yet) - expected isDraft: true. Check manually before publishing anything."
        exit 1
    fi
    log_success "$tag exists as a draft release - not published"
}

run_finalize() {
    require_gh
    require_jq

    log_section "DevForgeKit Release - Finalize"

    if [[ ! -f "$RELEASE_STATE_FILE" ]]; then
        log_error "No pending release found ($RELEASE_STATE_FILE missing)."
        log_error "Run '$0 <patch|minor|major|rc|promote>' first."
        exit 1
    fi

    local version bump pr_number heading stage
    version="$(jq -r .version "$RELEASE_STATE_FILE")"
    bump="$(jq -r .bump "$RELEASE_STATE_FILE")"
    pr_number="$(jq -r .prNumber "$RELEASE_STATE_FILE")"
    heading="$(jq -r .changelogHeading "$RELEASE_STATE_FILE")"
    stage="$(jq -r .stage "$RELEASE_STATE_FILE")"
    TAG="v$version"

    log_info "Pending release: $TAG (bump: $bump, PR #$pr_number, stage: $stage)"

    # Restartable: if the tag already exists on origin, the merge+tag steps
    # already happened on a prior run - re-verifying PR state would be
    # redundant (the tag existing IS proof) and re-running preflight
    # would fail anyway (we'd no longer be "ahead" of the tagged commit).
    # Jump straight to workflow/draft verification.
    if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
        log_info "$TAG already exists on origin - skipping merge/tag steps."
        wait_for_release_workflow "$TAG"
        verify_draft_release "$TAG"
        rm -f "$RELEASE_STATE_FILE"
        log_success "$TAG finalized."
        return 0
    fi

    PR_STATE="$(gh pr view "$pr_number" --json state --jq .state)"
    if [[ "$PR_STATE" != "MERGED" ]]; then
        log_error "PR #$pr_number is not merged yet (state: $PR_STATE)."
        log_info "Merge it, then re-run '$0 finalize'."
        exit 1
    fi
    log_success "PR #$pr_number is merged"

    CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
    if [[ "$CURRENT_BRANCH" != "main" ]]; then
        git checkout main
    fi

    git fetch origin main --quiet
    if ! git merge --ff-only origin/main; then
        log_error "Local main has diverged from origin/main in a way that can't be fast-forwarded. Resolve manually, then re-run '$0 finalize'."
        exit 1
    fi

    if [[ -n "$(git status --porcelain)" ]]; then
        log_error "Working tree is not clean after syncing main."
        git status --short
        exit 1
    fi

    CURRENT_VERSION="$(tr -d '[:space:]' < VERSION)"
    if [[ "$CURRENT_VERSION" != "$version" ]]; then
        log_error "VERSION on main is '$CURRENT_VERSION', expected '$version' - refusing to tag. Was PR #$pr_number really the release PR, and is main up to date?"
        exit 1
    fi
    if ! grep -qF "$heading" CHANGELOG.md; then
        log_error "CHANGELOG.md does not contain the expected heading '$heading' - refusing to tag."
        exit 1
    fi
    log_success "main ($(git rev-parse --short HEAD)) matches the expected $TAG release"

    if ! confirm "Tag $(git rev-parse --short HEAD) as $TAG and push the tag (main itself is not pushed - it's already up to date)?"; then
        log_info "Aborted - nothing tagged or pushed. Re-run '$0 finalize' when ready."
        exit 1
    fi

    git tag -a "$TAG" -m "DevForgeKit $TAG"
    git push origin "$TAG"
    log_success "Pushed $TAG"

    wait_for_release_workflow "$TAG"
    verify_draft_release "$TAG"

    rm -f "$RELEASE_STATE_FILE"
    log_success "$TAG finalized - draft release ready for review. Publishing is a separate, manual step: gh release edit $TAG --draft=false"
}

# --------------------------------------------------------------------------

if [[ "$MODE" == "finalize" ]]; then
    run_finalize
else
    run_create "$MODE"
fi
