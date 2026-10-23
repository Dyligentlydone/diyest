-- Invite-only beta: waitlist (double opt-in + referrals), invite codes with
-- grants, redemptions, and per-user beta access on profiles.

-- ---------- profiles: beta grant ----------
alter table public.profiles
  add column if not exists beta_access_level text
    check (beta_access_level in ('basic','intermediate','pro')),
  add column if not exists beta_access_until timestamptz,
  add column if not exists invite_code text;   -- which code granted access (influencer tracking)

-- ---------- waitlist ----------
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,  -- signup order for position math
  email text not null,
  email_hash text not null unique,
  build_answer text,
  heard_from text,
  referral_code text not null unique,
  referred_by text,              -- referral_code of the referrer
  invite_code text,              -- influencer link attribution (?invite=CODE)
  utm_source text, utm_medium text, utm_campaign text,
  marketing_opt_in boolean not null default false,
  referral_count int not null default 0,  -- confirmed signups referred
  confirm_token text not null unique,
  confirmed_at timestamptz,
  invited_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.waitlist enable row level security;
-- anonymous inserts allowed (public form); selects are service-role only
create policy "waitlist_insert_anyone" on public.waitlist
  for insert with check (true);
create index if not exists waitlist_seq_idx on public.waitlist (seq);
create index if not exists waitlist_referral_idx on public.waitlist (referred_by);

-- ---------- invite codes ----------
create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text,
  max_uses int not null default 1 check (max_uses > 0),
  uses int not null default 0,
  expires_at timestamptz,
  grant_access_level text not null default 'pro'
    check (grant_access_level in ('basic','intermediate','pro')),
  grant_days int,                -- null → grant never expires
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.invite_codes enable row level security;
-- redemption + validation run through service-role server code; users read nothing directly
create index if not exists invite_codes_code_idx on public.invite_codes (upper(code));

-- ---------- redemptions ----------
create table if not exists public.invite_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.invite_codes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade unique,
  code text not null,
  redeemed_at timestamptz not null default now()
);
alter table public.invite_redemptions enable row level security;
create policy "redemptions_select_own" on public.invite_redemptions
  for select using (auth.uid() = user_id);

-- ---------- feedback: widen for category'd reports ----------
alter table public.plan_feedback
  add column if not exists category text,
  alter column rating drop not null;
alter table public.plan_feedback drop constraint if exists plan_feedback_rating_check;
alter table public.plan_feedback
  add constraint plan_feedback_rating_check
    check (rating in ('up','down') or rating is null);
