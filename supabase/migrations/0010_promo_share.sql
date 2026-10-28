-- Shareable read-only stats tokens for promo codes — the admin can send a
-- creator diyest.com/promo/<token> and they see live stats without a login.

alter table public.invite_codes
  add column if not exists share_token uuid not null default gen_random_uuid();

create unique index if not exists invite_codes_share_token_idx
  on public.invite_codes (share_token);
