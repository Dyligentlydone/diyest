-- Promo codes: shareable multi-use codes for creators/influencers, kept in
-- invite_codes but distinguished by kind and optionally linked to the
-- creator's own invite code for attribution/payouts.

alter table public.invite_codes
  add column if not exists kind text not null default 'invite'
    check (kind in ('invite', 'promo')),
  add column if not exists linked_code text;  -- promo → creator's invite code
