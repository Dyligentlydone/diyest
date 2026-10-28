-- Billing: paid tiers via Stripe. Extends the subscriptions table created in
-- 0001 (service-role writes only, users read their own row) with tier/period
-- fields, and adds plan_credits for one-time single-plan purchases.

alter table public.profiles
  add column if not exists plan_credits int not null default 0;

alter table public.subscriptions
  add column if not exists plan_tier text
    check (plan_tier in ('starter', 'workshop', 'pro')),
  add column if not exists stripe_price_id text,
  add column if not exists stripe_customer_id text,
  add column if not exists current_period_start timestamptz;

create index if not exists subscriptions_customer_idx
  on public.subscriptions (stripe_customer_id);
