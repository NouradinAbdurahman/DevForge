# Docker Compose starter template

A minimal multi-service `docker-compose.yml` (an app container + Postgres) -
copy this directory out and adapt it.

## Recommended structure

```text
docker-compose-app/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── .editorconfig
└── LICENSE
```

## Getting started

```bash
cp .env.example .env
docker compose up -d
docker compose ps
docker compose down
```

## Example configuration

`docker-compose.yml` defines an `app` service (replace its `image`/`build`
with your own) and a `db` service (Postgres, matching the `postgresql@17`
DevForge's own `Brewfile` installs locally) wired together with an
`.env`-driven connection string.
