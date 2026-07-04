-- Placeholder initial migration.
-- Add real schema changes as new timestamped files via:
--   supabase migration new <name>

create table if not exists public.example (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);
