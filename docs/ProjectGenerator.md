# Project Generator

The Project Generator (v1.2.2) is `devforgekit new <stack> [name]` -
one command that produces a complete, ready-to-code project, not a copy
of a static folder:

```bash
./devforgekit new nextjs my-app
```

replaces the manual checklist:

```text
npx create-next-app my-app --typescript --tailwind --eslint
cd my-app
install and wire up shadcn/ui by hand
add Prettier + Husky + lint-staged by hand
write a Dockerfile by hand
write a GitHub Actions workflow by hand
git init
```

## How it's different from `templates/`

DevForgeKit has always shipped [ready-to-copy templates](Templates.md)
under `templates/` - static, independent starter folders you `cp -r` and
rename. The Project Generator doesn't replace them; it solves a
different problem:

| | `templates/` | `devforgekit new` |
| --- | --- | --- |
| What you get | a static folder, copied as-is | a project assembled per your answers |
| Stays current with upstream? | no - frozen at whatever was committed | yes, where a stack has one - scaffolds through the stack's **own official CLI** (`flutter create`, `create-next-app`, ...) |
| Configurable? | no - edit files yourself after copying | yes - prompts (or flags) for stack-specific choices: state management, auth, Docker, ... |
| Best for | "I want a minimal reference to read" | "I want to start coding a real project right now" |

## Usage

```bash
./devforgekit new --list                                          # every supported stack
./devforgekit new                                                  # interactive: pick a stack, then a name
./devforgekit new nextjs my-app                                    # positional stack + name
./devforgekit new flutter my-app --state riverpod --backend supabase
./devforgekit new express my-api --auth --prisma --swagger --docker
./devforgekit new go-fiber my-service --dir ~/code                 # --dir sets the parent directory
./devforgekit new express my-api --license apache-2.0 -y            # explicit license, skip prompts
./devforgekit new flutter --quality                                 # show the Generator Quality Score, generate nothing
```

Any stack-specific option not passed as a flag is prompted for
interactively (state management, backend, auth, Docker, ...). Passing
every relevant flag up front skips all prompting - useful for scripting.

## Project Generator Excellence (v2.1.2)

`devforgekit new` goes beyond scaffolding files - every stack now shares
the same "premium" behavior, applied once at the engine/command level
rather than duplicated 17 times:

- **Validation before generation.** Project names are checked against a
  syntax rule, Windows-reserved device names (`con`, `nul`, `com1`-`9`,
  `lpt1`-`9` - filesystem paths that literally cannot exist on Windows),
  leading `.`/`-`, and an existing-directory check - all before any tool
  is invoked or any file is written, with a clear, actionable error
  instead of a scaffold command failing halfway through.
- **A real license choice.** `--license mit|apache-2.0|gpl-3.0|none`
  (interactive prompt if omitted, defaults to MIT) is applied
  universally by `core/projectGenerator.js` after every generator's
  `generate`/`postGenerate` step runs, writing a real, complete license
  text - never a placeholder - and never overwriting a LICENSE a
  generator or its official scaffolding CLI already wrote itself.
- **Stack Intelligence.** Before scaffolding starts, the CLI shows real,
  registry-backed companion tools for the chosen stack (e.g. Flutter →
  Firebase/Supabase/Android Studio/Dart) via each generator's
  `recommends: [...]` array of real `registry/packages/` names - never a
  fabricated list. The same data drives a live "Stack Intelligence" panel
  in the TUI's Project Generator page as you move the cursor over a
  stack.
- **Generator Quality Score** (`devforgekit new <stack> --quality`,
  `cli/src/core/generatorQuality.js`) - the Manifest Quality Score's
  sibling for generators: a breakdown across Documentation/Architecture/
  Testing/CI/Docker/Editor Support/Validation/Examples/Cross Platform,
  computed by actually calling the generator's real, pure `generate()`
  function and inspecting the file list it returns (never executed
  against disk, never fabricated) - so a stack whose `generate()` only
  layers a couple of config files onto an official scaffolding CLI scores
  honestly lower than one that hand-writes a fuller project (see
  `devforgekit new --list`, which shows every stack's score inline).
- **A structured post-generation summary** - Location/Stack/License/Git/
  CI workflow/Docker/README, each read back from the real generated
  output on disk rather than assumed from what was requested, followed
  by the stack's real next commands.

## Supported stacks

| Stack | `<stack>` id | Scaffolded via | What you get |
| --- | --- | --- | --- |
| Flutter | `flutter` | `flutter create` | Clean Architecture (`core`/`data`/`domain`/`presentation`), Riverpod or Bloc, Supabase or Firebase, a real widget test, `flutter_lints`, GitHub Actions CI, optional Docker (nginx serving the web build) |
| Next.js | `nextjs` | `create-next-app` | TypeScript, Tailwind, App Router, shadcn/ui (`components.json`, `lib/utils.ts`, a `Button`), Prettier, Husky + lint-staged, a standalone-build Dockerfile, CI |
| SvelteKit | `sveltekit` | `sv create` (the official Svelte CLI - v2.0.9) | TypeScript, ESLint, Prettier, optional Tailwind CSS, optional Dockerfile, CI |
| Express | `express` | hand-written | JWT auth (register/login), Prisma + PostgreSQL, Swagger/OpenAPI at `/docs`, Jest + Supertest, ESLint (flat config), Docker + docker-compose (app + Postgres), CI |
| React | `react` | Vite (`react-ts` template) | TypeScript, ESLint, CI |
| React Native | `react-native` | `create-expo-app --template bare-minimum` | real native `ios/`/`android/` folders (bare workflow - no Expo Go/EAS dependency), CI |
| Expo | `expo` | `create-expo-app` | managed workflow, TypeScript, CI |
| NestJS | `nestjs` | the official Nest CLI | Docker, CI |
| FastAPI | `fastapi` | hand-written | Pydantic settings, pytest, Docker + docker-compose, CI |
| Django | `django` | `django-admin startproject` | `requirements.txt`, Docker + docker-compose (app + Postgres), CI |
| Laravel | `laravel` | `composer create-project laravel/laravel` | Docker (php-fpm + nginx), CI |
| Spring Boot | `spring-boot` | the Spring Initializr API (`start.spring.io`) | Maven, Web/JPA/PostgreSQL/Lombok/Validation starters, Docker, CI |
| ASP.NET | `aspnet` | `dotnet new webapi` | Docker, CI |
| Go Fiber | `go-fiber` | hand-written | a health route, a real test, Docker, CI |
| Rust Axum | `rust-axum` | hand-written | a health route, a real test, Docker, CI |
| Tauri | `tauri` | `create-tauri-app` (vanilla TypeScript) | Rust core + TypeScript frontend, CI (frontend build + `cargo check`) |
| Electron | `electron` | hand-written | main/preload/renderer skeleton, electron-builder packaging, CI |

Every stack also gets a README, `.editorconfig`/`.vscode` settings where
applicable, and `git init`.

## Prerequisites per stack

Stacks that scaffold through an official CLI need that CLI's own
prerequisite on `PATH` - the command tells you exactly what's missing and
how to fix it before it tries to run anything:

```text
$ devforgekit new flutter my-app
Error: 'flutter' is not installed or not on PATH - required to generate a Flutter project.
  Install it with: devforgekit component install flutter
```

| Stack(s) | Requires |
| --- | --- |
| Flutter | `flutter` |
| Next.js, SvelteKit, React, React Native, Expo, NestJS, Tauri | `npx` (ships with Node.js) |
| Django | `django-admin` (`pip install django`) |
| Laravel | `composer` |
| Spring Boot | `curl` and `unzip` only (Java/Maven are needed to build/run afterward, not to scaffold) |
| ASP.NET | `dotnet` |
| Express, FastAPI, Go Fiber, Rust Axum, Electron | nothing - fully hand-written, no external CLI |

## How a generator is put together (for contributors)

Every file under `cli/src/generators/*.js` exports one object implementing
the same contract that `cli/src/core/projectGenerator.js`'s
`runProjectGenerator` drives:

```js
export const exampleGenerator = {
    id: "example",
    label: "Example",
    description: "One-line summary shown in `devforgekit new --list`",
    tags: ["backend", "example"],              // optional: search/discoverability
    recommends: ["postgres", "docker"],        // optional: real registry package names, shown as Stack Intelligence
    requiresTool: { command: "some-cli", hint: "How to install it" }, // optional
    async promptOptions(flags) { ... },       // optional: ask for stack-specific choices
    async scaffold({ name, parentDir, dir, options }) { ... },  // optional: shell out, return an exit code
    generate({ name, dir, options }) { return [{ path, content, mode? }, ...]; }, // optional
    postGenerate({ name, dir, options }) { ... },  // optional: modify a file scaffold() already wrote
    nextSteps({ name, dir, options }) { return ["cd my-app", "npm install", ...]; }
};
```

A generator needs at least one of `scaffold`/`generate`. Register it in
`cli/src/generators/index.js`'s `GENERATORS` array - nothing else in
`commands/new.js` or `core/projectGenerator.js` needs to change. Reuse
`cli/src/generators/shared.js` for anything stack-agnostic (MIT license
text, `.editorconfig`, `.vscode/settings.json`, the common README shape,
the shared Node CI workflow) rather than duplicating it.

## What's not built yet

Every stack scaffolds locally - there is no remote/hosted template
registry to fetch community-contributed stacks from (the same honest gap
[Recipes.md](Recipes.md) and the Plugin SDK call out for their own
marketplace pieces; see
[PlatformArchitecture.md](PlatformArchitecture.md)'s Plugin/Profile
Marketplace Architecture section for the planned design they'll all
eventually share). Until then, adding a stack means contributing a
generator file via PR.
