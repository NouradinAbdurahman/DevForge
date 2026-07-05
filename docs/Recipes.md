# Recipes

Recipes (v1.2.1) are reusable, one-command environment workflows - a
lighter-weight, opinionated sibling of [profiles](Profiles.md). Where a
profile answers "what do I install to reproduce an environment," a recipe
answers "install it, configure my dotfiles for it, and prove it actually
works," in one command:

```bash
./devforgekit recipe install ai-engineer
```

replaces the manual checklist:

```text
install python
install node
install docker
install ollama
configure git
configure vscode
configure shell
verify everything
```

## What a recipe is

A recipe (`registry/schema/recipe.schema.json`) composes:

- **`collections`** / **`components`** - exactly the same shape a
  [profile](Profiles.md) uses, resolved and installed through the same
  dependency-resolving installer (`core/installer.js`'s `installPlan`,
  via `lib/installRunner.js`'s `runInstallPlan`).
- **`configure`** - an array of cross-cutting, non-package setup steps:
  `git`, `vscode`, `cursor`, `shell`, `mise`. Each is a thin call into the
  exact Layer 1 function `scripts/restore.sh` already runs for the same
  purpose (`restore_git`/`restore_editor`/`restore_zsh`/`restore_mise` in
  `scripts/common.sh`) - see `core/recipes.js`'s `runConfigureStep`.
  Tool-specific setup (e.g. Ollama pulling a model, Docker starting its
  daemon) is deliberately **not** a `configure` action - it belongs on
  the package manifest's own `post_install` (see
  `registry/packages/ollama.yaml`), not the recipe engine.
- **`verify`** (boolean, default `true`) - after install + configure, runs
  every resolved component's `validate` command and reports an explicit
  PASS/FAIL/skip summary (`core/recipes.js`'s `verifyComponents`) - the
  recipe's "verify everything" step.
- **`settings`** (optional) - applied to
  `~/.config/devforgekit/config.yaml` after install, identical to a
  profile's `settings`.

## Built-in recipes

| Recipe | What it builds |
| --- | --- |
| `ai-engineer` | Python, Node, Docker, and Ollama for running LLMs locally |
| `flutter-developer` | Flutter, Dart, Android Studio, Java, and CocoaPods |
| `backend-developer` | Node, PostgreSQL, Redis, Docker, and pnpm |
| `devops-engineer` | Terraform, Ansible, Docker, kubectl, Helm, and the AWS CLI |
| `cybersecurity-lab` | Nmap, Wireshark, Metasploit, Burp Suite, Hydra, and OpenSSL |
| `game-developer` | Godot, Unity Hub, and Blender |
| `ml-engineer` | Python, Ollama, Docker, and PostgreSQL |
| `embedded-engineer` | PlatformIO, Arduino CLI, esptool, OpenOCD, and CMake |

Every built-in recipe also declares `configure: [git, ...]` and
`verify: true` - run `./devforgekit recipe show <name>` for the exact
resolved component list and steps.

## Usage

```bash
./devforgekit recipe list                      # every recipe, with resolved component counts
./devforgekit recipe show ai-engineer           # full definition: components, configure, verify, settings
./devforgekit recipe install ai-engineer        # install -> configure -> apply settings -> verify
./devforgekit recipe install ai-engineer --skip-configure   # install + verify only
./devforgekit recipe install ai-engineer --skip-verify      # install + configure only
./devforgekit recipe search llm                  # search name/description/tags
./devforgekit recipe create                       # interactive wizard - category-grouped component
                                                   # picker, configure-step picker, verify prompt
./devforgekit recipe import ./my-recipe.yaml       # install an arbitrary recipe file, no registration needed
```

## Discovery (same two-root pattern as profiles/plugins)

Recipes are discovered from two roots, merged:

1. **`registry/recipes/`** - the 8 built-in recipes shipped with this
   repo, curated and versioned alongside the rest of the registry.
2. **`~/.config/devforgekit/recipes/`** - personal recipes, written by
   `recipe create` (or hand-authored/shared and dropped in directly - no
   registration step needed).

## Adding a new recipe

Add one `registry/recipes/<name>.yaml` matching
`registry/schema/recipe.schema.json` (`name`, `description`, and at
least one of `collections`/`components`, plus optional `icon`/`tags`/
`configure`/`verify`/`settings`) - no code changes needed. Prefer
referencing an existing [collection](PlatformArchitecture.md) over
duplicating its component list, exactly like profiles. Run
`devforgekit registry generate` afterward to refresh
`registry/registry.json`/`docs/Registry.md` (CI fails the build if you
forget - see `.github/workflows/cli.yml`).

```yaml
schemaVersion: 1
name: my-recipe
description: What this recipe sets up
icon: "✨"
tags: [example]
collections: [backend]
components: [pnpm]
configure: [git, vscode, shell]
verify: true
settings:
  editor: vscode
```

## What's not built yet

`recipe publish` is a deliberate, honest stub - there is no hosted
community registry to publish a recipe to yet (see
[PlatformArchitecture.md](PlatformArchitecture.md)'s Plugin/Profile
Marketplace Architecture section for the planned design, which recipes
will share once it exists). Until then, sharing a recipe means sharing
the YAML file directly (`recipe import`) or contributing it to
`registry/recipes/` via a PR.
