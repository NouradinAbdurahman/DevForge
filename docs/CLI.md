# The `./devforgekit` CLI

`./devforgekit` is a thin dispatcher over `bootstrap.sh` and `scripts/*.sh` - it
exists so you don't have to remember individual script names. It doesn't
replace those scripts (they still work directly, and CI calls them
directly), it just forwards to them with `exec` (so exit codes and output
pass through unchanged).

```text
./devforgekit install [options]      Full provision (forwards to ./bootstrap.sh)
./devforgekit update                 Upgrade the managed toolchain, restart services
./devforgekit backup                 Capture live config into the repo, commit+push
./devforgekit restore                Restore dotfiles/editors from the repo
./devforgekit check                  Fast PASS/WARNING/FAIL health check
./devforgekit doctor [--fix]         Deep diagnostics + health score
./devforgekit validate                Validate this repo's own scripts/configs
./devforgekit inventory                Generate machine inventory reports
./devforgekit report                    Generate a system report
./devforgekit services <action>          start|stop|restart|status
./devforgekit clean                       Reclaim disk space
./devforgekit release <bump>               patch|minor|major version release
./devforgekit preferences <action>          backup|restore|status
./devforgekit profile <action>                list|show|use
./devforgekit uninstall                        Not yet implemented
./devforgekit help                              Show usage
```

## Examples

```bash
./devforgekit install --profile flutter
./devforgekit doctor --fix
./devforgekit profile list
./devforgekit services status
./devforgekit release patch
```

## Design

- `./devforgekit <command> [args...]` sets `cmd=$1`, shifts, and `exec`s the
  matching script with the remaining args - see the `devforgekit` file at the repo
  root. Adding a new top-level command means adding one `case` arm there;
  it should never contain actual logic itself.
- `./devforgekit uninstall` is a deliberate stub (prints what to run manually) -
  see [Roadmap](../README.md#roadmap) for planned scope.
