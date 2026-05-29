-- Enable UUID generation
create extension if not exists "pgcrypto";

-- Main feedback table
create table feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),

  -- Capture context (immutable after insert)
  prototype_id text not null,
  page_url text not null,
  element_selector text not null,
  element_text text,
  screenshot_url text,
  annotation_data jsonb,

  -- Reviewer identity
  user_name text not null,
  comment text not null,
  category text not null check (category in ('bug', 'idea', 'question', 'unclear')),

  -- Triage fields (mutable)
  priority text check (priority in ('p1', 'p2', 'p3', null)),
  status text not null default 'open' check (status in ('open', 'doing', 'done')),
  tags text[] default '{}',
  assignee text
);

-- Index for common dashboard queries
create index feedback_prototype_idx on feedback(prototype_id);
create index feedback_status_idx on feedback(status);
create index feedback_created_idx on feedback(created_at desc);

-- Storage bucket for screenshots
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true)
on conflict do nothing;

-- Allow anonymous inserts (extension users are not authenticated)
create policy "allow anon insert" on feedback
  for insert to anon with check (true);

-- Allow anonymous reads (dashboard reads without login for now)
create policy "allow anon select" on feedback
  for select to anon using (true);

-- Allow anonymous updates (triage from dashboard)
create policy "allow anon update" on feedback
  for update to anon using (true);

-- Storage policy: allow anon upload and read
create policy "allow anon upload" on storage.objects
  for insert to anon with check (bucket_id = 'screenshots');

create policy "allow anon read" on storage.objects
  for select to anon using (bucket_id = 'screenshots');

-- Enable RLS
alter table feedback enable row level security;
