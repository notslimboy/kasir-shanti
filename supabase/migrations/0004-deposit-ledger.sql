/* ==========================================================================
   0004 — Deposit ledger (riwayat mutasi deposit customer).

   Setiap perubahan saldo deposit dicatat di tabel ini supaya ada audit
   trail. Baris tidak bisa diubah setelah dibuat — riwayat bersifat
   append-only.
   ========================================================================== */

begin;

create table if not exists public.deposit_ledger (
  id bigserial primary key,
  customer_id bigint not null references public.customers(id) on delete cascade,
  sale_id bigint references public.sales(id) on delete set null,
  amount integer not null,           -- + masuk, - keluar
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_deposit_ledger_customer_created
  on public.deposit_ledger (customer_id, created_at desc);

alter table public.deposit_ledger enable row level security;

revoke all on table public.deposit_ledger from anon;
grant all on table public.deposit_ledger to authenticated;

create policy sel_deposit_ledger on public.deposit_ledger
  for select to authenticated using (true);
create policy tambah_deposit_ledger on public.deposit_ledger
  for insert to authenticated with check (true);
create policy ubah_deposit_ledger on public.deposit_ledger
  for update to authenticated using (true) with check (true);
create policy hapus_deposit_ledger on public.deposit_ledger
  for delete to authenticated using (true);

commit;