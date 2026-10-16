import { headerRest, SUPABASE_URL } from "@/supabase/client";
import type { CustomerRow, SaleItemRow, SaleRow } from "@/supabase/types";

/* ==========================================================================
   Menyimpan satu transaksi dari halaman Kasir.

   Port dari saveSaleToSupabase (script.js:7400). Urutannya penting:
   sales dulu supaya dapat id, baru sale_items-nya yang menunjuk id itu.
   Kalau dibalik, sale_items tidak punya sale_id yang bisa dirujuk.

   Dua hal yang sengaja meniru versi lama:
   - Kolom `discount` diisi dengan ONGKIR, bukan potongan harga. Versi lama
     menulis `discount: totals.shipping` dan membacanya kembali lewat
     getSaleShipping (`sale.shipping || sale.discount`). 1.000 struk nyata
     juga uphold: discount selalu sama dengan total − subtotal.
   - Nomor struk berurutan per hari, SH-YYYYMMDD-NNNN.
   ========================================================================== */

const NAMA_TOKO = "Shanti Catering";

export type BarisJual = {
  productClientId: string;
  variantClientId: string;
  menuName: string;
  variantName: string;
  name: string;
  price: number;
  qty: number;
  note: string;
  /** true kalau baris ini tidak boleh mengurangi stok (barang tak terbatas). */
  tanpaBatas?: boolean;
};

export type PayloadJual = {
  customer: string;
  payment: string;
  items: BarisJual[];
  ongkir: number;
  diskon: number;
  note: string;
  sendNote: string;
  /** Waktu transaksi; default sekarang. */
  completedAt?: Date;
};

export type HasilJual = {
  id: number;
  receiptNo: string;
  queueNo: number;
  /** Data struk siap dicetak. */
  struk: {
    receiptNo: string;
    queueNo: number;
    customer: string;
    payment: string;
    chatDate: string;
    sendNote: string;
    subtotal: number;
    shipping: number;
    discount: number;
    total: number;
    items: { name: string; variant: string; qty: number; price: number; lineTotal: number; note: string }[];
  };
};

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v ?? 0) || 0);

/** Subtotal dari baris keranjang — dihitung ulang di server-side fashion,
    bukan memakai angka yang dikirim, supaya tidak bisa melenceng. */
export function subtotalDari(items: BarisJual[]): number {
  return items.reduce((a, it) => a + n(it.price) * n(it.qty), 0);
}

const keyTanggal = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const keyTanggalPisah = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Nomor struk berikutnya untuk tanggal itu, dihitung dari nomor terbesar
    yang sudah ada — bukan dari jumlah baris, supaya struk yang pernah
    dihapus tidak membuat nomor terpakai ulang. */
export async function nomorStrukBerikutnya(tanggal: Date): Promise<string> {
  const prefix = `SH-${keyTanggal(tanggal)}-`;
  const url = new URL(`${SUPABASE_URL}/rest/v1/sales`);
  url.searchParams.set("select", "receipt_no");
  url.searchParams.set("receipt_no", `like.${prefix}%`);
  url.searchParams.set("order", "receipt_no.desc");
  url.searchParams.set("limit", "1");
  const r = await fetch(url, { headers: headerRest() });
  if (!r.ok) return `${prefix}0001`;
  const data = (await r.json()) as SaleRow[];
  const terakhir = data[0]?.receipt_no ?? "";
  const berikutnya = Number.parseInt(terakhir.replace(prefix, ""), 10);
  return `${prefix}${String(Number.isFinite(berikutnya) ? berikutnya + 1 : 1).padStart(4, "0")}`;
}

/** Nomor antrean untuk tanggal itu, dipakai KOT Dapur. */
export async function nomorAntreanBerikutnya(tanggal: Date): Promise<number> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/sales`);
  url.searchParams.set("select", "queue_no");
  url.searchParams.set("queue_date", `eq.${keyTanggalPisah(tanggal)}`);
  url.searchParams.set("order", "queue_no.desc");
  url.searchParams.set("limit", "1");
  const r = await fetch(url, { headers: headerRest() });
  if (!r.ok) return 1;
  const data = (await r.json()) as Pick<SaleRow, "queue_no">[];
  const terbesar = n(data[0]?.queue_no);
  return terbesar + 1;
}

/** Bentuk satu baris `sale_items`.

    Dipakai dua jalur tulis: `simpanPenjualan` (transaksi baru dari Kasir) dan
    `ubahStruk` (item yang ditambahkan saat struk lama diedit). Satu tempat
    supaya baris hasil edit tidak berbeda bentuk dengan baris hasil transaksi
    baru — nama yang dicetak, `menu_name`, dan `variant_name` dihitung dengan
    aturan yang sama. */
export function itemRow(saleId: number, it: BarisJual): Omit<SaleItemRow, "id"> {
  const label = it.variantName && it.variantName.toLowerCase() !== "normal" ? ` (${it.variantName})` : "";
  return {
    sale_id: saleId,
    sku: "",
    name: `${it.menuName || it.name}${label}`,
    price: n(it.price),
    quantity: n(it.qty),
    line_total: n(it.price) * n(it.qty),
    note: it.note || "",
    product_client_id: it.productClientId || "",
    variant_client_id: it.variantClientId || "",
    menu_name: it.menuName || it.name,
    variant_name: it.variantName || "",
    unit_name: "",
    unit_quantity: null,
    pricing_type: "fixed",
    receipt_label: "",
  };
}

/** Kurangi stok barang yang terbatas. Errornya sengaja ditelan: transaksi
    sudah tersimpan, jadi gagal mengurangi stok bukan alasan membatalkan
    pembayaran — dan struk yang sudah tercetak tidak bisa ditarik. */
async function kurangiStok(items: BarisJual[]): Promise<void> {
  const jumlah: Record<string, number> = {};
  for (const it of items) {
    if (it.tanpaBatas || !it.productClientId) continue;
    jumlah[it.productClientId] = (jumlah[it.productClientId] ?? 0) + n(it.qty);
  }
  for (const [clientId, qty] of Object.entries(jumlah)) {
    if (qty <= 0) continue;
    const url = new URL(`${SUPABASE_URL}/rest/v1/products`);
    url.searchParams.set("client_id", `eq.${clientId}`);
    url.searchParams.set("stock_unlimited", "eq.0");
    const headers = { ...headerRest(), "Content-Type": "application/json", Prefer: "return=representation" };
    /* PostgREST tidak punya operasi "kurangi", jadi angka stok dibaca
       lebih dulu lalu ditulis ulang selisihnya. Satu kasir, jadi tidak
       perlu optimistic lock. */
    const baca = await fetch(url, { headers });
    if (!baca.ok) continue;
    const baris = (await baca.json()) as { client_id: string; stock: number }[];
    for (const b of baris) {
      await fetch(url, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ stock: Math.max(0, n(b.stock) - qty) }),
      });
    }
  }
}

/** Catat pesanan terakhir customer supaya "Ongkir lama customer terisi
    otomatis" di Kasir tidak kosong untuk pelanggan yang lama. */
async function sentuhCustomer(nama: string, ongkir: number, completedAt: Date): Promise<void> {
  const namaBersih = String(nama || "").trim();
  if (!namaBersih) return;
  const headers = { ...headerRest(), "Content-Type": "application/json", Prefer: "return=representation" };
  const url = new URL(`${SUPABASE_URL}/rest/v1/customers`);
  url.searchParams.set("name", `eq.${encodeURIComponent(namaBersih)}`);
  url.searchParams.set("select", "id,name,last_order_at,default_shipping");
  const cari = await fetch(url, { headers: headerRest() });
  if (!cari.ok) return;
  const ada = (await cari.json()) as CustomerRow[];
  const waktu = completedAt.toISOString();
  if (ada[0]) {
    const lebihBaru = !ada[0].last_order_at || waktu >= ada[0].last_order_at;
    await fetch(`${SUPABASE_URL}/rest/v1/customers?id=eq.${ada[0].id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(
        lebihBaru
          ? { default_shipping: ongkir, last_order_at: waktu, updated_at: waktu }
          : { updated_at: waktu },
      ),
    });
    return;
  }
  await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: namaBersih,
      default_shipping: ongkir,
      last_order_at: waktu,
      updated_at: waktu,
    }),
  });
}

/**
 * Simpan transaksi lengkap.
 *
 * Kalau sale_items gagal, struk yang sudah terlanjur tertulis DIHAPUS.
 * Struk tanpa item lebih berbahaya daripada transaksi gagal: totalnya
 * muncul di dashboard tanpa ada rinciannya, dan tidak bisa dijelaskan.
 */
export async function simpanPenjualan(payload: PayloadJual): Promise<HasilJual> {
  const items = payload.items.filter((it) => n(it.qty) > 0);
  if (!items.length) throw new Error("Keranjang masih kosong.");

  const completedAt = payload.completedAt ?? new Date();
  const tanggal = keyTanggalPisah(completedAt);
  const subtotal = subtotalDari(items);
  const ongkir = Math.max(0, n(payload.ongkir));
  const diskon = Math.max(0, n(payload.diskon));
  const total = Math.max(0, subtotal - diskon + ongkir);
  const receiptNo = await nomorStrukBerikutnya(completedAt);
  const queueNo = await nomorAntreanBerikutnya(completedAt);
  const headers = {
    ...headerRest(),
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const sale: Omit<SaleRow, "id"> = {
    receipt_no: receiptNo,
    completed_at: completedAt.toISOString(),
    store_name: NAMA_TOKO,
    payment: payload.payment || "Tunai",
    subtotal,
    /* Kolom diskon = ongkir, sama seperti versi lama. Pembacaan ongkir di
       aplikasi ini memakai total − subtotal, jadi angka ini hanya salinan
       supaya struk lama & laporan lama tidak berubah artinya. */
    discount: ongkir,
    tax: 0,
    total,
    customer_name: String(payload.customer || "").trim(),
    customer_address: "",
    order_note: payload.note || "",
    send_note: payload.sendNote || "",
    due_text: "",
    chat_date: tanggal,
    deleted_at: null,
    stock_restored_on_delete: 0,
    /* Struk baru lahir BELUM LUNAS. Sengaja tidak meniru versi lama yang
       menulis `paid_amount: total` di sini: pelunasan dicatat di halaman
       Piutang, dan struk yang lahir sudah "Lunas" membuat piutang kemarin
       lenyap begitu struk hari ini dibuat — tidak ada lagi yang tahu mana
       yang benar-benar sudah dibayar. Mengubah ini berarti mengubah arti
       angka di seluruh laporan, jadi jangan "diperbaiki" balik. */
    paid_amount: 0,
    created_at: completedAt.toISOString(),
    queue_no: queueNo,
    queue_date: tanggal,
  };

  const r = await fetch(`${SUPABASE_URL}/rest/v1/sales`, {
    method: "POST",
    headers,
    body: JSON.stringify(sale),
  });
  if (!r.ok) {
    throw new Error(`Gagal menyimpan struk (${r.status}): ${(await r.text()).slice(0, 160)}`);
  }
  const data = (await r.json()) as { id: number }[];
  const id = data[0]?.id;
  if (!id) throw new Error("Struk tersimpan tapi id-nya tidak dikembalikan.");

  const ir = await fetch(`${SUPABASE_URL}/rest/v1/sale_items`, {
    method: "POST",
    headers,
    body: JSON.stringify(items.map((it) => itemRow(id, it))),
  });
  if (!ir.ok) {
    await fetch(`${SUPABASE_URL}/rest/v1/sales?id=eq.${id}`, { method: "DELETE", headers });
    throw new Error(`Item struk gagal disimpan (${ir.status}) — struk dibatalkan, jadi tidak ada struk tanpa item.`);
  }

  await kurangiStok(items);
  await sentuhCustomer(payload.customer, ongkir, completedAt);

  return {
    id,
    receiptNo,
    queueNo,
    struk: {
      receiptNo,
      queueNo,
      customer: String(payload.customer || "").trim(),
      payment: payload.payment || "Tunai",
      chatDate: tanggal,
      sendNote: payload.sendNote || "",
      subtotal,
      shipping: ongkir,
      discount: diskon,
      total,
      items: items.map((it) => ({
        name: it.menuName || it.name,
        variant: it.variantName || "",
        qty: n(it.qty),
        price: n(it.price),
        lineTotal: n(it.price) * n(it.qty),
        note: it.note || "",
      })),
    },
  };
}