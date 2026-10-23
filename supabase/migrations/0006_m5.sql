-- M5: gallery categories, plan feedback, and request→plan caching.

alter table public.projects
  add column if not exists category text
    check (category in ('tables','shelves','storage','outdoor','kids','seating','desks','other')),
  add column if not exists is_featured boolean not null default false;

create index if not exists projects_gallery_idx
  on public.projects (category, created_at desc) where is_public;

-- ---------- plan feedback ----------
-- thumbs on a plan + "report a problem" on a step. Feeds prompt improvement.
create table if not exists public.plan_feedback (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  step_n int,                       -- null → whole-plan rating
  rating text not null check (rating in ('up', 'down')),
  comment text,
  created_at timestamptz not null default now()
);
alter table public.plan_feedback enable row level security;
create policy "feedback_insert_anyone" on public.plan_feedback
  for insert with check (true);
create policy "feedback_select_own" on public.plan_feedback
  for select using (auth.uid() = user_id);
create index plan_feedback_project_idx
  on public.plan_feedback (project_id, created_at);

-- ---------- plan cache ----------
-- hash(normalized request + prompt version) → finished plan. Identical
-- requests return instantly at zero model cost; gallery clones reuse too.
create table if not exists public.plan_cache (
  request_hash text primary key,
  -- { plan, unverified, blockers, warnings, reviewPending } — the checked result
  result jsonb not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);
alter table public.plan_cache enable row level security;
create policy "plan_cache_read_auth" on public.plan_cache
  for select using (auth.uid() is not null);
create policy "plan_cache_write_auth" on public.plan_cache
  for insert with check (auth.uid() is not null);

-- cloning a public gallery plan is its own usage kind
alter table public.usage_events
  drop constraint if exists usage_events_kind_check;
alter table public.usage_events
  add constraint usage_events_kind_check
    check (kind in ('plan_generate','plan_modify','chat_message','diagnosis','ideas','plan_clone'));
