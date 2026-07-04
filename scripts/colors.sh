#!/usr/bin/env bash
# Shared ANSI color codes and status symbols for all DevForge scripts.
# Colors are disabled automatically when stdout is not a terminal (CI, piping, log files).

if [[ -z "${NO_COLOR:-}" && -t 1 ]]; then
    COLOR_RESET=$'\033[0m'
    COLOR_BOLD=$'\033[1m'
    COLOR_DIM=$'\033[2m'
    COLOR_INFO=$'\033[34m'      # blue
    COLOR_SUCCESS=$'\033[32m'   # green
    COLOR_WARNING=$'\033[33m'   # yellow
    COLOR_ERROR=$'\033[31m'     # red
    COLOR_SECTION=$'\033[35m'   # magenta
else
    COLOR_RESET=""
    COLOR_BOLD=""
    COLOR_DIM=""
    COLOR_INFO=""
    COLOR_SUCCESS=""
    COLOR_WARNING=""
    COLOR_ERROR=""
    COLOR_SECTION=""
fi

SYMBOL_PASS="✔"
SYMBOL_WARN="⚠"
SYMBOL_FAIL="✘"
SYMBOL_INFO="ℹ"
SYMBOL_ARROW="➜"

export COLOR_RESET COLOR_BOLD COLOR_DIM COLOR_INFO COLOR_SUCCESS COLOR_WARNING COLOR_ERROR COLOR_SECTION
export SYMBOL_PASS SYMBOL_WARN SYMBOL_FAIL SYMBOL_INFO SYMBOL_ARROW
