# The `./dev` CLI

`./dev` is a thin dispatcher over `bootstrap.sh` and `scripts/*.sh` - it
exists so you don't have to remember individual script names. It doesn't
replace those scripts (they still work directly, and CI calls them
directly), it just forwards to them with `exec` (so exit codes and output
pass through unchanged).

```text
./dev install [options]      Full provision (forwards to ./bootstrap.sh)
./dev update                 Upgrade the managed toolchain, restart services
./dev backup                 Capture live config into the repo, commit+push
./dev restore                Restore dotfiles/editors from the repo
./dev check                  Fast PASS/WARNING/FAIL health check
./dev doctor [--fix]         Deep diagnostics + health score
./dev validate                Validate this repo's own scripts/configs
./dev inventory                Generate machine inventory reports
./dev report                    Generate a system report
./dev services <action>          start|stop|restart|status
./dev clean                       Reclaim disk space
./dev release <bump>               patch|minor|major version release
./dev preferences <action>          backup|restore|status
./dev profile <action>                list|show|use
./dev uninstall                        Not yet implemented
./dev help                              Show usage
```

## Examples

```bash
./dev install --profile flutter
./dev doctor --fix
./dev profile list
./dev services status
./dev release patch
```

## Design

- `./dev <command> [args...]` sets `cmd=$1`, shifts, and `exec`s the
  matching script with the remaining args - see the `dev` file at the repo
  root. Adding a new top-level command means adding one `case` arm there;
  it should never contain actual logic itself.
- `./dev uninstall` is a deliberate stub (prints what to run manually) -
  see [Roadmap](../README.md#roadmap) for planned scope.
