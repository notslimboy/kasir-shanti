import { headerRest, SUPABASE_URL } from "@/supabase/client";
import type { PesananImpor } from "./impor-pesanan";
import type { SaleItemRow, SaleRow } from "@/supabase/types";

/* ==========================================================================
   Menyimpan hasil import ke Supabase.

   Urutan penulisan: sales dulu (supaya dapat id), lalu sale_items-nya. Kalau
   sale_items lebih dulu, tidak ada sale_id yang bisa dirujuk.

   TANGGAL STRUK = HARI PROSES, bukan tanggal chat.

   Ini bukan pilihan kosmetik. Dashboard Penjualan terbuka di tab "Harian",
   yaitu hari ini, jadi struk yang memakai tanggal chat (mis. 24 Sep, diimpor
   2 Okt) tidak akan pernah terlihat di sana — dan kasir menyimpulkan datanya
   hilang padahal sebenarnya tersimpan. Versi lama sudah begitu:
   buildSalePayloadFromDraft(draft, new Date()) memakai waktu proses,
   sementara tanggal chat disimpan terpisah di kolom chat_date dan tetap
   dicetak sebagai keterangan pada struk. Jadi informasinya tidak hilang,
   hanya pindah ke kolom yang memang untuk itu.

   Nomor struk dibuat berurutan per hari proses, format SH-YYYYMMDD-NNNN —
   sama seperti aplikasi lama. Penomoran dihitung dari nomor terbesar yang
   sudah ada pada tanggal itu, lalu naik di dalam memori untuk pesanan
   berikutnya, jadi satu file berisi 20 pesanan tidak menghasilkan nomor
   yang sama dua kali.
   ========================================================================== */

const NAMA_TOKO = "Shanti Catering";

export type HasilSimpanPesanan = {
  tersimpan: number;
  gagal: number;
  pesan: string[];
  /* Struk yang benar-benar tersimpan, untuk "Proses + Cetak Semua".
     Hanya berisi struk yang itemnya ikut tersimpan — mencetak struk
     tanpa item hanya menghasilkan kertas yang salah. */
  struk: { receiptNo: string; queueNo: number; pesanan: PesananImpor }[];
  /** Tanggal proses yang dipakai semua struk pada batch ini (YYYY-MM-DD). */
  tanggalProses: string;
};

async function nomorStrukBerikutnya(tanggal: string): Promise<number> {
  const prefix = `SH-${tanggal.replace(/-/g, "")}-`;
  const url = new URL(`${SUPABASE_URL}/rest/v1/sales`);
  url.searchParams.set("select", "receipt_no");
  url.searchParams.set("receipt_no", `like.${prefix}%`);
  url.searchParams.set("order", "receipt_no.desc");
  url.searchParams.set("limit", "1");

  const r = await fetch(url, { headers: headerRest() });
  if (!r.ok) return 1;
  const data = (await r.json()) as SaleRow[];
  const terakhir = data[0]?.receipt_no ?? "";
  const n = Number.parseInt(terakhir.replace(prefix, ""), 10);
  return Number.isFinite(n) ? n + 1 : 1;
}

/** Nomor antrean terbesar yang sudah terpakai pada tanggal proses. */
async function nomorAntreanTerakhir(tanggal: string): Promise<number> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/sales`);
  url.searchParams.set("select", "queue_no");
  url.searchParams.set("queue_date", `eq.${tanggal}`);
  url.searchParams.set("order", "queue_no.desc");
  url.searchParams.set("limit", "1");
  const r = await fetch(url, { headers: headerRest() });
  if (!r.ok) return 0;
  const data = (await r.json()) as Pick<SaleRow, "queue_no">[];
  return Number(data[0]?.queue_no ?? 0) || 0;
}

/** Satu sale_item: kolom yang diisi harus sesuai skema nyata. */
function itemRow(saleId: number, it: PesananImpor["items"][number]): Omit<SaleItemRow, "id"> {
  const label = it.varian && it.varian.toLowerCase() !== "normal" ? ` (${it.varian})` : "";
  return {
    sale_id: saleId,
    sku: it.sku || "",
    name: `${it.nama}${label}`,
    price: it.harga,
    quantity: it.qty,
    line_total: it.qty * it.harga,
    note: it.catatan,
    product_client_id: "",
    variant_client_id: "",
    menu_name: it.nama,
    variant_name: it.varian,
    unit_name: "",
    unit_quantity: null,
    pricing_type: "fixed",
    receipt_label: "",
  };
}

/** "2026-10-02" waktu lokal kasir — sama dengan keyTanggalPisah di
 *  simpan-penjualan.ts. UTC akan bergeser sehari untuk orderan yang
 *  masuk lewat malam. */
function tanggalProses(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function simpanPesananImpor(
  daftar: PesananImpor[],
  options: {
    /** Nomor urut draft pertama (input "Nomor awal"). Dipakai untuk queue_no. */
    mulaiNo?: number;
    /** Dipanggil tiap struk selesai diproses, untuk status di layar. */
    onProgress?: (selesai: number, total: number) => void;
  } = {},
): Promise<HasilSimpanPesanan> {
  const pesan: string[] = [];
  let tersimpan = 0;
  let gagal = 0;

  /* Satu batch = satu waktu proses. Semua struk dalam batch ini memakai
     tanggal dan jam proses yang sama, jadi `diproses` dihitung sekali di
     luar loop — kalau dihitung per struk, batch yang melintasi tengah
     malam akan pecah jadi dua tanggal dan nomor struk-nya melompat. */
  const diproses = new Date();
  const prosesIso = diproses.toISOString();
  const tanggal = tanggalProses();

  const total = daftar.length;
  let selesai = 0;
  options.onProgress?.(0, total);

  /* Nomor struk dihitung sekali, lalu dilanjutkan di dalam memori —
     supaya struk kedua tidak menebak lagi dari server. */
  let urut = 1;
  try {
    urut = await nomorStrukBerikutnya(tanggal);
  } catch {
    urut = 1;
  }

  /* Nomor antrean (NO pada struk & KOT Dapur) lanjut dari yang sudah
     dipakai hari ini, tapi tidak pernah lebih kecil dari "Nomor awal".
     Versi lama memakai nomor yang diketik kasir apa adanya; floor di sini
     mencegah nomor antrean bentrok dengan struk yang dicetak lewat Kasir
     di hari yang sama, karena KOT mengelompokkan per (tanggal, no). */
  let antrean = 0;
  try {
    antrean = Math.max(await nomorAntreanTerakhir(tanggal), (options.mulaiNo ?? 1) - 1);
  } catch {
    antrean = Math.max(0, (options.mulaiNo ?? 1) - 1);
  }

  const struk: { receiptNo: string; queueNo: number; pesanan: PesananImpor }[] = [];

  for (const p of daftar) {
    if (!p.tanggal || p.items.length === 0) {
      gagal++;
      pesan.push(`Pesanan di baris CSV ${p.baris} dilewati: tanggal tidak terbaca atau tidak ada item.`);
      selesai++;
      options.onProgress?.(selesai, total);
      continue;
    }

    const no = urut++;
    const receiptNo = `SH-${tanggal.replace(/-/g, "")}-${String(no).padStart(4, "0")}`;
    const queueNo = ++antrean;

    const sale: Omit<SaleRow, "id"> = {
      receipt_no: receiptNo,
      /* Waktu proses, bukan tanggal chat — supaya struk langsung muncul di
         Dashboard Penjualan yang terbuka di tab "Harian" (= hari ini).
         Tanggal chat tetap tersimpan di chat_date dan tetap dicetak. */
      completed_at: prosesIso,
      store_name: NAMA_TOKO,
      payment: p.payment,
      subtotal: p.subtotal,
      /* Kolom diskon = ongkir, sama seperti versi lama dan simpan-penjualan.
         Pembacaan ongkir memakai total − subtotal, jadi angka ini hanya
         salinan supaya laporan lama & cetakan lama tidak berubah artinya. */
      discount: p.ongkir,
      tax: 0,
      total: p.total,
      customer_name: p.customer,
      customer_address: "",
      order_note: "",
      due_text: "",
      chat_date: p.tanggal,
      deleted_at: null,
      stock_restored_on_delete: 0,
      paid_amount: p.total,
      created_at: prosesIso,
      queue_no: queueNo,
      queue_date: tanggal,
      send_note: p.sendNote,
    };

    const url = new URL(`${SUPABASE_URL}/rest/v1/sales`);
    url.searchParams.set("select", "id");
    /* Content-Type wajib: headerRest() hanya untuk GET, dan tanpa header ini
       fetch mengirim body string sebagai text/plain — PostgREST menolak
       dengan 400 "Content-Type not acceptable". */
    const headers = { ...headerRest(), "Content-Type": "application/json", Prefer: "return=representation" };
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(sale) });
    if (!r.ok) {
      gagal++;
      pesan.push(`${receiptNo}: gagal menyimpan struk (${r.status}) — ${(await r.text()).slice(0, 120)}`);
      selesai++;
      options.onProgress?.(selesai, total);
      continue;
    }
    const data = (await r.json()) as { id: number }[];
    const id = data[0]?.id;
    if (!id) {
      gagal++;
      pesan.push(`${receiptNo}: struk tersimpan tapi id-nya tidak dikembalikan.`);
      selesai++;
      options.onProgress?.(selesai, total);
      continue;
    }

    const itemsUrl = new URL(`${SUPABASE_URL}/rest/v1/sale_items`);
    const ir = await fetch(itemsUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(p.items.map((it) => itemRow(id, it))),
    });
    if (!ir.ok) {
      /* Struk sudah ada tapi itemnya tidak: itu lebih buruk daripada gagal
         total, karena struk akan tampil dengan total yang tidak bisa
         dijelaskan. Diberi tahu eksplisit, bukan diam-diam. */
      gagal++;
      pesan.push(`${receiptNo}: struk tersimpan, tetapi item GAGAL (${ir.status}) — hapus struk ini sebelum dipakai.`);
      tersimpan++;
      selesai++;
      options.onProgress?.(selesai, total);
      continue;
    }

    tersimpan++;
    /* queueNo ikut dikembalikan: yang dicetak setelah simpan harus memakai
       nomor yang BENAR-BENAR tersimpan di server, bukan perkiraan
       "mulaiNo + urutan" — kalau hari itu sudah ada struk dari Kasir,
       nomor antrean meloncat dan nomor di kertas jadi tidak cocok dengan
       KOT Dapur. */
    struk.push({ receiptNo, queueNo, pesanan: p });
    selesai++;
    options.onProgress?.(selesai, total);
  }

  return { tersimpan, gagal, pesan, struk, tanggalProses: tanggal };
}
