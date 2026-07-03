# ==================================================
# Homebrew
# ==================================================

eval "$(/opt/homebrew/bin/brew shellenv)"

export HOMEBREW_NO_ANALYTICS=1
export HOMEBREW_AUTO_UPDATE_SECS=86400

# ==================================================
# Editor
# ==================================================

export EDITOR="code"

# ==================================================
# Android SDK
# ==================================================

export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# ==================================================
# Compiler Flags
# ==================================================

export LDFLAGS="-L/opt/homebrew/opt/sqlite/lib"
export CPPFLAGS="-I/opt/homebrew/opt/sqlite/include"

# ==================================================
# PATH
# ==================================================

path=(
    /opt/homebrew/opt/gnu-time/libexec/gnubin
    /opt/homebrew/opt/gnu-tar/libexec/gnubin
    /opt/homebrew/opt/gawk/libexec/gnubin
    /opt/homebrew/opt/gnu-sed/libexec/gnubin
    /opt/homebrew/opt/grep/libexec/gnubin
    /opt/homebrew/opt/findutils/libexec/gnubin
    /opt/homebrew/opt/coreutils/libexec/gnubin
    /opt/homebrew/opt/sqlite/bin

    $ANDROID_HOME/cmdline-tools/latest/bin
    $ANDROID_HOME/platform-tools
    $ANDROID_HOME/emulator

    /opt/homebrew/bin
    /opt/homebrew/sbin

    $HOME/.antigravity-ide/antigravity-ide/bin
    $HOME/.codeium/windsurf/bin

    $path
)

# ==================================================
# Aliases
# ==================================================

alias cls="clear"
alias ll="ls -lah"
alias gs="git status"
alias update="brew update && brew upgrade && brew cleanup"

# ==================================================
# fzf
# ==================================================

source <(fzf --zsh)

# ==================================================
# pnpm
# ==================================================

export PNPM_HOME="$HOME/Library/pnpm"

case ":$PATH:" in
  *":$PNPM_HOME/bin:"*) ;;
  *) export PATH="$PNPM_HOME/bin:$PATH" ;;
esac

# ==================================================
# mise
# ==================================================

eval "$(mise activate zsh)"
