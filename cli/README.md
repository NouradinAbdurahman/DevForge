# DevForgeKit Core CLI

Layer 2 of the DevForgeKit platform (see
[../docs/PlatformArchitecture.md](../docs/PlatformArchitecture.md)).
Node.js, installed by `bootstrap.sh` itself via the `node = "lts"` pin in
`mise.toml`. Owns command parsing, plugins, the component registry,
configuration, and diagnostics; wraps the existing `scripts/*.sh` for
everything that already has a working bash implementation rather than
reimplementing it.

## Development

```bash
cd cli
npm install
npm run lint
npm test
node bin/devforgekit.js --help
```

## Adding a command

Add one file under `src/commands/`, exporting a `registerXCommand(program)`
function, and one call to it in `src/index.js`. If the command already
has a `scripts/*.sh` implementation, wrap it with
`defineScriptCommand` from `src/core/shell.js` instead of reimplementing
its logic.

## The dashboard (TUI)

`src/tui/` is the interactive terminal dashboard (`devforgekit` with no
arguments; see [../docs/TUI.md](../docs/TUI.md)). It's Ink (React for
terminals) written with `React.createElement` - **no JSX**, the CLI has
no build step. Rules: pages call the same `core/` services the classic
commands call (never duplicate logic into the TUI); child processes a
page runs must either stream through `runShellCommand`'s `onOutput`
option or go through the store's `suspend()` (a child inheriting the
TTY corrupts Ink's rendering); and don't render controls whose backend
doesn't exist. Adding a page = one file in `src/tui/pages/` + one entry
each in `store.js`'s `PAGES` and `App.js`'s `PAGE_COMPONENTS`. Tests:
`test/tui.test.js` (ink-testing-library).

## The Workspace Manager

`src/core/workspace/` (`devforgekit workspace`; see
[../docs/WorkspaceManager.md](../docs/WorkspaceManager.md)) is one
module per concern - `store.js` (CRUD + the active-workspace pointer),
`schema.js` (validation + `migrateWorkspace`), `git.js`/`ssh.js`/`env.js`/
`docker.js`/`kubernetes.js`/`cloud.js`/`shellIntegration.js` (one
subsystem each), `health.js`, `snapshot.js`, `bundle.js`, and
`switcher.js` (the only module that imports every subsystem, to
orchestrate a full switch/rollback). `commands/workspace.js` and
`tui/pages/WorkspacePage.js` are both thin frontends over these - neither
contains subsystem logic of its own. To add a new subsystem: give it its
own `core/workspace/<name>.js` with an `apply*`/`capture*` pair (matching
`git.js`'s shape), add its schema block to
`src/schemas/workspace.schema.json`, wire it into `switcher.js`'s
`switchToWorkspace`/`rollbackToSnapshot` and `health.js`'s
`verifyWorkspace`, and add its CLI surface in `commands/workspace.js` -
nothing else needs to change. Tests: `test/workspace-*.test.js` (one file
per module, temp `$HOME`, no mocks) plus the Workspaces-page section of
`test/tui.test.js`.

## Adding a registry component

Add one `registry/packages/<name>.yaml` file matching
`registry/schema/package.schema.json` - no code changes needed, the
`component`/`search` commands pick it up automatically. Run `node
bin/devforgekit.js registry generate` afterward to refresh
`registry/registry.json`/`docs/Registry.md` (CI fails if you forget -
see `.github/workflows/cli.yml`). If your component depends on another
one, add its name to `dependencies` - `resolveInstallOrder` in
`core/installer.js` handles the rest. Also fill in the Package Quality
System fields: `stability` (`stable`/`beta`/`deprecated`), `lastVerified`
(today's date - the date you confirmed the commands work), and
optionally `documentation`/`architectures`. Never fabricate `ciVerified:
true` - only set it if you've also added the package to
`.github/workflows/registry-smoke.yml`'s live-tested allowlist. Run
`node bin/devforgekit.js info <name>` afterward to see its Manifest
Quality Score (`core/quality.js`'s `scoreManifest`) - a low score usually
just means `documentation`/`ciVerified` aren't filled in yet, which is
expected for most new components.

## Adding a collection

Add one `registry/collections/<name>.yaml` file matching
`registry/schema/collection.schema.json` (a `name`, `description`, and a
`components` array of real package names) - no code changes needed.

## Adding a profile

Add one `registry/profiles/<name>.yaml` file matching
`registry/schema/profile.schema.json` (`name`, `description`, and at
least one of `collections`/`components`, plus optional `settings`) - no
code changes needed. A profile composes collections + extra components;
prefer referencing an existing collection over duplicating its list.
User-created profiles (from `profile create`/`profile export`) live
outside the repo at `~/.config/devforgekit/profiles/` and are discovered
the same way.

## Adding a recipe

Add one `registry/recipes/<name>.yaml` file matching
`registry/schema/recipe.schema.json` (`name`, `description`, and at
least one of `collections`/`components`, plus optional `icon`/`tags`/
`configure`/`verify`/`settings`) - no code changes needed. A recipe is a
lighter-weight sibling of a profile (same `collections`/`components`
shape) that also declares `configure` steps (`git`/`vscode`/`cursor`/
`shell`/`mise` - see `core/recipes.js`) and a `verify` pass. User-created
recipes (from `recipe create`) live outside the repo at
`~/.config/devforgekit/recipes/` and are discovered the same way. See
[../docs/Recipes.md](../docs/Recipes.md) for the full design.

## Adding a project generator stack

Add one file under `src/generators/<stack>.js` exporting an object with
`id`/`label`/`description` and at least one of `scaffold`/`generate` (see
any existing generator, or `core/projectGenerator.js` for the full
contract - `requiresTool`/`promptOptions`/`postGenerate`/`nextSteps` are
all optional), then add one import + array entry in
`src/generators/index.js` - nothing else needs to change, `commands/
new.js` and `core/projectGenerator.js` are both stack-agnostic. Reuse
`src/generators/shared.js` for anything stack-agnostic (MIT license text,
`.editorconfig`, `.vscode/settings.json`, the common README shape, the
shared Node CI workflow) instead of duplicating it. See
[../docs/ProjectGenerator.md](../docs/ProjectGenerator.md) for the full
design and the 16 stacks shipped today.

## Adding a plugin

`node bin/devforgekit.js plugin create <name>` scaffolds a working
`plugin.yml` (schema v2 - `commands`/`events`/`dependencies`, see
`src/schemas/plugin.schema.json`) plus `commands/`, `hooks/`, `tests/`,
and a generated `README.md` - no code changes needed,
`core/plugins.js` discovers and validates any `plugins/<name>/plugin.yml`
(or `~/.devforgekit/plugins/<name>/` once installed) automatically. See
`plugins/hello-world` for a minimal working example, and
[../docs/PlatformArchitecture.md](../docs/PlatformArchitecture.md)
section 4 for the full SDK (`test`/`build`/`package`/`publish`/`install`,
lifecycle events, Ed25519 signing/trust).
