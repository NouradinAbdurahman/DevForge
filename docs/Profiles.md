# Install profiles

`bootstrap.sh`/`scripts/install.sh` install every package in the root
`Brewfile` by default. Profiles let you install a smaller, purpose-built
subset instead - useful when you don't need (or don't want to wait for)
the full workstation.

## Available profiles

| Profile | Contents |
| --- | --- |
| `full` (default) | Everything in the root `Brewfile` |
| `minimal` | git, gh, git-lfs, mise, jq, yq, fzf, ripgrep, GNU coreutils/sed/findutils, wget, tree - no casks, no databases |
| `flutter` | Flutter SDK, Android Studio, CocoaPods, core git tooling, Dart/Flutter VS Code extensions |
| `backend` | PostgreSQL, MySQL, Redis, Supabase CLI, AWS CLI, kubectl, Helm, Terraform, matching VS Code extensions |
| `custom` | Empty template - copy lines from the root Brewfile or write your own |

Each profile lives under `profiles/<name>/` as its own `Brewfile` (except
`full`, which has no separate file and always resolves to the root
`Brewfile` - see `profile_brewfile_path()` in `scripts/common.sh`) plus a
`README.md` describing it.

**Profiles only control which Homebrew formulae/casks/VS Code bundle
entries get installed.** Dotfiles (`.zshrc`, `.gitconfig`) and editor
settings/keybindings/extensions (`vscode/`, `cursor/`) are always restored
in full regardless of profile - splitting those per-profile too is a
possible future enhancement, not implemented yet.

## Usage

```bash
# One-off, for this run only
./bootstrap.sh --profile flutter
./bootstrap.sh --minimal          # shorthand for --profile minimal
./bootstrap.sh --full             # shorthand for --profile full

# Or via the CLI
./devforgekit install --profile backend

# List/inspect profiles
./devforgekit profile list
./devforgekit profile show backend

# Set a persistent default (stored in .devprofile, gitignored) so future
# ./bootstrap.sh / ./devforgekit install runs use it without needing --profile
./devforgekit profile use flutter
./bootstrap.sh              # now installs the flutter profile
./bootstrap.sh --full       # explicit flag still overrides the default
```

## Adding a new profile

1. `mkdir profiles/<name>`
2. Add `profiles/<name>/Brewfile` (a normal Brewfile - any subset of
   `brew`/`cask`/`vscode`/`npm` lines).
3. Add `profiles/<name>/README.md` - its first line (a `#` heading, with
   the `#` stripped) is used as the one-line description in
   `./devforgekit profile list`.
4. Add a matching entry to `.github/dependabot.yml` if the profile ever
   grows a `package.json`/`Dockerfile` (not applicable to Brewfile-only
   profiles today).

No code changes are needed beyond that - `profile_brewfile_path()` in
`scripts/common.sh` resolves any name that has a `profiles/<name>/Brewfile`
automatically.
