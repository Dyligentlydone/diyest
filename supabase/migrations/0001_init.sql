-- BuildIt — initial schema
-- All application tables with Row Level Security.
-- Owners can access their own rows; public projects are readable by anyone.

-- ---------- helpers ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  units text not null default 'metric' check (units in ('metric', 'imperial')),
  skill_level text not null default 'beginner'
    check (skill_level in ('beginner', 'intermediate', 'advanced')),
  kerf_mm numeric not null default 3 check (kerf_mm >= 0 and kerf_mm <= 10),
  stock_sizes jsonb not null default '{}'::jsonb,
  plan_tier text not null default 'free' check (plan_tier in ('free', 'pro')),
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile on signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- tool inventory ----------
create table public.tool_inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tool_name text not null,
  category text not null default 'custom'
    check (category in ('hand', 'power', 'measuring', 'clamping', 'custom')),
  created_at timestamptz not null default now(),
  unique (user_id, tool_name)
);
alter table public.tool_inventory enable row level security;
create policy "tool_inventory_all_own" on public.tool_inventory
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index tool_inventory_user_idx on public.tool_inventory (user_id);

-- ---------- projects ----------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  title text not null,
  mode text not null default 'build' check (mode in ('build', 'fix', 'space', 'leftovers')),
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'done')),
  is_public boolean not null default false,
  slug text unique,
  input jsonb not null default '{}'::jsonb,
  plan jsonb,
  prompt_version text,
  thumbnail_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.projects enable row level security;
create policy "projects_all_own" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects_select_public" on public.projects
  for select using (is_public);
create index projects_user_idx on public.projects (user_id, created_at desc);
create index projects_slug_idx on public.projects (slug) where is_public;

create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------- project images ----------
create table public.project_images (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  storage_path text not null,
  kind text not null default 'input' check (kind in ('input', 'journal', 'progress')),
  created_at timestamptz not null default now()
);
alter table public.project_images enable row level security;
create policy "project_images_all_via_owner" on public.project_images
  for all using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid())
  );
create policy "project_images_select_public" on public.project_images
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.is_public)
  );
create index project_images_project_idx on public.project_images (project_id);

-- ---------- step progress ----------
create table public.step_progress (
  project_id uuid not null references public.projects (id) on delete cascade,
  step_n int not null,
  done boolean not null default false,
  done_at timestamptz,
  primary key (project_id, step_n)
);
alter table public.step_progress enable row level security;
create policy "step_progress_all_via_owner" on public.step_progress
  for all using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid())
  );

-- ---------- journal ----------
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  note text not null default '',
  image_path text,
  created_at timestamptz not null default now()
);
alter table public.journal_entries enable row level security;
create policy "journal_all_via_owner" on public.journal_entries
  for all using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid())
  );
create policy "journal_select_public" on public.journal_entries
  for select using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.is_public)
  );
create index journal_entries_project_idx on public.journal_entries (project_id, created_at);

-- ---------- step chat ----------
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  step_n int not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  image_path text,
  created_at timestamptz not null default now()
);
alter table public.chat_messages enable row level security;
create policy "chat_all_via_owner" on public.chat_messages
  for all using (
    exists (select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p
            where p.id = project_id and p.user_id = auth.uid())
  );
create index chat_messages_project_idx on public.chat_messages (project_id, step_n, created_at);

-- ---------- usage events ----------
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  kind text not null
    check (kind in ('plan_generate', 'plan_modify', 'chat_message', 'diagnosis', 'ideas')),
  created_at timestamptz not null default now()
);
alter table public.usage_events enable row level security;
create policy "usage_select_own" on public.usage_events
  for select using (auth.uid() = user_id);
create policy "usage_insert_own" on public.usage_events
  for insert with check (auth.uid() = user_id);
create index usage_events_user_idx on public.usage_events (user_id, created_at);

-- ---------- generation logs ----------
-- user_id added beyond the brief's sketch so anonymous/pre-save generations can
-- still be attributed for rate limiting and cost tracking.
create table public.generation_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  prompt_version text not null,
  raw_output text,
  validation_errors jsonb,
  latency_ms int,
  tokens int,
  created_at timestamptz not null default now()
);
alter table public.generation_logs enable row level security;
create policy "genlogs_select_via_owner" on public.generation_logs
  for select using (
    auth.uid() = user_id or exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid())
  );
create policy "genlogs_insert_own" on public.generation_logs
  for insert with check (auth.uid() = user_id);
create index generation_logs_project_idx on public.generation_logs (project_id);

-- ---------- subscriptions (Stripe) ----------
-- Written only by the service role (Stripe webhook). Users can read their own.
create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_subscription_id text,
  status text not null default 'none',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

create trigger subscriptions_set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();
