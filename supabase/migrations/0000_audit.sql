/* ==========================================================================
   0000 — Audit. READ ONLY. Changes nothing.

   Run this first. It answers the three questions that decide whether the
   database is actually safe:

     1. Which tables have no RLS?          (anyone can read them)
     2. Which policies let `anon` in?      (anyone can write them)
     3. Are there public functions?        (a hole that bypasses tables)

   Every section ends with a clear "OK" or a list of what is wrong, so you
   do not need to interpret raw Postgres output.
   ========================================================================== */


-- --------------------------------------------------------------------------
-- 1. Tables without row level security.
-- --------------------------------------------------------------------------
select
  c.relname                                        as table_name,
  c.relrowsecurity                                 as rls_enabled,
  obj_description(c.oid)                          as comment,
  case when c.relrowsecurity then 'OK — RLS active'
       else 'EXPOSED — readable by anyone with the publishable key'
  end                                              as verdict
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relrowsecurity asc, c.relname;


-- --------------------------------------------------------------------------
-- 2. Policies that grant access to `anon`.
--
--    `anon` is the role behind the publishable key that ships inside the
--    frontend bundle. Any policy mentioning `anon`, `public` (the Postgres
--    pseudo-role meaning "every role"), or `true` for `anon` is a hole.
-- --------------------------------------------------------------------------
select
  tablename,
  policyname,
  roles,
  cmd,
  coalesce(qual, with_check)                       as condition,
  case
    when 'anon' = any(roles) or 'public' = any(roles)
      then 'EXPOSED — anonymous callers are allowed'
    else 'OK — authenticated only'
  end                                              as verdict
from pg_policies
where schemaname = 'public'
order by (('anon' = any(roles) or 'public' = any(roles)) desc), tablename, policyname;


-- --------------------------------------------------------------------------
-- 3. Table grants held by `anon`.
-- --------------------------------------------------------------------------
select
  table_name,
  privilege_type,
  case when privilege_type = 'SELECT'
       then 'EXPOSED — full table readable anonymously'
       else 'EXPOSED — anonymous write path' end   as verdict
from information_schema.role_table_grants
where grantee = 'anon'
  and table_schema = 'public'
order by table_name, privilege_type;


-- --------------------------------------------------------------------------
-- 4. Functions callable by `anon`, and whether they are SECURITY DEFINER.
--
--    A SECURITY DEFINER function runs as its owner and can bypass RLS, so
--    one of these is enough to undo all of section 1. The app itself calls
--    no RPC at all, so anything listed here is unexpected and worth
--    reading before deciding to revoke.
-- --------------------------------------------------------------------------
select
  p.proname                                       as function_name,
  pg_get_function_identity_arguments(p.oid)      as arguments,
  p.prosecdef                                     as security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_may_execute,
  case
    when p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')
      then 'HIGH RISK — anonymous caller can run this as the owner'
    when has_function_privilege('anon', p.oid, 'EXECUTE')
      then 'REVIEW — anonymous caller can run this'
    else 'OK — not callable by anon'
  end                                             as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by (p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')) desc, p.proname;


-- --------------------------------------------------------------------------
-- 4b. Views and materialized views.
--
--     Tables are only half the surface. A view over `customers` is a table
--     as far as PostgREST is concerned, and in Postgres 15+ a view does not
--     inherit the RLS of the tables underneath it unless it was created
--     `WITH (security_invoker = true)`. One view is enough to undo all of
--     section 1.
-- --------------------------------------------------------------------------
select
  c.relname                                          as view_name,
  c.relkind                                          as kind,
  (c.reloptions @> array['security_invoker=true'])   as security_invoker,
  pg_get_userbyid(c.relowner)                        as owner,
  case
    when c.relkind = 'v' and not (c.reloptions @> array['security_invoker=true'])
      then 'EXPOSED — view bypasses RLS of the tables it reads'
    else 'OK'
  end                                                as verdict
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('v', 'm')
order by c.relname;


-- --------------------------------------------------------------------------
-- 4c. Tables the anon role can still reach through a view.
--
--     Only relevant if section 4b found a non-invoker view. Listed here so
--     the blast radius is explicit rather than inferred.
-- --------------------------------------------------------------------------
select distinct
  v.relname                                           as leaking_view,
  c.relname                                           as table_it_reads
from pg_depend d
join pg_rewrite r on r.oid = d.objid
join pg_class v on v.oid = r.ev_class
join pg_class c on c.oid = d.refobjid
join pg_namespace vn on vn.oid = v.relnamespace
join pg_namespace cn on cn.oid = c.relnamespace
where vn.nspname = 'public' and cn.nspname = 'public'
  and v.relkind = 'v' and c.relkind in ('r', 'p')
  and not (v.reloptions @> array['security_invoker=true'])
order by 1, 2;


-- --------------------------------------------------------------------------
-- 5. Rows behind the exposed tables.
--
--    Run before locking down so you know what is actually at stake. After
--    0001 runs, `anon` sees zero of these.
-- --------------------------------------------------------------------------
select 'customers'     as table_name, count(*) as rows from public.customers
union all select 'sales',          count(*) from public.sales
union all select 'sale_items',     count(*) from public.sale_items
union all select 'sale_payments',  count(*) from public.sale_payments
union all select 'products',       count(*) from public.products
union all select 'product_variants', count(*) from public.product_variants
order by table_name;


-- --------------------------------------------------------------------------
-- 6. Auth users. Should be at least one row after you set up login.
-- --------------------------------------------------------------------------
select
  count(*)                                          as total_users,
  count(*) filter (where email_confirmed_at is not null) as confirmed,
  count(*) filter (where last_sign_in_at is null)  as never_signed_in
from auth.users;