/* ==========================================================================
   0002 — Revoke public EXECUTE on schema `public` functions. OPTIONAL.

   Run `0000_audit.sql` section 4 first. If it reports everything as
   "OK — not callable by anon" or the only hits are functions you recognise
   and no longer use, you can skip this file entirely.

   Postgres grants EXECUTE on new functions to `public` (which means every
   role) by default. A SECURITY DEFINER function in that state lets an
   anonymous caller run code as the table owner, which bypasses every RLS
   policy. The app calls no RPC, so revoking is safe for this project.

   Idempotent.
   ========================================================================== */

begin;

-- Abort unless this is the cashier database. Same guard as 0001.
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
-- Snapshot first. Restoring is then a single statement:
--   grant execute on function <name>(<args>) to anon, authenticated;
-- --------------------------------------------------------------------------
create table if not exists public._function_grants_backup_20260101 as
select p.oid::regprocedure::text as signature, 'public' as grantee
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';

/* Same reasoning as the policy backup: new tables are readable by `anon`
   unless RLS says otherwise. */
alter table public._function_grants_backup_20260101 enable row level security;
revoke all on public._function_grants_backup_20260101 from anon;
grant select on public._function_grants_backup_20260101 to authenticated;

-- --------------------------------------------------------------------------
-- Revoke from `public` (i.e. every role), then grant explicitly to
-- `authenticated` so nothing breaks for logged-in staff.
-- --------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke execute on function %s from public', r.signature);
    execute format('grant execute on function %s to authenticated', r.signature);
  end loop;
end $$;

commit;

do $$
declare
  sisa text;
begin
  select string_agg(distinct p.proname, ', ') into sisa
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  raise notice '=== 0002 done ===';
  if sisa is null then
    raise notice 'anon can no longer execute any function in public.';
  else
    raise notice 'WARNING - still executable by anon: %', sisa;
  end if;
end $$;