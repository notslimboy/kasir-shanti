import { SUPABASE_URL, headerRest } from "@/supabase/client";
import type { SaleItemRow, SalePaymentRow, SaleRow } from "@/supabase/types";

/* ==========================================================================
   Catatan Piutang — baca & aturanhitungnya.

   Piutang tidak punya tabelnya sendiri. Yang ada adalah struk: `total` adalah
   tagihan, `paid_amount` adalah yang sudah dibayar, dan selisihnya adalah
   yang masih owed. Tabel `sale_payments` menyimpan riwayat cicilannya.

   Mekanisme ini disalin dari versi lama (script.js) dengan bentuk yang sama:
     - sisa = total − paid_amount, dan sisa <= 0 berarti LUNAS
     - pembayaran dicatat SELALU penuh: sisa dipotong dari nominal yang
       diketik, dan kelebihannya otomatis masuk deposit customer
     - "Belum lunas" menghapus seluruh riwayat pembayaran struk itu dan
       mengembalikan efek depositnya

   Fungsi di sini murni (tanpa jaringan) supaya bisa diuji; yang menyentuh
   PostgREST hanya `ambilDetailPiutang`.
   ========================================================================== */

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

export type StatusPiutang = "belum" | "sebagian" | "lunas" | "terhapus";

/** Sisa tagihan. Struk terhapus tetap ikut dihitung di caller, bukan di sini. */
export function sisaPiutang(s: Pick<SaleRow, "total" | "paid_amount">): number {
  return n(s.total) - n(s.paid_amount);
}

/**
 * Status piutang.
 *
 * `total` 0 bukan "lunas": struk tanpa nilai (mis. impor yang totalnya kosong)
 * tidak boleh tampil sudah lunas hanya karena paid_amount ikut 0.
 */
export function statusPiutang(s: Pick<SaleRow, "deleted_at" | "total" | "paid_amount">): StatusPiutang {
  if (s.deleted_at) return "terhapus";
  const sisa = sisaPiutang(s);
  if (sisa <= 0 && n(s.total) > 0) return "lunas";
  return n(s.paid_amount) > 0 ? "sebagian" : "belum";
}

export type BarisPiutang = {
  saleId: number;
  customer: string;
  tag: string;
  invoice: string;
  /** YYYY-MM-DD waktu transaksi. */
  date: string;
  total: number;
  paid: number;
  sisa: number;
  status: StatusPiutang;
  courier: string;
  /** Umur tagihan dalam hari — dipakai untuk "lewat jatuh tempo". */
  umurHari: number;
};

/**
 * Filter daftar: tab + pencarian.
 *
 * Pencarian versi lama mencocokkan NAMA customer DAN nomor struk, jadi kasir
 * tidak perlu tahu struk itu milik siapa untuk mengecek pembayarannya.
 */
export function filterPiutang(
  baris: BarisPiutang[],
  tab: string,
  q: string,
): BarisPiutang[] {
  const cari = q.trim().toLowerCase();
  return baris.filter((b) => {
    if (tab === "belum" && b.status === "lunas") return false;
    if (tab === "lunas" && b.status !== "lunas") return false;
    if (!cari) return true;
    return b.customer.toLowerCase().includes(cari) || b.invoice.toLowerCase().includes(cari);
  });
}

/** Total outstanding = sisa SELURUH struk hidup, bukan hanya tab aktif. */
export function totalSisaPiutang(baris: BarisPiutang[]): number {
  return baris
    .filter((b) => b.status !== "lunas" && b.status !== "terhapus")
    .reduce((a, b) => a + b.sisa, 0);
}

/**
 * Seberapa besar saldo deposit customer harus dikoreksi saat satu struk
 * dikembalikan jadi "Belum lunas".
 *
 * Dua sumbernya:
 *   - pembayaran ber-note "Otomatis Potong Deposit" — uang yang sebelumnya
 *     diambil dari deposit, jadi harus dikembalikan ke deposit
 *   - pembayaran yang catatannya menyebut "Kelebihan Rp ..." — kelebihan itu
 *     pernah MASUK deposit, jadi harus dikeluarkan lagi
 *
 * Angka positif = deposit bertambah.
 */
export function penyesuaianDeposit(
  payments: Pick<SalePaymentRow, "amount" | "note">[],
): number {
  let adjust = 0;
  for (const p of payments) {
    const note = p.note || "";
    const amount = n(p.amount);
    if (note === "Otomatis Potong Deposit") {
      adjust += amount;
      continue;
    }
    if (!note.includes("Kelebihan Rp")) continue;
    /* Catatan ditulis dengan format id-ID ("Kelebihan Rp 12.500"), jadi
       pemisahnya harus dibuang dulu sebelum dibaca sebagai angka. */
    const match = note.replace(/\./g, "").replace(/,/g, "").match(/Kelebihan Rp\s*(\d+)/);
    if (match) adjust -= parseInt(match[1], 10);
  }
  return adjust;
}

/** "50.000" atau "50,000" -> 50000. Teks lain dianggap 0. */
export function keNominal(teks: string): number {
  const bersih = String(teks ?? "").replace(/[^\d]/g, "");
  const v = parseInt(bersih, 10);
  return Number.isFinite(v) ? v : 0;
}

/** Tampilan input nominal: kelompok ribuan id-ID tanpa prefiks. */
export function formatNominal(v: number): string {
  return new Intl.NumberFormat("id-ID").format(Math.max(0, n(v)));
}

/* -------------------------------------------------------------------------
   Detail struk untuk modal: alamat, item, riwayat pembayaran.
   Dipanggil per struk saat detailnya dibuka — bukan untuk seluruh daftar,
   supaya tabel berisi ratusan baris tidak ikut menarik ribuan baris item.
   ---------------------------------------------------------------------- */

export type DetailPiutang = {
  address: string;
  items: SaleItemRow[];
  payments: SalePaymentRow[];
};

async function ambilSatu<T>(tabel: string, pilih: string, id: number): Promise<T[]> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${tabel}`);
  url.searchParams.set("select", pilih);
  url.searchParams.set("id", `eq.${id}`);
  const r = await fetch(url, { headers: headerRest() });
  if (!r.ok) throw new Error(`${tabel}: HTTP ${r.status}`);
  return (await r.json()) as T[];
}

export async function ambilDetailPiutang(saleId: number): Promise<DetailPiutang> {
  const sale = await ambilSatu<SaleRow>("sales", "id,customer_address", saleId);

  const items = new URL(`${SUPABASE_URL}/rest/v1/sale_items`);
  items.searchParams.set("select", "id,sale_id,sku,name,price,quantity,line_total,note,variant_name,receipt_label,menu_name");
  items.searchParams.set("sale_id", `eq.${saleId}`);
  items.searchParams.set("order", "id.asc");

  const payments = new URL(`${SUPABASE_URL}/rest/v1/sale_payments`);
  payments.searchParams.set("select", "id,sale_id,amount,payment_date,note,created_at");
  payments.searchParams.set("sale_id", `eq.${saleId}`);
  payments.searchParams.set("order", "payment_date.asc");

  const [ri, rp] = await Promise.all([
    fetch(items, { headers: headerRest() }).then(async (r) => {
      if (!r.ok) throw new Error(`sale_items: HTTP ${r.status}`);
      return (await r.json()) as SaleItemRow[];
    }),
    fetch(payments, { headers: headerRest() }).then(async (r) => {
      if (!r.ok) throw new Error(`sale_payments: HTTP ${r.status}`);
      return (await r.json()) as SalePaymentRow[];
    }),
  ]);

  return {
    address: String(sale[0]?.customer_address ?? ""),
    items: ri,
    payments: rp,
  };
}