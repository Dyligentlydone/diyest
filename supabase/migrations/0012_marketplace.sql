-- Creator marketplace: priced gallery plans sold through Stripe Connect
-- destination charges (10% platform fee to diyest, remainder to the creator).

alter table public.projects
  add column if not exists price_cents integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_price_cents_check'
  ) then
    alter table public.projects
      add constraint projects_price_cents_check
      check (price_cents is null or price_cents >= 100);
  end if;
end $$;

-- Stripe Connect (Express) account for payouts
alter table public.profiles
  add column if not exists stripe_account_id text,
  add column if not exists stripe_account_enabled boolean not null default false;

create table if not exists public.plan_purchases (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  amount_cents integer not null,
  fee_cents integer not null,
  stripe_session_id text unique,
  stripe_payment_intent text,
  cloned_project_id uuid references public.projects(id) on delete set null,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (buyer_id, project_id)
);

alter table public.plan_purchases enable row level security;

create policy "plan_purchases_select_buyer" on public.plan_purchases
  for select using (auth.uid() = buyer_id);

create policy "plan_purchases_select_seller" on public.plan_purchases
  for select using (auth.uid() = seller_id);

create index if not exists plan_purchases_buyer_idx
  on public.plan_purchases (buyer_id);
create index if not exists plan_purchases_seller_idx
  on public.plan_purchases (seller_id);
create index if not exists plan_purchases_project_idx
  on public.plan_purchases (project_id);

-- Paid plans must not be publicly readable: the old policy exposed the full
-- plan column to anyone (including via the anon API). Free shares stay
-- public; paid rows are visible only to the owner and buyers.
drop policy if exists "projects_select_public" on public.projects;
create policy "projects_select_public" on public.projects
  for select using (is_public and (price_cents is null or price_cents = 0));

create policy "projects_select_purchased" on public.projects
  for select using (
    exists (
      select 1 from public.plan_purchases pp
      where pp.project_id = projects.id
        and pp.buyer_id = auth.uid()
        and pp.refunded_at is null
    )
  );

grant select on public.plan_purchases to anon, authenticated;
grant all on public.plan_purchases to service_role;
