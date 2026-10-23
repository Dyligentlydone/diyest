-- Per-call cost accounting (model routing plan §8).
-- One row per model call: stage, model, tier, token split, $ cost, latency.
alter table public.generation_logs
  add column if not exists stage text,
  add column if not exists model text,
  add column if not exists tier text,
  add column if not exists input_tokens int,
  add column if not exists cached_tokens int,
  add column if not exists output_tokens int,
  add column if not exists reasoning_tokens int,
  add column if not exists cost_usd numeric(10,5);
create index if not exists generation_logs_cost_idx on public.generation_logs (created_at, cost_usd);
