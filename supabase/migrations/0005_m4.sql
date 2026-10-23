-- M4: per-project shopping "already have" marks, usage counters for
-- per-plan allowances (enforced server-side in M6), build-mode progress,
-- and the 'describe' entry mode.

alter table public.projects
  add column if not exists shopping_have text[] not null default '{}',
  add column if not exists modifications_used int not null default 0,
  add column if not exists chat_messages_used int not null default 0,
  add column if not exists build_progress jsonb not null default '{}'::jsonb,
  add column if not exists access_level text not null default 'basic'
    check (access_level in ('basic', 'intermediate', 'pro'));

alter table public.projects drop constraint if exists projects_mode_check;
alter table public.projects
  add constraint projects_mode_check
    check (mode in ('build', 'fix', 'space', 'leftovers', 'describe'));
