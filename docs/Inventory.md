# Machine inventory

```bash
./scripts/inventory.sh
```

Writes 9 Markdown files under `reports/` (gitignored by default - see
[Security.md](Security.md)):

| File | Contents |
| --- | --- |
| `system.md` | Hostname, macOS product/version/build, architecture, Mac model, current user, timezone, uptime |
| `hardware.md` | Chip, cores, memory, GPU, serial number (masked to the last 4 characters), disk usage |
| `software.md` | Every `.app` in `/Applications` and `~/Applications` |
| `brew.md` | `brew list --formula --versions` and `brew list --cask --versions` |
| `fonts.md` | Fonts in `/Library/Fonts` and `~/Library/Fonts` (default macOS system fonts under `/System/Library/Fonts` are omitted as noise) |
| `extensions.md` | `code --list-extensions` and `cursor --list-extensions` |
| `services.md` | `brew services list`, filtered to Postgres/MySQL/Redis |
| `databases.md` | Version + live connectivity (`pg_isready`/`mysqladmin ping`/`redis-cli ping`) for PostgreSQL, MySQL, Redis |
| `network.md` | Local IP, Wi-Fi SSID, default gateway, DNS servers |

## Design notes

- **Serial masking**: `hardware.md` shows only the last 4 characters of
  the system serial number (e.g. `******J9Q3`), consistent with this
  repo's default of not committing machine-identifying data.
- **No database contents**: `databases.md` reports engine versions and
  connectivity only - it never enumerates actual database names or runs
  queries against them, to avoid needing credentials or exposing data.
- **No external network calls**: `network.md` only reports local
  interface/DNS/gateway info - it doesn't hit any external "what's my IP"
  service.
- Every command in `inventory.sh` is written to tolerate missing
  tools/domains gracefully (a missing CLI just gets "not installed" in the
  relevant file, not a crashed script) - see the `pipefail`-safety notes in
  [Architecture.md](Architecture.md) for why bare `find`/`grep` calls in
  this script are all guarded with `|| true`.
