# Recommended profile

Common day-to-day development tooling: git, GitHub CLI, Git LFS, mise, jq,
Docker, and matching VS Code extensions (Prettier, ESLint, GitLens,
Docker). No Flutter/Android toolchain, no databases/services. Node,
Python, and Java are still installed via `mise.toml` for every profile
(see [../../mise.toml](../../mise.toml)) - this profile only controls
what Homebrew installs. Editor settings/keybindings/extensions restore in
full regardless of profile (see
[../../docs/Profiles.md](../../docs/Profiles.md)).

Use with:

```bash
./bootstrap.sh --profile recommended
# or
./devforgekit install --profile recommended
```
