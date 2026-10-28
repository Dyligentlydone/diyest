grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;

grant usage, select on all sequences in schema public to authenticated, service_role;
grant usage on all sequences in schema public to anon;

grant execute on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public grant usage on sequences to anon;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
