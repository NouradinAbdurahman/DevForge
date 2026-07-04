#!/usr/bin/env bash

set -e

echo "========================================="
echo "Development Environment Bootstrap"
echo "========================================="

# --------------------------------------------------
# Homebrew
# --------------------------------------------------

if ! command -v brew >/dev/null 2>&1; then
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

eval "$(/opt/homebrew/bin/brew shellenv)"

echo
echo "Installing Homebrew packages..."
brew bundle --file=Brewfile

# --------------------------------------------------
# mise
# --------------------------------------------------

echo
echo "Restoring mise runtimes..."

mkdir -p "$HOME/.config/mise"
cp mise.toml "$HOME/.config/mise/config.toml"

if command -v mise >/dev/null 2>&1; then
    mise install
fi

# --------------------------------------------------
# Shell
# --------------------------------------------------

echo
echo "Restoring shell configuration..."

cp .zshrc "$HOME/.zshrc"

# --------------------------------------------------
# Git
# --------------------------------------------------

echo
echo "Restoring Git configuration..."

cp .gitconfig "$HOME/.gitconfig"
cp .gitignore_global "$HOME/.gitignore_global"

# --------------------------------------------------
# VS Code
# --------------------------------------------------

echo
echo "Restoring VS Code settings..."

mkdir -p "$HOME/Library/Application Support/Code/User"

cp vscode/settings.json \
"$HOME/Library/Application Support/Code/User/" 2>/dev/null || true

cp vscode/keybindings.json \
"$HOME/Library/Application Support/Code/User/" 2>/dev/null || true

if command -v code >/dev/null 2>&1 && [ -f vscode/extensions.txt ]; then
    echo "Installing VS Code extensions..."

    while IFS= read -r extension; do
        [ -z "$extension" ] && continue
        code --install-extension "$extension" --force >/dev/null 2>&1
    done < vscode/extensions.txt

    echo "VS Code extensions restored."
fi

# --------------------------------------------------
# Cursor
# --------------------------------------------------

echo
echo "Restoring Cursor settings..."

mkdir -p "$HOME/Library/Application Support/Cursor/User"

cp cursor/settings.json \
"$HOME/Library/Application Support/Cursor/User/" 2>/dev/null || true

cp cursor/keybindings.json \
"$HOME/Library/Application Support/Cursor/User/" 2>/dev/null || true

if command -v cursor >/dev/null 2>&1 && [ -f cursor/extensions.txt ]; then
    echo "Installing Cursor extensions..."

    while IFS= read -r extension; do
        [ -z "$extension" ] && continue
        cursor --install-extension "$extension" --force >/dev/null 2>&1
    done < cursor/extensions.txt

    echo "Cursor extensions restored."
fi

# --------------------------------------------------
# Services
# --------------------------------------------------

echo
echo "Starting services..."

brew services start postgresql@17 || true
brew services start mysql || true
brew services start redis || true

# --------------------------------------------------
# Health Check
# --------------------------------------------------

echo
echo "========================================="
echo "Health Check"
echo "========================================="

git --version
mise --version
node -v
pnpm -v
python --version
java -version
flutter doctor
docker --version
docker compose version
psql --version
mysql --version
redis-server --version
supabase --version
firebase --version
aws --version
terraform version
kubectl version --client
helm version

echo
echo "========================================="
echo "Bootstrap completed successfully."
echo "========================================="
