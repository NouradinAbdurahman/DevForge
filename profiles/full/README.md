# Full profile (default)

Everything in the root [Brewfile](../../Brewfile) - the complete
workstation this repo was originally built around. This is the default
when no `--profile`/`--minimal`/`--full` flag is given (and no profile has
been set via `./devforgekit profile use`).

This profile has no `profiles/full/Brewfile` of its own - it always
resolves to the root `Brewfile` directly (see `profile_brewfile_path` in
`scripts/common.sh`).

Use with:

```bash
./bootstrap.sh
# or
./bootstrap.sh --full
# or
./devforgekit install --full
```
