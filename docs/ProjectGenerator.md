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
```

Any stack-specific option not passed as a flag is prompted for
interactively (state management, backend, auth, Docker, ...). Passing
every relevant flag up front skips all prompting - useful for scripting.

## Supported stacks

| Stack | `<stack>` id | Scaffolded via | What you get |
| --- | --- | --- | --- |
| Flutter | `flutter` | `flutter create` | Clean Architecture (`core`/`data`/`domain`/`presentation`), Riverpod or Bloc, Supabase or Firebase, a real widget test, `flutter_lints`, GitHub Actions CI, optional Docker (nginx serving the web build) |
| Next.js | `nextjs` | `create-next-app` | TypeScript, Tailwind, App Router, shadcn/ui (`components.json`, `lib/utils.ts`, a `Button`), Prettier, Husky + lint-staged, a standalone-build Dockerfile, CI |
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
| Next.js, React, React Native, Expo, NestJS, Tauri | `npx` (ships with Node.js) |
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
