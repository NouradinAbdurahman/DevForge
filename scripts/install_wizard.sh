#!/usr/bin/env bash
# Interactive first-run install wizard for bootstrap.sh: lets a new user
# pick Minimal/Recommended/Full/Custom instead of silently getting the
# full package set, and gates VS Code/Cursor extension installs and
# service startup behind explicit opt-in. Sourced by bootstrap.sh, never
# executed directly - depends on common.sh already being sourced
# (DEV_SETUP_ROOT, profile_brewfile_path, SERVICE_LIST, log_*, etc).
#
# Globals this module sets for bootstrap.sh to read after calling
# wizard_run:
#   WIZARD_BREWFILE_PATH  - resolved Brewfile to install from
#   WIZARD_PROFILE_LABEL  - human label for logging/summary
#   SKIP_EDITOR_EXTENSIONS - "1" to skip VS Code/Cursor extension installs
#   WIZARD_SERVICES_MODE  - "all" | "none" | "choose"
#   WIZARD_SERVICE_LIST   - space-separated subset of SERVICE_LIST
#                            (only meaningful when WIZARD_SERVICES_MODE=choose)

BREWFILE_CATEGORIES_FILE="$DEV_SETUP_ROOT/profiles/generated/brewfile-categories.txt"

# wizard_should_run - true only on a first-ever, fully interactive install
# with no explicit profile choice already made. Mirrors confirm()'s own
# tty/assume-yes gate (see common.sh) so non-interactive/CI/--yes usage is
# completely unaffected.
wizard_should_run() {
    [[ -z "${PROFILE_ARG:-}" ]] || return 1
    [[ ! -f "$PROFILE_STATE_FILE" ]] || return 1
    [[ -t 0 ]] || return 1
    [[ "${DEV_SETUP_ASSUME_YES:-0}" != "1" ]] || return 1
    return 0
}

# --------------------------------------------------------------------------
# Package size estimation - real download sizes, never fabricated
# --------------------------------------------------------------------------
#
# `brew info --json=v2` has no `size` field for either formulae or casks
# (verified live against the real API - bottle file entries only carry
# cellar/url/sha256). What DOES give a real number: a HEAD request against
# the bottle/cask download URL that same JSON provides, reading
# Content-Length - verified live for both a formula bottle (GHCR blob URL,
# needs `Authorization: Bearer QQ==` for anonymous pull - a known
# Homebrew-community trick) and a cask (its vendor .dmg/.pkg URL, no auth
# needed). This costs one network round-trip per package, so results are
# cached for the duration of one wizard run (WIZARD_SIZE_CACHE_FILE)
# rather than re-measured every time the Custom checklist redraws or the
# preview is shown.

WIZARD_SIZE_CACHE_FILE=""

# _wizard_human_bytes <bytes> -> "X.X GB" / "X MB" / "X KB"
_wizard_human_bytes() {
    local bytes="$1"
    if [[ "$bytes" -ge 1073741824 ]]; then
        awk -v b="$bytes" 'BEGIN { printf "%.1f GB", b / 1073741824 }'
    elif [[ "$bytes" -ge 1048576 ]]; then
        awk -v b="$bytes" 'BEGIN { printf "%.0f MB", b / 1048576 }'
    else
        awk -v b="$bytes" 'BEGIN { printf "%.0f KB", b / 1024 }'
    fi
}

# _wizard_measure_sizes <brew-ids> <cask-ids> - prints "type|id|bytes" per
# resolvable package (bytes=0 if its URL couldn't be measured). One batched
# `brew info --json=v2` call per type (not one call per package), then up
# to 8 HEAD requests in parallel at a time (bash 3.2 has no `xargs -P`, so
# concurrency is capped with a plain background-job counter + `wait`).
_wizard_measure_sizes() {
    local brew_ids="$1" cask_ids="$2"
    local tmp_urls tmp_results
    tmp_urls="$(mktemp -t devforgekit-size-urls.XXXXXX)"
    tmp_results="$(mktemp -d -t devforgekit-size-results.XXXXXX)"

    if [[ -n "$brew_ids" ]]; then
        # shellcheck disable=SC2086 # deliberately word-split into separate brew arguments
        brew info --json=v2 $brew_ids 2>/dev/null | jq -r '
            .formulae[]
            | (.bottle.stable.files // {}) as $f
            | ($f | to_entries[0].value.url // empty) as $url
            | select($url != "")
            | "brew|\(.name)|\($url)"
        ' >> "$tmp_urls"
    fi
    if [[ -n "$cask_ids" ]]; then
        # A requested cask id can be an alias Homebrew resolves to a
        # different canonical token (e.g. Brewfile's `cask "docker"` ->
        # .token "docker-desktop", with "docker" only appearing in
        # .old_tokens - confirmed live) - emit one result line per alias
        # (.token plus every .old_tokens entry) so the lookup later
        # matches regardless of which name the Brewfile actually used.
        # shellcheck disable=SC2086 # deliberately word-split into separate brew arguments
        brew info --json=v2 --cask $cask_ids 2>/dev/null | jq -r '
            .casks[]
            | select(.url != null)
            | . as $c
            | ([$c.token] + ($c.old_tokens // []))[]
            | "cask|\(.)|\($c.url)"
        ' >> "$tmp_urls"
    fi

    local kind url name i=0
    while IFS='|' read -r kind name url; do
        [[ -z "$url" ]] && continue
        i=$((i + 1))
        (
            # A conditional args array (`auth=(); auth=(-H ...); curl
            # "${auth[@]}" ...`) is NOT safe here - bash 3.2 expands
            # "${auth[@]}" on a genuinely empty array to one spurious
            # empty-string argument rather than zero arguments (the same
            # pitfall found and fixed in _wizard_custom_categories), which
            # would land as a bogus argument ahead of the real URL. Branch
            # instead of conditionally building an args array.
            local length
            case "$url" in
                *ghcr.io*)
                    length="$(curl -fsSIL --max-time 5 -H "Authorization: Bearer QQ==" "$url" 2>/dev/null | tr -d '\r' | grep -i '^content-length:' | tail -1 | awk '{print $2}')"
                    ;;
                *)
                    length="$(curl -fsSIL --max-time 5 "$url" 2>/dev/null | tr -d '\r' | grep -i '^content-length:' | tail -1 | awk '{print $2}')"
                    ;;
            esac
            printf '%s|%s|%s\n' "$kind" "$name" "${length:-0}" > "$tmp_results/$i"
        ) &
        if (( i % 8 == 0 )); then wait; fi
    done < "$tmp_urls"
    wait

    cat "$tmp_results"/* 2>/dev/null
    rm -rf "$tmp_urls" "$tmp_results"
}

# _wizard_ensure_size_cache - populates WIZARD_SIZE_CACHE_FILE exactly
# once per wizard run, measuring every package in the generated category
# manifest (the full universe any tier might reference), not just what's
# currently selected - so re-entering the Custom checklist after a toggle
# never re-measures. Returns non-zero (leaving the cache empty) when
# brew/jq/curl aren't all available - callers must treat that as "no size
# data", never fabricate one.
_wizard_ensure_size_cache() {
    [[ -n "$WIZARD_SIZE_CACHE_FILE" && -s "$WIZARD_SIZE_CACHE_FILE" ]] && return 0
    if ! command_exists brew || ! command_exists jq || ! command_exists curl; then
        return 1
    fi
    [[ -f "$BREWFILE_CATEGORIES_FILE" ]] || return 1

    echo
    log_info "Checking package download sizes (one-time this run)..."

    local brew_ids cask_ids
    brew_ids="$(grep -E '^[a-z][a-z0-9-]*\|brew\|' "$BREWFILE_CATEGORIES_FILE" | cut -d'|' -f3 | sort -u | tr '\n' ' ')"
    cask_ids="$(grep -E '^[a-z][a-z0-9-]*\|cask\|' "$BREWFILE_CATEGORIES_FILE" | cut -d'|' -f3 | sort -u | tr '\n' ' ')"

    WIZARD_SIZE_CACHE_FILE="$(mktemp -t devforgekit-size-cache.XXXXXX)"
    _wizard_measure_sizes "$brew_ids" "$cask_ids" > "$WIZARD_SIZE_CACHE_FILE"
    return 0
}

# _wizard_size_lookup <type> <id> -> bytes, or empty if unmeasured/unmeasurable
#
# Every helper below ends with `|| true` (or an explicit `return 0`) even
# though it's only ever used via command substitution (`x="$(fn ...)"`).
# That's not decoration: bash suspends `errexit` for everything *inside*
# a `$(...)`, but the substitution's own exit status is whatever its
# LAST command returned, and that status is still checked by errexit in
# the OUTER context doing the assignment. A `grep` that legitimately
# finds nothing (an unmeasured package, an unknown category id) exits 1;
# under `pipefail` that 1 survives even through `| head -1 | cut ...`
# since pipefail reports the rightmost non-zero stage. If that's the
# last thing the function does, the "nothing found" case (completely
# normal here) kills the whole script the moment its result is assigned
# - confirmed live, this is exactly what was crashing
# _wizard_show_install_detail on the first unmeasured package it hit.
_wizard_size_lookup() {
    [[ -n "$WIZARD_SIZE_CACHE_FILE" && -f "$WIZARD_SIZE_CACHE_FILE" ]] || return 0
    grep "^$1|$2|" "$WIZARD_SIZE_CACHE_FILE" 2>/dev/null | head -1 | cut -d'|' -f3 || true
}

# _wizard_download_estimate <brewfile> -> human-readable total download
# size for every brew/cask line in it, or "not available"/"partial" -
# never a fabricated number.
_wizard_download_estimate() {
    local brewfile="$1"
    _wizard_ensure_size_cache || { echo "not available"; return; }

    local total=0 measured=0 unmeasured=0 type id bytes
    while IFS=' ' read -r type id; do
        [[ -z "$id" ]] && continue
        bytes="$(_wizard_size_lookup "$type" "$id")"
        if [[ -n "$bytes" && "$bytes" -gt 0 ]]; then
            total=$((total + bytes))
            measured=$((measured + 1))
        else
            unmeasured=$((unmeasured + 1))
        fi
    done < <(grep -oE '^[[:space:]]*(brew|cask)[[:space:]]+"[^"]+"' "$brewfile" | sed -E 's/^[[:space:]]*(brew|cask)[[:space:]]+"([^"]+)"/\1 \2/')

    if [[ $measured -eq 0 ]]; then
        echo "not available"
        return
    fi

    local human
    human="$(_wizard_human_bytes "$total")"
    if [[ $unmeasured -gt 0 ]]; then
        echo "~$human (partial - $unmeasured package(s) unmeasured)"
    else
        echo "~$human"
    fi
}

# _wizard_category_label/_wizard_category_description <category-id>
_wizard_category_label() {
    grep "^@category|$1|" "$BREWFILE_CATEGORIES_FILE" 2>/dev/null | head -1 | cut -d'|' -f3 || true
}
_wizard_category_description() {
    grep "^@category|$1|" "$BREWFILE_CATEGORIES_FILE" 2>/dev/null | head -1 | cut -d'|' -f4- || true
}

# _wizard_show_install_detail <brewfile> - the "why does this category
# exist, and which of these are heavy" breakdown (PRD items 2/3), grouped
# by category and shown once after selection is final, right before the
# preview/confirm - not redrawn on every checklist keystroke, which would
# turn a 15-category, ~100-package manifest into an unreadable wall of
# text on every toggle.
#
# Walks $BREWFILE_CATEGORIES_FILE itself (already sorted by category by
# the generator) rather than $brewfile's own line order - the root
# Brewfile is roughly alphabetical by package id, NOT grouped by
# category, so a single category's members can be scattered non-
# contiguously through it; printing a header "only the first time a
# category is seen" against that order silently attributes later
# same-category entries to whatever unrelated header preceded them
# (found live: coreutils/duf/dust - all "other" - appeared to be nested
# under an unrelated "Apple Development" header this way). Iterating the
# already-sorted manifest and tracking just the *previous* line's
# category avoids the bug entirely.
_wizard_show_install_detail() {
    local brewfile="$1"
    # `|| true`: a bare, unprotected call here would abort the whole
    # wizard under errexit on any machine without brew/jq/curl (a real,
    # not hypothetical, case on a fresh pre-bootstrap machine) - the rest
    # of this function already degrades gracefully with an empty cache
    # (_wizard_size_lookup just returns nothing), so a missing cache is
    # not itself an error worth failing over.
    _wizard_ensure_size_cache || true

    local wanted
    wanted="$(grep -oE '^[[:space:]]*(brew|cask)[[:space:]]+"[^"]+"' "$brewfile" | sed -E 's/^[[:space:]]*(brew|cask)[[:space:]]+"([^"]+)"/\1|\2/')"

    local last_cat="" cat_id type id pkg_desc bytes heavy_note
    while IFS='|' read -r cat_id type id pkg_desc; do
        [[ -z "$cat_id" || "$cat_id" == @* ]] && continue
        printf '%s\n' "$wanted" | grep -qxF "$type|$id" || continue

        if [[ "$cat_id" != "$last_cat" ]]; then
            last_cat="$cat_id"
            echo
            echo "${COLOR_BOLD}$(_wizard_category_label "$cat_id")${COLOR_RESET} - $(_wizard_category_description "$cat_id")"
        fi

        bytes="$(_wizard_size_lookup "$type" "$id")"
        heavy_note=""
        # 300 MB+ is the "heavy" cutoff - flags things like Flutter/Android
        # Studio/Docker without annotating every small CLI tool.
        if [[ -n "$bytes" && "$bytes" -ge 314572800 ]]; then
            heavy_note=" ($(_wizard_human_bytes "$bytes"))"
        fi
        if [[ -n "$pkg_desc" ]]; then
            printf '  o %s%s - %s\n' "$id" "$heavy_note" "$pkg_desc"
        else
            printf '  o %s%s\n' "$id" "$heavy_note"
        fi
    done < "$BREWFILE_CATEGORIES_FILE"
    echo
}

_wizard_count_brewfile() {
    local brewfile="$1" kind="$2"
    # `grep -c` always prints a count (including "0"), but exits 1 when
    # that count is zero - `|| echo 0` would double-print in that case,
    # so only fall back to an explicit "0" if grep produced no output at
    # all (e.g. the file doesn't exist).
    local count
    count="$(grep -cE "^[[:space:]]*${kind}[[:space:]]+\"" "$brewfile" 2>/dev/null)"
    echo "${count:-0}"
}

_wizard_custom_categories() {
    if [[ ! -f "$BREWFILE_CATEGORIES_FILE" ]]; then
        log_warn "No category manifest found at profiles/generated/brewfile-categories.txt"
        log_warn "(run 'devforgekit registry generate' first) - falling back to the Full profile."
        WIZARD_BREWFILE_PATH="$DEV_SETUP_ROOT/Brewfile"
        WIZARD_PROFILE_LABEL="full"
        return
    fi

    local categories=() cat_id
    while IFS='|' read -r cat_id _type _id _desc; do
        [[ -z "$cat_id" || "$cat_id" == \#* ]] && continue
        case " ${categories[*]-} " in
            *" $cat_id "*) ;;
            *) categories+=("$cat_id") ;;
        esac
    done < "$BREWFILE_CATEGORIES_FILE"

    if [[ ${#categories[@]} -eq 0 ]]; then
        log_warn "Category manifest has no entries - falling back to the Full profile."
        WIZARD_BREWFILE_PATH="$DEV_SETUP_ROOT/Brewfile"
        WIZARD_PROFILE_LABEL="full"
        return
    fi

    local selected=() finished=0 choice i c mark label desc
    while [[ "$finished" -eq 0 ]]; do
        echo
        log_section "Custom - choose categories"
        i=1
        for c in "${categories[@]}"; do
            mark=" "
            case " ${selected[*]-} " in *" $c "*) mark="x" ;; esac
            label="$(_wizard_category_label "$c")"
            desc="$(_wizard_category_description "$c")"
            printf '  %2d) [%s] %s - %s\n' "$i" "$mark" "${label:-$c}" "$desc"
            i=$((i + 1))
        done
        echo "   a) select all    n) select none    d) done selecting"
        read -r -p "Toggle a number, or a/n/d: " choice

        case "$choice" in
            a|A) selected=("${categories[@]}") ;;
            n|N) selected=() ;;
            d|D) finished=1 ;;
            ''|*[!0-9]*) log_warn "Not a valid choice" ;;
            *)
                if (( choice >= 1 && choice <= ${#categories[@]} )); then
                    c="${categories[$((choice - 1))]}"
                    case " ${selected[*]-} " in
                        *" $c "*)
                            # Toggle off: rebuild the list without $c - bash
                            # 3.2 has no associative arrays to key off of.
                            # Note: `arr=("${other[@]-}")` is NOT safe here
                            # when `other` ends up empty - bash 3.2 expands
                            # that to one empty-string element instead of
                            # zero elements (confirmed live), so ${#selected[@]}
                            # would wrongly read 1 instead of 0. Guard
                            # explicitly instead.
                            local new_selected=() s
                            for s in "${selected[@]}"; do
                                [[ "$s" == "$c" ]] || new_selected+=("$s")
                            done
                            if [[ ${#new_selected[@]} -eq 0 ]]; then
                                selected=()
                            else
                                selected=("${new_selected[@]}")
                            fi
                            ;;
                        *) selected+=("$c") ;;
                    esac
                else
                    log_warn "Not a valid choice"
                fi
                ;;
        esac
    done

    local tmp_brewfile
    tmp_brewfile="$(mktemp -t devforgekit-custom-brewfile.XXXXXX)"
    {
        echo "# Generated by the DevForgeKit install wizard (Custom profile) - safe to delete."
        local cat type id
        while IFS='|' read -r cat type id _desc; do
            [[ -z "$cat" || "$cat" == \#* ]] && continue
            case " ${selected[*]-} " in
                *" $cat "*) printf '%s "%s"\n' "$type" "$id" ;;
            esac
        done < "$BREWFILE_CATEGORIES_FILE"
    } > "$tmp_brewfile"

    WIZARD_BREWFILE_PATH="$tmp_brewfile"
    WIZARD_PROFILE_LABEL="custom (${#selected[@]} categories)"
}

_wizard_editor_prompt() {
    echo
    local reply
    read -r -p "Install VS Code/Cursor extensions? [Y/n]: " reply
    if [[ "$reply" =~ ^[Nn] ]]; then
        SKIP_EDITOR_EXTENSIONS=1
    else
        SKIP_EDITOR_EXTENSIONS=0
    fi
}

_wizard_services_prompt() {
    echo
    echo "Start local services now (${SERVICE_LIST[*]})?"
    echo "  1) All (default)   2) None   3) Choose"
    local reply
    read -r -p "Enter a number [1-3]: " reply
    case "${reply:-1}" in
        2) WIZARD_SERVICES_MODE="none"; WIZARD_SERVICE_LIST="" ;;
        3)
            WIZARD_SERVICES_MODE="choose"
            local svc r list=()
            for svc in "${SERVICE_LIST[@]}"; do
                read -r -p "  Start $svc? [y/N]: " r
                [[ "$r" =~ ^[Yy] ]] && list+=("$svc")
            done
            WIZARD_SERVICE_LIST="${list[*]-}"
            ;;
        *) WIZARD_SERVICES_MODE="all"; WIZARD_SERVICE_LIST="" ;;
    esac
}

_wizard_preview_and_confirm() {
    local brew_count cask_count vscode_count cursor_count ext_count services_desc

    brew_count="$(_wizard_count_brewfile "$WIZARD_BREWFILE_PATH" brew)"
    cask_count="$(_wizard_count_brewfile "$WIZARD_BREWFILE_PATH" cask)"

    if [[ "$SKIP_EDITOR_EXTENSIONS" -eq 1 ]]; then
        ext_count=0
    else
        vscode_count="$(wc -l < "$DEV_SETUP_ROOT/vscode/extensions.txt" 2>/dev/null || echo 0)"
        cursor_count="$(wc -l < "$DEV_SETUP_ROOT/cursor/extensions.txt" 2>/dev/null || echo 0)"
        ext_count=$((vscode_count + cursor_count))
    fi

    case "$WIZARD_SERVICES_MODE" in
        all) services_desc="${SERVICE_LIST[*]}" ;;
        none) services_desc="none" ;;
        choose) services_desc="${WIZARD_SERVICE_LIST:-none}" ;;
    esac

    echo
    log_section "Install preview"
    echo "  Profile:           $WIZARD_PROFILE_LABEL"
    echo "  Homebrew formulae: $brew_count"
    echo "  Homebrew casks:    $cask_count"
    echo "  Editor extensions: $ext_count"
    echo "  Services:          $services_desc"
    echo "  Estimated download: $(_wizard_download_estimate "$WIZARD_BREWFILE_PATH")"
    echo "  Disk after install: not measured - Homebrew doesn't report unpacked size"
    echo

    if ! confirm "Continue with this installation?"; then
        log_info "Installation cancelled."
        exit 0
    fi
}

wizard_run() {
    echo
    log_section "Welcome to DevForgeKit"
    echo "Choose your installation:"
    echo "  1) Minimal     - bare CLI essentials only"
    echo "  2) Recommended - everyday dev tooling (no Flutter/Android, no databases)"
    echo "  3) Full        - everything (default today)"
    echo "  4) Custom      - pick categories yourself"
    local choice
    read -r -p "Enter a number [1-4] (default 3): " choice
    case "${choice:-3}" in
        1) WIZARD_BREWFILE_PATH="$(profile_brewfile_path minimal)"; WIZARD_PROFILE_LABEL="minimal" ;;
        2) WIZARD_BREWFILE_PATH="$(profile_brewfile_path recommended)"; WIZARD_PROFILE_LABEL="recommended" ;;
        4) _wizard_custom_categories ;;
        *) WIZARD_BREWFILE_PATH="$(profile_brewfile_path full)"; WIZARD_PROFILE_LABEL="full" ;;
    esac

    _wizard_editor_prompt
    _wizard_services_prompt
    _wizard_show_install_detail "$WIZARD_BREWFILE_PATH"
    _wizard_preview_and_confirm
}
