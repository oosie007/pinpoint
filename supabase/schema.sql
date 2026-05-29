-- Pinpoint schema (baseline + auth pivot)
-- Applied remotely via migration auth_profiles_prototypes_rls

create extension if not exists "pgcrypto";

-- Legacy feedback table (prototype_id text retained for backward compatibility)
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  prototype_id text not null,
  prototype_uuid uuid references prototypes(id) on delete set null,
  page_url text not null,
  element_selector text not null,
  element_text text,
  screenshot_url text,
  annotation_data jsonb,
  user_id uuid references auth.users(id) on delete set null,
  user_name text not null,
  comment text not null,
  category text not null check (category in ('bug', 'idea', 'question', 'unclear')),
  priority text check (priority in ('p1', 'p2', 'p3', null)),
  status text not null default 'open' check (status in ('open', 'doing', 'done')),
  tags text[] default '{}',
  assignee text
);

-- See supabase/migrations and docs/SUPABASE_AUTH_SETUP.md for profiles, prototypes,
-- prototype_members, feedback_votes, RLS policies, and storage rules.
