# NestJS starter template

A minimal NestJS (TypeScript) starter - copy this directory out to start a
new project.

## Recommended structure

```text
nestjs-app/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── app.controller.ts
│   └── app.service.ts
├── package.json
├── tsconfig.json
├── nest-cli.json
├── .gitignore
├── .editorconfig
└── LICENSE
```

## Getting started

```bash
pnpm install
pnpm start:dev
```

Then visit <http://localhost:3000>.

## Example configuration

Standard Nest module/controller/service split: `AppModule` wires
`AppController` to `AppService`, which returns the "Hello, NestJS!" string.
Add new features as their own module under `src/`.
