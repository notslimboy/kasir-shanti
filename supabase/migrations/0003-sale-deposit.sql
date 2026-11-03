/* ==========================================================================
   0003 — Deposit dipakai saat transaksi.

   Kolom `deposit_used` mencatat nominal deposit customer yang dipotong
   otomatis pada struk ini. Nilainya ≤ total dan ≤ saldo deposit saat
   transaksi. Struk tanpa potongan deposit memiliki nilai 0.
   ========================================================================== */

alter table public.sales add column if not exists deposit_used integer not null default 0;