# Supabase starter template

A minimal Supabase project layout - copy this directory out to start a new
project. Requires the Supabase CLI (already installed by DevForge's
`Brewfile`) and Docker running locally (Supabase's local stack runs in
containers).

## Recommended structure

```text
supabase-app/
├── supabase/
│   ├── config.toml
│   └── migrations/
│       └── 00000000000000_init.sql
├── .gitignore
├── .editorconfig
└── LICENSE
```

## Getting started

```bash
supabase start          # boots the local stack (Postgres, Auth, Storage, Studio...)
supabase db reset       # applies migrations in supabase/migrations/
supabase status         # shows local URLs and keys
supabase stop
```

## Example configuration

`supabase/config.toml` is the default local-dev config Supabase generates
via `supabase init`; `migrations/00000000000000_init.sql` is a placeholder
migration - add real schema changes as new timestamped files via
`supabase migration new <name>`.
