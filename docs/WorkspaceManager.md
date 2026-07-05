# Workspace Manager

The Workspace Manager (v1.2.4) is `devforgekit workspace` - it makes an
isolated per-project development environment a single, switchable unit:

```bash
./devforgekit workspace create acme-backend --from-current --switch
```

replaces the manual checklist every developer juggling multiple
clients/projects on one machine already knows by heart:

```text
git config --global user.email "..."         # by hand, every time
edit ~/.ssh/config for this client's key       # by hand
re-export API keys/env vars in this shell      # by hand, lost on new tab
docker context use ...; kubectl config use-context ...   # by hand
remember which aliases/functions applied here  # by memory
```

Everything above - git identity, SSH host identities, environment
variables and secrets, Docker/Kubernetes/cloud-CLI context, and shell
aliases/functions/PATH - moves together with one
`devforgekit workspace switch <name>`.

## Quick start

```bash
./devforgekit workspace create acme-backend --description "Acme backend work"
./devforgekit workspace switch acme-backend        # applies everything the workspace declares
./devforgekit workspace show                        # full detail on the active workspace
./devforgekit workspace verify                       # PASS/WARNING/FAIL across every subsystem
./devforgekit workspace snapshot create acme-backend -m "before upgrading node"
./devforgekit workspace rollback acme-backend <snapshotId>
./devforgekit workspace export acme-backend ./backups
./devforgekit workspace import ./backups/acme-backend-workspace.tar.gz --name acme-backend-2
./devforgekit workspace deactivate
```

Or from the [interactive dashboard](TUI.md): press `w`, then `n` to
create, `Enter` to switch, `v` to verify, `x` to snapshot.

## The workspace document

Each workspace is one JSON file:
`~/.config/devforgekit/workspaces/<name>/workspace.json`, validated
against `cli/src/schemas/workspace.schema.json`
(`schemaVersion: 2`, the same ajv-validated approach
[PlatformArchitecture.md](PlatformArchitecture.md) section 7's config
system and section 3's registry schemas use). Nothing here is
proprietary or hidden - it is a plain, readable, hand-editable JSON file
(re-validated on every save, so a hand edit that breaks the schema is
rejected with a clear error rather than silently corrupting the file).

| Field | Purpose |
| --- | --- |
| `name`, `description`, `owner`, `tags`, `status` | identity (`status`: `active` or `archived` - archived workspaces are hidden from `workspace list` by default) |
| `createdAt`, `modifiedAt` | ISO-8601 timestamps, stamped automatically |
| `profile`, `collections`, `recipes`, `components`, `plugins` | optional references into the existing registry - resolved through the exact same `core/registry.js` functions `profile install`/`recipe install` use, never reimplemented |
| `git` | name/email/signingKey/defaultBranch/hooksPath/aliases/credentialHelper/lfs |
| `ssh` | `identities: [{ provider, host, hostAlias, user, identityFile, port }]` |
| `env` | `variables` (plain) + `secretKeys` (names whose values are AES-256-GCM-encrypted separately - see Secrets below) |
| `docker` | `context`, plus reference-only `composeFiles`/`networks`/`volumes` |
| `kubernetes` | `context`, `namespace`, plus reference-only `clusters` |
| `cloud` | per-provider `{ ref, region }` for `aws`/`azure`/`gcp`/`firebase`/`supabase`/`cloudflare`/`vercel`/`netlify` |
| `ai`, `editor`, `browser` | provider/model/app preferences (browser is reference-only - see Subsystems) |
| `shell` | aliases/functions/PATH additions/prompt/theme applied via the shell-init hook |
| `packageManagers` | reference-only per-tool registry/index settings (brew/mise/npm/pnpm/pip/cargo/go/composer/gem/nuget) |
| `projectHistory` | `[{ stack, name, dir, createdAt }]` - `devforgekit new` appends here automatically when a workspace is active |
| `sync` | reserved for future multi-machine sync (see below) - present in the schema, not consumed by anything yet |
| `compatibility` | `{ scanHistory, repairHistory }` - appended to by `workspace compatibility scan`/`repair` (v1.2.5, see [CompatibilityEngine.md](CompatibilityEngine.md)); each scan entry records `{ timestamp, score, verdict, pass, recommend, warn, critical, unsupported }`, each repair entry `{ timestamp, actionCount, succeeded, failed }` |

### Schema versioning and migration

`schemaVersion` follows the same "never break an existing document"
guarantee section 14 of PlatformArchitecture.md defines for the CLI's
own version: `core/workspace/schema.js`'s `migrateWorkspace()` walks a
document forward through a `migrations[fromVersion]` table one version
at a time, and **refuses** (throws, does not guess) if a document's
`schemaVersion` is *newer* than the running CLI understands - silently
dropping unrecognized fields on the next save would be real,
unrecoverable data loss. The Compatibility Engine (v1.2.5) added the
first real entry to that table: `migrations[1]` upgrades a v1 document
(everything created before this release) to v2 by adding the
`compatibility` field with its documented default shape
(`{ scanHistory: [], repairHistory: [] }`) - proof the migration
machinery works on a real field addition, not just a placeholder.

## Subsystems: what's real, what's reference-only

`workspace switch` only ever touches what a workspace actually declares -
a workspace with no `docker` section configured leaves Docker alone
rather than clearing it - and only ever does what the real underlying
tool genuinely supports:

| Subsystem | On switch | Notes |
| --- | --- | --- |
| **git** | real `git config --global` writes: name/email/signingKey/commit.gpgsign/init.defaultBranch/core.hooksPath/credential.helper, plus workspace-scoped aliases | `workspace git-capture <name>` captures the live machine's current identity back into a workspace |
| **SSH** | an idempotent `~/.ssh/config` `Host` block per identity | delimited by a unique `# BEGIN/END DEVFORGEKIT WORKSPACE: <name>` marker (`core/workspace/markerBlock.js`) - never touches a user's own entries outside that block; keys are referenced by path, never copied or generated |
| **Environment** | plain vars -> a workspace-scoped `.env` file; secrets decrypted only in memory when applied | see Secrets below |
| **Docker** | `docker context use <context>` | only if that context already exists locally; otherwise reported as a declared-but-unavailable reference, never silently created |
| **Kubernetes** | `kubectl config use-context` (+ `kubectl config set-context --current --namespace`) | same "must already exist locally" rule as Docker |
| **Cloud** | `AWS_PROFILE` exported (AWS), `GOOGLE_CLOUD_PROJECT` exported + `gcloud config set project` (GCP) | Azure, Firebase, Supabase, Cloudflare, Vercel, Netlify are recorded references only - none of those CLIs have an equivalent "named, pre-created local profile" concept to switch into |
| **Shell** | (re)writes `~/.config/devforgekit/workspace-shell.sh` (exports/aliases/functions/PATH for the active workspace) | a one-time `workspace shell-init` adds a single idempotent line to `.zshrc`/`.bashrc` that sources it - the same "generated file + one rc-file line" shape `mise activate`/`direnv hook` use |
| **Browser**, **packageManagers** | reference-only | recorded in the document; nothing today can switch a browser profile or a package manager's registry setting machine-wide, so nothing pretends to |

## Health verification

`workspace verify [name]` (defaults to the active workspace) runs
`core/workspace/health.js`'s `verifyWorkspace()`, which checks the
document's own schema validity, resolves every registry reference
(profile/collections/recipes/components/plugins) and reports a FAIL for
anything dangling, confirms every SSH identity file exists on disk,
decrypts every declared secret, and checks the AI provider's
`apiKeyRef`. Results feed `core/health.js`'s `scoreResults` - the exact
PASS/WARNING/FAIL weighting `check.sh`/`doctor` already standardize on -
so a score means the same thing everywhere in the platform. The
dashboard's Workspaces page (`v`) renders the identical result shape.

`workspace repair <name>` (also run automatically during
`workspace import`) drops and reports any dangling
profile/recipe/component/plugin/collection reference rather than
leaving a workspace that will keep failing verification.

## Snapshots and rollback

```bash
./devforgekit workspace snapshot create acme-backend -m "before upgrading node"
./devforgekit workspace snapshot list acme-backend
./devforgekit workspace snapshot compare acme-backend <id>              # vs. current
./devforgekit workspace snapshot compare acme-backend <idA> <idB>       # two snapshots
./devforgekit workspace snapshot restore acme-backend <id>              # stored document only
./devforgekit workspace rollback acme-backend <id>                      # + re-applies live if active
./devforgekit workspace snapshot export acme-backend <id> ./before.json
./devforgekit workspace snapshot delete acme-backend <id>
```

A snapshot is the whole document, captured verbatim, under
`~/.config/devforgekit/workspaces/<name>/snapshots/<id>/`. Two related
but distinct operations exist on purpose:

- **`snapshot restore`** - resets the *stored* document to a snapshot.
  Nothing on the live machine changes, even if that workspace is active.
- **`rollback`** - the safe, high-level operation: takes an automatic
  safety snapshot of the *current* state first (so an accidental
  rollback is itself always one more rollback away from undone), restores
  the target snapshot, and - only if that workspace is the currently
  active one - re-applies it live across every subsystem, exactly like a
  fresh `switch`.

## Portable bundles (export/import)

```bash
./devforgekit workspace export acme-backend ./backups
./devforgekit workspace import ./backups/acme-backend-workspace.tar.gz --name acme-backend-2 --overwrite
```

`export` writes a `.tar.gz` containing the workspace document and a
small `bundle.json` manifest (source `schemaVersion`, DevForgeKit
version, export timestamp). Two things are deliberately **excluded**:

- **Secret values** - only the encrypted `secrets.enc.json` file and the
  machine-local key would be needed to decrypt them, and the key never
  leaves the machine it was generated on. Re-set secrets on the
  destination with `workspace env set <name> <key> <value> --secret`.
- **Snapshot history** - a bundle is a snapshot of the *current*
  configuration to move somewhere else, not a full history transplant.

`import` re-validates the document against the current schema and then
runs it through the same repair pass `workspace repair` uses standalone -
any profile/recipe/component/plugin/collection reference that doesn't
exist in the *destination* machine's registry is dropped and reported,
rather than importing a document that would fail every subsequent
`workspace verify`/`getWorkspace()` call. Refuses to overwrite an
existing workspace of the same name unless `--overwrite` is passed.

## Dashboard integration

The Workspaces page (`w`, see [TUI.md](TUI.md)) is a thin frontend over
the exact same `core/workspace/*.js` functions the CLI uses - browse,
create (`n`), switch (`Enter`), verify (`v`), snapshot (`x`), deactivate
(`z`), and delete (`D`, pressed twice to confirm). Consistent with the
scoping precedent the Recipes/Doctor/Plugins pages already set,
lower-frequency operations (rename, clone, export/import, env/SSH
management, rollback) stay CLI-only rather than cramming all 30
subcommands into a terminal UI - the panel links back to the CLI for
those.

## Security notes

- **Secrets are encrypted, not vaulted.** `env set --secret` encrypts
  the value with AES-256-GCM using a key generated once per machine
  (`~/.config/devforgekit/workspace-secret.key`, mode `0600`). This
  protects against casual disclosure (an accidental commit, a config
  file glanced at over someone's shoulder) on *this* machine - it is
  explicitly **not** a multi-user secrets vault, and does not protect
  against another process running as the same OS user. A real
  multi-machine secret store needs the account/server infrastructure
  [PlatformArchitecture.md](PlatformArchitecture.md) section 17
  describes as design-only.
- **SSH trust is trust-on-first-use**, identical to running `ssh` by
  hand - the workspace manager adds no verification beyond git/ssh's
  own `known_hosts` mechanism.
- **Nothing is ever created that doesn't already exist.** Docker
  contexts, Kubernetes clusters, and cloud profiles must already exist
  locally before a workspace can switch into them; the workspace
  manager only *selects*, never provisions.

## Future: multi-machine sync (design only)

The schema's `sync` field (`remoteId`, `provider`, `lastSyncedAt`) is
reserved, present, and validated today - and consumed by nothing. It
exists so that when [PlatformArchitecture.md](PlatformArchitecture.md)
section 17's cloud backend is eventually built, a workspace can gain a
`sync` block without another schema version bump. The honest design
intent for that future phase:

- Same device-code auth flow section 17 already specifies for config
  sync (mirroring `gh auth login`), reused rather than inventing a
  second auth story.
- What syncs: the workspace document *shape* a bundle already excludes
  secrets from - structure, references, and non-secret settings.
  Secret *values* would need their own explicitly-opt-in, end-to-end
  encrypted path (the local AES-256-GCM key never leaving the machine
  today is a deliberate constraint, not an oversight, and any future
  sync design must not silently weaken it).
- Conflict handling would reuse `compareSnapshots`'s diff shape
  (`added`/`removed`/`changed` keys) that already exists for local
  snapshot comparison - a merge UI is a consumer of that diff, not a
  new diffing algorithm.
- Until this phase exists, `workspace export`/`import` is the honest,
  fully-real answer to "move a workspace to another machine": manual,
  explicit, and file-based rather than a background daemon pretending
  to be a sync service.

## Command reference

| Command | Does |
| --- | --- |
| `workspace create [name]` | `--description`, `--owner`, `--from-current` (seed git/docker/kubernetes from the live machine), `--switch` |
| `workspace list` | `--all` to include archived workspaces |
| `workspace show [name]` | defaults to the active workspace |
| `workspace switch <name>` | applies every declared subsystem live |
| `workspace deactivate` | clears the active pointer (live state is left as-is) |
| `workspace delete <name>` | `-f/--force` to delete the active workspace or skip confirmation |
| `workspace rename <old> <new>` | |
| `workspace clone <source> <new>` | never copies secrets or snapshot history |
| `workspace search <query>` | matches name/tag/owner/profile/recipe/collection/component/git identity/cloud reference |
| `workspace verify [name]` | defaults to the active workspace |
| `workspace repair <name>` | drops dangling registry references |
| `workspace export <name> [outDir]` | |
| `workspace import <archive>` | `--name`, `--overwrite` |
| `workspace rollback <name> <snapshotId>` | safety snapshot first, then restores (+ re-applies if active) |
| `workspace snapshot create <name>` | `-m/--message` |
| `workspace snapshot list <name>` | |
| `workspace snapshot restore <name> <id>` | stored document only, no live re-apply |
| `workspace snapshot compare <name> <id> [otherId]` | vs. another snapshot, or vs. current if omitted |
| `workspace snapshot delete <name> <id>` | |
| `workspace snapshot export <name> <id> <destPath>` | |
| `workspace env list [name]` | secret values shown as `<encrypted>` |
| `workspace env set <name> <key> <value>` | `--secret` to encrypt |
| `workspace env unset <name> <key>` | |
| `workspace env import <name> <file>` | `--secret <keys>` comma-separated |
| `workspace env export <name> <file>` | `--include-secrets` decrypts to plaintext on disk |
| `workspace ssh list <name>` | |
| `workspace ssh add-identity <name>` | `--host`/`--provider`/`--alias`/`--user`/`--identity-file`/`--port` |
| `workspace ssh remove-identity <name> <hostAlias>` | |
| `workspace git-capture <name>` | captures the live machine's git identity |
| `workspace shell-init [shell]` | `--uninstall`, `--print` |
| `workspace compatibility scan [name]` | records the result in `compatibility.scanHistory` |
| `workspace compatibility repair [name]` | `--dry-run`, `-y/--yes`; records the result in `compatibility.repairHistory` |
| `workspace compatibility history [name]` | shows past scans/repairs |

## Testing

`cli/test/workspace-*.test.js` (store, schema, git, ssh, env,
shellIntegration, docker, kubernetes, cloud, health, snapshot, bundle,
switcher) and the Workspaces-page section of `cli/test/tui.test.js` -
all against a temp `$HOME` and the real filesystem/git/tar, no mocks,
the same philosophy `plugin-sdk.test.js` established.
