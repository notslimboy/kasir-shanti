import { SUPABASE_URL, headerRest } from "@/supabase/client";
import type { SalePaymentRow, SaleRow } from "@/supabase/types";
import { penyesuaianDeposit, sisaPiutang } from "./piutang";

/* ==========================================================================
   Menulis piutang ke Supabase.

   Dua operasi, sama seperti versi lama:

     catatPembayaranPiutang  → menambah `sale_payments` + menaikkan
                                `sales.paid_amount` sebesar sisa yang tertangani
     batalkanLunasPiutang    → menghapus `sale_payments` struk itu, mengembalikan
                                `paid_amount` ke 0, dan reversing efek deposit

   Dua aturan yang WAJIB dijaga, karena keduanya menentukan saldo deposit:

   1. Yang masuk `sale_payments` adalah nominal yang DIKETIK, bukan sisa.
      Kalau kasir bayar Rp 120.000 untuk sisa Rp 100.000, `paid_amount` naik
      hanya 100.000 dan Rp 20.000 dicatat sebagai deposit customer.
   2. `paid_amount` tidak pernah boleh melebihi `total`. Struk yang sudah
      lunas tidak boleh menambah pembayaran — supaya tidak ada "utang negatif"
      yang tersembunyi di Piutang.

   Tulis memakai fetch langsung ke PostgREST, sama seperti lib/supabase-tulis.ts,
   karena supabase-js di sini hanya dipakai untuk SELECT.
   ========================================================================== */

export type HasilPiutang =
  | { ok: true; /** Sisa tagihan setelah pembayaran ini. */ sisa: number; /** Uang yang masuk deposit. */ deposit: number }
  | { ok: false; pesan: string };

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

function headersTulis(): Record<string, string> {
  return { ...headerRest(), "Content-Type": "application/json", Prefer: "return=representation" };
}

async function ambilStruk(saleId: number): Promise<SaleRow> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/sales`);
  url.searchParams.set("select", "id,total,paid_amount,customer_name,receipt_no");
  url.searchParams.set("id", `eq.${saleId}`);
  const r = await fetch(url, { headers: headerRest() });
  if (!r.ok) throw new Error(`sales: HTTP ${r.status}`);
  const rows = (await r.json()) as SaleRow[];
  if (!rows[0]) throw new Error("Transaksi tidak ditemukan di server.");
  return rows[0];
}

/**
 * Tambah deposit customer. Customer yang belum ada di tabel customers ikut
 * dibuat — versi lama juga begitu, karena struk bisa punya nama yang belum
 * pernah masuk daftar.
 */
async function tambahDeposit(nama: string, jumlah: number): Promise<void> {
  if (!nama || jumlah <= 0) return;

  const cari = new URL(`${SUPABASE_URL}/rest/v1/customers`);
  cari.searchParams.set("select", "id,deposit_balance");
  cari.searchParams.set("name", `eq.${nama}`);
  cari.searchParams.set("limit", "1");
  const r = await fetch(cari, { headers: headerRest() });
  if (!r.ok) throw new Error(`customers: HTTP ${r.status}`);
  const rows = (await r.json()) as { id: number; deposit_balance: number }[];

  if (rows[0]) {
    await patch(`customers?id=eq.${rows[0].id}`, {
      deposit_balance: n(rows[0].deposit_balance) + jumlah,
      updated_at: new Date().toISOString(),
    });
    return;
  }
  const buat = await fetch(`${SUPABASE_URL}/rest/v1/customers`, {
    method: "POST",
    headers: headersTulis(),
    body: JSON.stringify({ name: nama, deposit_balance: jumlah, last_order_at: "" }),
  });
  if (!buat.ok) throw new Error(`customers: HTTP ${buat.status}`);
}

async function patch(path: string, body: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: headersTulis(),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gagal menyimpan ke server (${r.status}).`);
}

/**
 * Catat pembayaran (penuh maupun cicilan).
 *
 * `amount` adalah nominal yang diketik kasir, BUKAN sisa tagihan. Nominal itu
 * dipotong dulu untuk pembayaran, sisanya masuk deposit.
 */
export async function catatPembayaranPiutang(
  saleId: number,
  amount: number,
  note = "Pembayaran cicilan manual",
): Promise<HasilPiutang> {
  const nominal = Math.floor(n(amount));
  if (nominal <= 0) return { ok: false, pesan: "Nominal pembayaran tidak valid." };

  try {
    const sale = await ambilStruk(saleId);
    const sisaSebelum = sisaPiutang(sale);
    if (sisaSebelum <= 0) return { ok: false, pesan: "Transaksi ini sudah lunas." };

    /* Berapa yang benar-benar mengurangi utang, dan sisanya jadi deposit. */
    const untukUtang = Math.min(nominal, sisaSebelum);
    const untukDeposit = nominal - untukUtang;

    /* Catatan pembayaran menyimpan KEJADIAN, bukan sisa. Kalau yang ditulis
       cuma sisa, riwayat pembayaran jadi tidak bisa menjelaskan deposit —
       dan pembatalan tidak akan bisa menghitung penyesuaiannya. */
    const catatan = untukDeposit > 0
      ? `${note}: Bayar Rp ${nominal.toLocaleString("id-ID")} (Kelebihan Rp ${untukDeposit.toLocaleString("id-ID")} masuk deposit)`
      : note;

    const insert = await fetch(`${SUPABASE_URL}/rest/v1/sale_payments`, {
      method: "POST",
      headers: headersTulis(),
      body: JSON.stringify({
        sale_id: saleId,
        amount: nominal,
        payment_date: new Date().toISOString(),
        note: catatan,
      }),
    });
    if (!insert.ok) throw new Error(`sale_payments: HTTP ${insert.status}`);

    await patch(`sales?id=eq.${saleId}`, { paid_amount: n(sale.paid_amount) + untukUtang });
    await tambahDeposit(String(sale.customer_name ?? ""), untukDeposit);

    return { ok: true, sisa: Math.max(0, sisaSebelum - untukUtang), deposit: untukDeposit };
  } catch (e) {
    return { ok: false, pesan: (e as Error).message };
  }
}

/** Kembalikan transaksi ke "Belum lunas": hapus riwayat + reversing deposit. */
export async function batalkanLunasPiutang(saleId: number): Promise<HasilPiutang> {
  try {
    const sale = await ambilStruk(saleId);

    const payments = new URL(`${SUPABASE_URL}/rest/v1/sale_payments`);
    payments.searchParams.set("select", "id,amount,note");
    payments.searchParams.set("sale_id", `eq.${saleId}`);
    const r = await fetch(payments, { headers: headerRest() });
    if (!r.ok) throw new Error(`sale_payments: HTTP ${r.status}`);
    const baris = (await r.json()) as SalePaymentRow[];

    /* Deposit dikoreksi DULUAN. Kalau hapus pembayaran berhasil lalu update
       deposit gagal, customer kehilangan Rp-nya tanpa ada jejaknya — dan
       pembatalan tidak bisa diulang karena riwayatnya sudah hilang. */
    const adjust = penyesuaianDeposit(baris);
    if (adjust !== 0) await geserDeposit(String(sale.customer_name ?? ""), adjust);

    const hapus = await fetch(`${SUPABASE_URL}/rest/v1/sale_payments?sale_id=eq.${saleId}`, {
      method: "DELETE",
      headers: headerRest(),
    });
    if (!hapus.ok) throw new Error(`sale_payments: HTTP ${hapus.status}`);

    await patch(`sales?id=eq.${saleId}`, { paid_amount: 0 });

    const total = n(sale.total);
    return { ok: true, sisa: total, deposit: 0 };
  } catch (e) {
    return { ok: false, pesan: (e as Error).message };
  }
}

/**
 * Geser saldo deposit. Posisi = bertambah, negatif = berkurang, dan saldo
 * tidak pernah boleh turun di bawah nol.
 *
 * Customer yang tidak ada dilewati diam-diam, bukan digagalkan: pembatalan
 * lunas TIDAK boleh gagal hanya karena nama customer belum masuk tabel
 * customers.
 */
async function geserDeposit(nama: string, posisi: number): Promise<void> {
  if (!nama || posisi === 0) return;
  const cari = new URL(`${SUPABASE_URL}/rest/v1/customers`);
  cari.searchParams.set("select", "id,deposit_balance");
  cari.searchParams.set("name", `eq.${nama}`);
  cari.searchParams.set("limit", "1");
  const r = await fetch(cari, { headers: headerRest() });
  if (!r.ok) throw new Error(`customers: HTTP ${r.status}`);
  const rows = (await r.json()) as { id: number; deposit_balance: number }[];
  if (!rows[0]) return;
  await patch(`customers?id=eq.${rows[0].id}`, {
    deposit_balance: Math.max(0, n(rows[0].deposit_balance) + posisi),
    updated_at: new Date().toISOString(),
  });
}