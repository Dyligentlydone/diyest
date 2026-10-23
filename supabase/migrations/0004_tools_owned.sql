-- Tool inventory (BRIEF-v2 M3): saved tools power "use my tools only".
alter table public.profiles
  add column if not exists tools_owned text[] not null default '{}';
