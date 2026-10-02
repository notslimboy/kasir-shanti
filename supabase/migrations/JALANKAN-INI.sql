/* ==========================================================================
   TEMPLAT — salin seluruh isi file ini ke Supabase SQL Editor, klik Run.

   Satu file, satu Run. Isinya adalah 0001 + 0002 yang digabung, plus bagian
   penutup yang langsung menjawab "sudah berhasil atau belum".

   PENTING — urutannya tidak boleh dibalik:
     1. Dashboard → Authentication → Users → Add user
        (WAJIB centang Auto Confirm User)
     2. BARU file ini

   Kalau langkah 1 dilewati, setelah file ini jalan tidak ada yang bisa
   login sama sekali, dan yang bisa memperbaikinya hanya SQL Editor.

   Kalau file ini gagal di tengah, transaksi dibatalkan (dibungkus
   `begin` / `commit`) — jadi tidak ada kondisi setengah jadi.
   ========================================================================== */

begin;

-- 0. Penjaga: batal kalau ini bukan database kasir.
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

-- 1. Simpan policy lama supaya masih bisa dibaca / dikembalikan.
--
--    Tabel biasa, bukan TEMP table: kalau file ini dijalankan lewat SQL
--    Editor, TEMP table hilang begitu sesinya selesai — backup-nya ikut hilang
--    sebelum sempat dipakai.
create table if not exists public._policy_backup_20260101 as
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public';

/* RLS tetap dinyalakan di tabel backup. Isinya hanya definisi policy —
   bukan data customer — tapi Postgres secara default memberi `anon` hak
   baca ke setiap tabel baru, jadi tanpa baris ini backup-nya jadi satu
   celah kecil yang sia-sia sekali buka. */
alter table public._policy_backup_20260101 enable row level security;
revoke all on public._policy_backup_20260101 from anon;
grant select on public._policy_backup_20260101 to authenticated;

-- 2. Hapus semua policy lama di `public`.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- 3. RLS di semua tabel.
--
--    Sengaja TANPA `force row level security`. `force` juga berlaku untuk
--    pemilik tabel, dan pemiliknya adalah role postgres yang dipakai
--    Dashboard — jadi tabelmu akan terlihat KOSONG di dashboard precisely
--    when kamu mau cek data. Tanpa `force`, postgres tetap bisa baca semua
--    (bagus untuk backup), sementara `anon` dan `authenticated` — satu-
--   -satunya yang bisa dijangkau internet — terikat policy di bawah.
do $$
declare r record;
begin
  for r in select c.relname from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;

-- 3b. View: RLS tidak otomatis berlaku. Postgres 15+ menjalankan view dengan
--     hak Owners-nya, jadi view biasa di atas `customers` tetap membocorkan
--     semua baris walau tabelnya sudah dikunci rapat-rapat.
do $$
declare
  r record;
  v integer;
begin
  /* `security_invoker` hanya ada di Postgres 15 ke atas. Di bawah itu
     `alter view ... set (...)` gagal dan membatalkan seluruh transaksi,
     jadi versinya dicek dulu — lebih baikMelewatkan view daripada
     menggagalkan seluruh lockdown. Versi dicek ulang di laporan bagian 7. */
  select current_setting('server_version_num')::int into v;

  if v < 150000 then
    raise warning 'Postgres % — view tidak bisa dikunci dengan security_invoker. Kalau project ini punya view, tangani manual.', v;
    return;
  end if;

  for r in select c.relname from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('alter view public.%I set (security_invoker = true)', r.relname);
  end loop;
end $$;

-- 4. Cabut hak `anon`, beri `authenticated` akses penuh.
do $$
declare r record;
begin
  for r in select c.relname from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
  loop
    execute format('revoke all on public.%I from anon', r.relname);
    execute format('grant all on public.%I to authenticated', r.relname);
  end loop;
end $$;

grant usage on schema public to authenticated;

-- 5. Policy: `anon` nol, `authenticated` penuh.
do $$
declare r record;
begin
  for r in select c.relname from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('create policy %I on public.%I for select to authenticated using (true)',
                   'sel_' || r.relname, r.relname);
    execute format('create policy %I on public.%I for insert to authenticated with check (true)',
                   'tambah_' || r.relname, r.relname);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)',
                   'ubah_' || r.relname, r.relname);
    execute format('create policy %I on public.%I for delete to authenticated using (true)',
                   'hapus_' || r.relname, r.relname);
  end loop;
end $$;

-- 6. Fungsi: Postgres memberi EXECUTE ke semua role secara default, dan
--    fungsi SECURITY DEFINER di kondisi itu bisa melewati RLS sepenuhnya.
--    App ini tidak memanggil RPC sama sekali, jadi mencabutnya aman.
--
--    Hanya untuk Postgres 11+: `to_regprocedure` masih jadi `regprocedure`
--    dulu, dan pemanggilan tanpa argumen akan gagal. Di bawah itu blok ini
--    dilewati, bukan menggagalkan seluruh transaksi.
do $$
declare
  r record;
  v integer;
begin
  select current_setting('server_version_num')::int into v;

  if v < 110000 then
    raise warning 'Postgres di bawah 11 — blok pencabutan EXECUTE dilewati.';
    return;
  end if;

  execute $inner$
    create table if not exists public._function_grants_backup_20260101 as
    select p.oid::regprocedure::text as signature, 'public' as grantee
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  $inner$;

  execute 'alter table public._function_grants_backup_20260101 enable row level security';
  execute 'revoke all on public._function_grants_backup_20260101 from anon';
  execute 'grant select on public._function_grants_backup_20260101 to authenticated';

  for r in select p.oid::regprocedure as signature from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
  loop
    execute format('revoke execute on function %s from public', r.signature);
    execute format('grant execute on function %s to authenticated', r.signature);
  end loop;
end $$;

commit;

-- 7. Laporan. Tidak ada yang gagal diam-diam.
do $$
declare
  tanpa_rls     text;
  tanpa_policy  text;
  anon_fungsi   text;
  view_unsafe   text;
  jml_tabel     int;
begin
  select count(*) into jml_tabel
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p');

  select string_agg(c.relname, ', ' order by c.relname) into tanpa_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity = false;

  select string_agg(c.relname, ', ' order by c.relname) into tanpa_policy
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname
        and p.roles = '{authenticated}'::name[]
    );

  select string_agg(distinct p.proname, ', ') into anon_fungsi
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE');

  select string_agg(c.relname, ', ' order by c.relname) into view_unsafe
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and not (c.reloptions @> array['security_invoker=true']);

  raise notice '';
  raise notice '================ HASIL ================';
  raise notice 'Tabel diproteksi : %', jml_tabel;

  if tanpa_rls is null then
    raise notice 'RLS                : AKTIF di semua tabel.';
  else
    raise notice 'RLS                : GAGAL di -> %', tanpa_rls;
  end if;

  if tanpa_policy is null then
    raise notice 'Policy authenticated: LENGKAP di semua tabel.';
  else
    raise notice 'Policy authenticated: GAGAL di -> %', tanpa_policy;
  end if;

  if anon_fungsi is null then
    raise notice 'Fungsi untuk anon   : TIDAK ADA.';
  else
    raise notice 'Fungsi untuk anon   : MASIH ADA -> %', anon_fungsi;
  end if;

  if view_unsafe is null then
    raise notice 'View tanpa pengaman : TIDAK ADA.';
  else
    raise notice 'View tanpa pengaman : MASIH ADA -> %', view_unsafe;
  end if;

  if tanpa_rls is null and tanpa_policy is null and anon_fungsi is null and view_unsafe is null then
    raise notice '';
    raise notice 'STATUS: BERHASIL. Database sudah tertutup.';
  else
    raise notice '';
    raise notice 'STATUS: BELUM SEMPURNA. Baca baris GAGAL di atas.';
  end if;
end $$;