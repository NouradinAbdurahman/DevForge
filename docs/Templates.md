# Project templates

`templates/` holds minimal, working starter scaffolds you copy out of this
repo to begin a new project - they are not part of `bootstrap.sh` and
nothing here installs or references them automatically.

Want something more complete and configurable instead of a minimal
"Hello, X!" copy? [`devforgekit new <stack>`](ProjectGenerator.md)
(v1.2.2) generates a full project per stack - auth, ORM, state
management, Docker, CI, tests - scaffolded through the stack's own
official CLI where one exists, for 17 stacks. The two are independent:
this page's templates stay exactly as minimal and static as they've
always been.

| Template | Stack | Minimal example does |
| --- | --- | --- |
| `templates/flutter/` | Flutter/Dart | `flutter run` shows a "Hello, Flutter!" screen |
| `templates/nextjs/` | Next.js (App Router, TS) | `pnpm dev` serves a "Hello, Next.js!" page |
| `templates/react/` | React + Vite | `pnpm dev` serves a "Hello, React!" page |
| `templates/react-native/` | React Native (JS layer only) | `App.js`/`index.js` render "Hello, React Native!" once scaffolded into a native RN project |
| `templates/nodejs/` | Node.js, zero deps | `pnpm start` prints "Hello, Node.js!" |
| `templates/express/` | Express | `pnpm start` serves "Hello, Express!" on `/` |
| `templates/nestjs/` | NestJS (TS) | `pnpm start:dev` serves "Hello, NestJS!" via the standard module/controller/service split |
| `templates/python/` | Python | `python src/main.py` prints "Hello, Python!"; `pytest` passes |
| `templates/fastapi/` | FastAPI | `uvicorn main:app --reload` serves `{"message": "Hello, FastAPI!"}` |
| `templates/docker/` | Docker | `docker build && docker run` echoes a greeting |
| `templates/docker-compose/` | Docker Compose | `docker compose up` starts an app container + Postgres, wired via `.env` |
| `templates/terraform/` | Terraform | `terraform apply` writes a local file - works with **zero cloud credentials** (uses the `local` provider), verified end-to-end |
| `templates/supabase/` | Supabase | `supabase start` boots the real local stack; `config.toml` is the CLI's own generated output, not hand-written |
| `templates/firebase/` | Firebase Hosting | `firebase deploy --only hosting` (or the emulator) serves a static "Hello, Firebase!" page |

## What every template includes

- `README.md` - recommended structure, getting-started commands, what the
  example config does.
- `.gitignore` - tailored to that stack.
- `.editorconfig` - 2-space for JS/TS/YAML/JSON/Dart, 4-space for Python.
- `LICENSE` - MIT (same terms as this repo).
- A minimal working example - not a placeholder file, something that
  actually runs. The Terraform and Supabase templates in particular were
  verified against the real CLIs while building this repo (Terraform's
  `init`/`apply`/`destroy` cycle end-to-end; Supabase's `config.toml` is
  copied verbatim from a real `supabase init` run rather than hand-typed).

## Using a template

```bash
cp -r templates/nextjs ~/Developer/my-new-app
cd ~/Developer/my-new-app
pnpm install
pnpm dev
```

## Keeping templates current

`.github/dependabot.yml` and `renovate.json` both watch the npm-based
templates (`nodejs`, `express`, `nestjs`, `nextjs`, `react`,
`react-native`), the Docker templates, and the Terraform template for
dependency updates - see [GitHubActions.md](GitHubActions.md).
