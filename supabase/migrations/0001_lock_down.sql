/* ==========================================================================
   0001 — Lock down the Supabase database.

   Run this ONLY after creating a login user:
     Dashboard → Authentication → Users → Add user
   With no user, the app cannot sign in at all once this script finishes.

   If you are unsure, run `0000_audit.sql` FIRST and read its output. That
   file changes nothing.

   This script is idempotent: running it twice leaves the same result.
   ========================================================================== */

begin;

-- --------------------------------------------------------------------------
-- 0. Guard — abort unless this really is the cashier database.
--
--    The script drops every policy in schema `public`. Run against the
--    wrong project and that project silently loses all access too. So we
--    check the cashier table fingerprint first and abort with a clear
--    message rather than failing halfway through.
-- --------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.sales')          is null
     or to_regclass('public.sale_items')    is null
     or to_regclass('public.sale_payments') is null
     or to_regclass('public.customers')     is null
     or to_regclass('public.products')      is null then
    raise exception
      'Aborted: cashier tables not found. This script is for the Kasir Shanti database only.';
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 1. Snapshot the old policies into a table, so they can be read later if
--    anyone wonders what the previous setup actually allowed.
-- --------------------------------------------------------------------------
create table if not exists public._policy_backup_20260101 as
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public';

/* RLS stays on for the backup table too. It holds policy definitions only,
   never customer rows, but Postgres grants `anon` read on every new table by
   default — without this the backup is a small hole opened for nothing. */
alter table public._policy_backup_20260101 enable row level security;
revoke all on public._policy_backup_20260101 from anon;
grant select on public._policy_backup_20260101 to authenticated;

-- --------------------------------------------------------------------------
-- 2. Drop every existing policy in `public`.
--
--    This closes the hole that is open right now: the publishable key is
--    bundled into the frontend, so anyone can read it from DevTools, then
--    use it to pull the entire contents of customers, sales, sale_items and
--    sale_payments with no password whatsoever.
-- --------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select schemaname, tablename, policyname
           from pg_policies
           where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 3. Enable RLS on every table in `public`.
--
--    Deliberately NOT using `force row level security`.
--
--    `force` also applies policies to the table owner. Here the owner is
--    the `postgres` role, which is what the Supabase Dashboard uses — so
--    with `force` your tables would look EMPTY in the dashboard right when
--    you want to check the data, which is the fastest way to make an owner
--    panic.
--
--    Without `force`, `postgres` still sees everything (good for backups and
--    spot checks), while `anon` and `authenticated` — the only roles
--    reachable from the internet — are bound by the policies below.
-- --------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 3b. Views.
--
--     RLS does not reach a view through the tables it reads. In Postgres 15+
--     a plain view runs with its OWNER's rights, so a view over `customers`
--     keeps serving all 327 rows no matter how tightly the table underneath
--     is locked. Recreating the option `security_invoker = true` makes the
--     view run as the caller instead, which is what closes that.
--
--     No-ops when the project has no views, which is the expected case here.
--     Run `0000_audit.sql` sections 4b and 4c first if any show up.
-- --------------------------------------------------------------------------
do $$
declare
  r record;
begin
  -- `security_invoker` only exists in Postgres 15+. Below that, `alter view
  -- ... set (...)` errors out and takes the whole transaction with it.
  -- Checking the version first means a missed view is skipped loudly rather
  -- than the entire lockdown failing.
  if current_setting('server_version_num')::int < 150000 then
    raise warning 'Postgres below 15 — views cannot be locked with security_invoker. Handle manually.';
    return;
  end if;

  for r in select c.relname from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('alter view public.%I set (security_invoker = true)', r.relname);
    execute format('revoke all on public.%I from anon', r.relname);
    execute format('grant all on public.%I to authenticated', r.relname);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 4. Strip `anon`'s grants, then grant `authenticated` full access.
--
--    RLS alone already blocks `anon`. Revoking at the GRANT level as well
--    gives two layers: if a policy is ever written wrong, `anon` still has
--    no privileges at all.
-- --------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke all on table public.%I from anon', r.relname);
    execute format('grant all on table public.%I to authenticated', r.relname);
  end loop;
end $$;

grant usage on schema public to authenticated;

-- --------------------------------------------------------------------------
-- 5. Policies — `anon` gets nothing, `authenticated` gets everything.
--
--    One shared account for the owner and the admins (an agreed decision),
--    so there are no roles to split. The only property that matters: no
--    login, no read, no write.
--
--    Policy names include the table name so they are easy to find in the
--    Dashboard.
-- --------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      'sel_' || r.relname, r.relname);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (true)',
      'tambah_' || r.relname, r.relname);
    execute format(
      'create policy %I on public.%I for update to authenticated using (true) with check (true)',
      'ubah_' || r.relname, r.relname);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (true)',
      'hapus_' || r.relname, r.relname);
  end loop;
end $$;

commit;

-- --------------------------------------------------------------------------
-- 6. Report. Nothing fails quietly.
-- --------------------------------------------------------------------------
do $$
declare
  tanpa_rls text;
  tanpa_policy text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into tanpa_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity = false;

  select string_agg(c.relname, ', ' order by c.relname) into tanpa_policy
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname
        and p.roles = '{authenticated}'::name[]
    );

  raise notice '=== 0001 done ===';
  if tanpa_rls is null then
    raise notice 'RLS     : enabled on every public table.';
  else
    raise notice 'WARNING - RLS is NOT enabled on: %', tanpa_rls;
  end if;
  if tanpa_policy is null then
    raise notice 'Policies: authenticated has access on every public table.';
  else
    raise notice 'WARNING - no authenticated policy on: %', tanpa_policy;
  end if;
end $$;