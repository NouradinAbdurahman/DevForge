# Node.js starter template

A minimal, dependency-free Node.js starter - copy this directory out to
start a new project.

## Recommended structure

```text
node-app/
├── index.js
├── package.json
├── .env.example
├── .gitignore
├── .editorconfig
└── LICENSE
```

## Getting started

```bash
pnpm install
pnpm start
```

## Example configuration

Copy `.env.example` to `.env` and fill in real values - `.env` is
gitignored. Load it with a package like `dotenv` once you need it; this
template intentionally has zero dependencies to start.
