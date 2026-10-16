import { headerRest, SUPABASE_URL } from "@/supabase/client";
import { rapikanCatatan } from "./catatan-item";
import { itemRow } from "./simpan-penjualan";
import { jelaskanGalatTulis, type GalatTulis, galatValidasi } from "./galat-tulis";

/** Sama seperti dipakai di seluruh lapisan data: angka null/undefined/NaN
 *  harus jadi 0, bukan membuat seluruh total NaN diam-diam. */
const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/* ==========================================================================
   Menulis struk ke Supabase.

   Empat operasi: ubah isi struk, hapus (void), restore, dan hapus permanen.

   Kenapa "hapus" itu SOFTWARE delete lewat `deleted_at`, bukan `DELETE FROM`:

   1. Reversibel. Salah hapus itu berarti satu struk hilang permanen beserta
      seluruh isinya, dan itu tidak bisa dikembalikan tanpa chat asal.
   2. App sudah punya tab "Terhapus" dan cara restore-nya, jadi pola soft
      delete ini bukan tambahan baru — cuma belum disambungkan dari UI.
   3. Angkanya tetap bisa ditelusuri: kartu KPI dan omset mengabaikan struk
      terhapus, tapi barisnya masih ada kalau perlu dicek.

   Hapus permanen (lihat di bawah file) satu-satunya yang memakai DELETE, dan
   hanya boleh jalan kalau struknya sudah berstatus terhapus.

   `stock_restored_on_delete` sengaja di-set 0 di kedua arah. Kolom itu
   penanda "stok sudah dikembalikan ke katalog", dan hapus struk di sini
   TIDAK menyentuh stok: stok produk dikelola batch harian yang terpisah,
   dan menyentuhinya dari sini akan mengembalikan jumlah dua kali.
   */

export type HasilTulis =
  | { ok: true }
  | {
      ok: false;
      /** Satu kalimat utuh, untuk pemanggil yang hanya butuh teks. */
      pesan: string;
      /** Bagian yang bisa ditampilkan sendiri oleh pemanggil. Opsional
       *  supaya pemanggil lama yang cuma baca `pesan` tetap jalan. */
      judul?: string;
      penjelasan?: string;
      langkah?: string;
      /** Kode dan pesan server apa adanya, untuk developer. */
      teknis?: string;
    };

async function patchStruk(id: number, body: Record<string, unknown>): Promise<HasilTulis> {
  const url = `${SUPABASE_URL}/rest/v1/sales?id=eq.${id}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      ...headerRest(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    return { ok: false, pesan: `Gagal menyimpan ke server (${r.status}).` };
  }
  /* PATCH tanpa filter yang cocok mengembalikan array kosong, bukan error.
     Kalau kosong, tidak ada yang berubah — dan itu harus dilaporkan, bukan
     dianggap berhasil. */
  const data = (await r.json()) as unknown[];
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, pesan: "Struk tidak ditemukan di server." };
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------
   Ubah isi struk

   Menulis `sales` dan `sale_items` untuk struk yang sudah ada. Dua hal yang
   bikin operasi ini rawan, dan keduanya ditangani di bawah:

   1. Baris item dicocokkan lewat `sale_items.id`, bukan nama + varian.
      Satu menu bisa muncul dua kali dalam struk yang sama dengan varian
      berbeda, dan begitu namanya diedit keduanya bisa sama persis.
   2. Mengubah qty atau harga mengubah total. `paid_amount` sengaja TIDAK
      ikut disentuh: kalau harga naik, `paid_amount < total` dan struk
      otomatis berubah jadi "Belum Lunas" — dan itu informasi yang harus
      dilihat kasir, bukan sesuatu yang dibetulkan diam-diam di sini.
      Panggilannya wajib memberi tahu kalau hal ini terjadi.
   ------------------------------------------------------------------------- */

export type BarisUbah = {
  /** id baris `sale_items`. Wajib untuk baris yang sudah ada; baris baru
   *  memakai 0 dan ditandai `baru: true`. */
  id: number;
  qty: number;
  price: number;
  note: string;
  /** true = baris yang baru ditambahkan di form Ubah Data. Baris baru
   *  di-INSERT ke `sale_items`, baris lama di-PATCH lewat `id`. Ditandai
   *  eksplisit, bukan disimpulkan dari id 0: struk yang itemnya tidak punya
   *  primary key (data contoh, fixture) juga ber-id 0 — dan menebaknya
   *  sebagai baris baru berarti menulis ulang seluruh struknya. */
  baru?: boolean;
  /** Hanya dipakai baris baru: yang di-INSERT butuh nama. Baris lama cukup
   *  id, karena PATCH tidak menyentuh nama. */
  name?: string;
  variant?: string;
  productClientId?: string;
  variantClientId?: string;
};

export type UbahStrukInput = {
  saleId: number;
  customer: string;
  sendNote: string;
  lines: BarisUbah[];
  /** Ongkir dan diskon tidak bisa diedit dari sini; dipakai untuk menghitung
   *  total yang sama seperti `simpanPenjualan`. */
  ongkir: number;
  diskon: number;
};

export type HasilUbah = {
  ok: boolean;
  pesan?: string;
  subtotal?: number;
  total?: number;
  /** True kalau total berubah cukup jauh sehingga status lunas ↔ belum ikut
   *  berubah. Panggilannya wajib memberi tahu kasir. */
  statusBerubah?: boolean;
  /** Baris yang dibuang karena qty-nya dikasih 0. */
  dibuang?: number;
};

/** Pisahkan baris form jadi tiga: yang ditambah, yang diperbarui, dan yang
 *  dibuang.
 *
 *  Baris qty 0 dibuang: struk dengan baris nol akan tercetak sia-sia dan
 *  tercatat di KOT sebagai pesanan yang tidak ada. Aturan itu berlaku sama
 *  untuk baris baru — item yang ditambahkan lalu qty-nya dinolkan tidak
 *  pernah sampai ke database. */
export function bagiBarisUbah(lines: BarisUbah[]): {
  disimpan: BarisUbah[];
  baru: BarisUbah[];
  dibuang: number;
} {
  const hidup = lines.filter((l) => Number(l.qty) > 0);
  const baru = hidup.filter((l) => l.baru === true);
  const disimpan = hidup.filter((l) => l.baru !== true);
  return { disimpan, baru, dibuang: lines.length - hidup.length };
}

export async function ubahStruk(input: UbahStrukInput): Promise<HasilUbah> {
  const { disimpan, baru, dibuang } = bagiBarisUbah(input.lines);

  /* Baris lama tanpa id berarti form-nya dibangun dari sumber yang tidak punya
     primary key. Menjalankan PATCH dengan `id=eq.undefined` akan menimpa
     baris acak, jadi berhenti di sini. Baris BARU tidak termasuk: yang
     di-INSERT tidak butuh id — hanya butuh nama. */
  const tanpaId = disimpan.filter((l) => !Number.isFinite(l.id) || l.id <= 0);
  if (tanpaId.length > 0) {
    return { ok: false, pesan: "Ada baris item tanpa id — muat ulang struk lalu coba lagi." };
  }
  const tanpaNama = baru.filter((l) => String(l.name ?? "").trim() === "");
  if (tanpaNama.length > 0) {
    return { ok: false, pesan: "Ada item baru tanpa nama — pilih menunya lagi." };
  }
  if (disimpan.length + baru.length === 0) {
    return {
      ok: false,
      pesan: "Semua item&qty 0. Struk tidak bisa disimpan kosong — batalkan struknya dari menu Penjualan.",
    };
  }

  const ditulis = [...disimpan, ...baru];
  const subtotal = ditulis.reduce((a, l) => a + Math.max(0, n(l.price)) * Math.max(0, n(l.qty)), 0);
  const total = Math.max(0, subtotal - Math.max(0, n(input.diskon)) + Math.max(0, n(input.ongkir)));

  /* Cek dulu total lama, supaya `statusBerubah` bisa dilaporkan dan PATCH
     tidak diam-diam menimpa `paid_amount`. */
  let totalLama = 0;
  let sudahLunas = false;
  try {
    const cek = await fetch(
      `${SUPABASE_URL}/rest/v1/sales?id=eq.${input.saleId}&select=total,paid_amount`,
      { headers: { ...headerRest(), Prefer: "return=representation" } },
    );
    if (cek.ok) {
      const baris = (await cek.json()) as { total: number; paid_amount: number }[];
      totalLama = n(baris[0]?.total);
      sudahLunas = n(baris[0]?.paid_amount) >= totalLama && totalLama > 0;
    }
  } catch {
    /* Gagal membaca tidak boleh memblokir penulisan; statusBerubah ditulis
       false dan pemanggil tetap menyimpan. */
  }
  const masihLunas = total > 0 && Math.max(totalLama, 0) > 0 && sudahLunas && total <= totalLama;

  try {
    /* 1. Header struk. `paid_amount` tidak disentuh — lihat catatan (2). */
    const hasilHeader = await patchStruk(input.saleId, {
      customer_name: String(input.customer || "").trim(),
      send_note: rapikanCatatan(String(input.sendNote ?? "")) ?? "",
      subtotal,
      total,
    });
    if (!hasilHeader.ok) return { ok: false, pesan: hasilHeader.pesan };

    /* 2. Baris yang dihapus (qty jadi 0). Dilakukan lebih dulu supaya tidak
          ada baris dengan qty 0 tertinggal kalau salah satu PATCH di bawah
          gagal — struk seperti itu tercetak sia-sia dan muncul di KOT. */
    const idDibuang = input.lines
      .filter((l) => !(Number(l.qty) > 0))
      .map((l) => l.id)
      .filter((id) => Number.isFinite(id) && id > 0);
    if (idDibuang.length > 0) {
      const hapus = await fetch(
        `${SUPABASE_URL}/rest/v1/sale_items?id=in.(${idDibuang.join(",")})`,
        { method: "DELETE", headers: { ...headerRest(), Prefer: "return=minimal" } },
      );
      if (!hapus.ok) {
        return { ok: false, pesan: `Gagal membuang item qty 0 (${hapus.status}).` };
      }
    }

    /* 3. Baris yang tersisa. Satu permintaan per baris: PostgREST tidak punya
          UPDATE per-id dalam satu panggilan, dan jumlah baris struk kecil. */
    for (const l of disimpan) {
      const harga = Math.max(0, n(l.price));
      const qty = Math.max(0, n(l.qty));
      const hasil = await patchItem([l.id], {
        quantity: qty,
        price: harga,
        line_total: harga * qty,
        /* `rapikanCatatan`, bukan `trim()`. Catatan item punya satu normalisasi
       di seluruh aplikasi — dipakai keranjang kasir juga — supaya "  bnyak "
       dan "bnyak" tidak menjadi dua isi berbeda di KOT dan struk. */
        note: rapikanCatatan(String(l.note ?? "")) ?? "",
      });
      if (!hasil.ok) return { ok: false, pesan: hasil.pesan };
    }

    /* 4. Item yang baru ditambahkan. Satu permintaan berisi semuanya:
           PostgREST menerima array body, dan baris baru tidak punya id untuk
           dirujuk satu per satu. Baris yang gagal disimpan bersamanya, jadi
           tidak ada item yang setengah masuk. */
    if (baru.length > 0) {
      const isi = baru.map((l) =>
        itemRow(input.saleId, {
          productClientId: l.productClientId || "",
          variantClientId: l.variantClientId || "",
          menuName: l.name || "",
          variantName: l.variant || "",
          name: l.name || "",
          price: Math.max(0, n(l.price)),
          qty: Math.max(0, n(l.qty)),
          note: rapikanCatatan(String(l.note ?? "")) ?? "",
        }),
      );
      const tambah = await fetch(`${SUPABASE_URL}/rest/v1/sale_items`, {
        method: "POST",
        headers: {
          ...headerRest(),
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(isi),
      });
      if (!tambah.ok) {
        return { ok: false, pesan: `Gagal menambah item struk (${tambah.status}).` };
      }
      const dibuat = (await tambah.json()) as unknown[];
      if (!Array.isArray(dibuat) || dibuat.length !== isi.length) {
        return { ok: false, pesan: "Item baru tidak tersimpan seluruhnya — periksa struk ini lagi." };
      }
    }
  } catch (e) {
    return { ok: false, pesan: `Gagal menyimpan perubahan: ${(e as Error).message}` };
  }

  return {
    ok: true,
    subtotal,
    total,
    dibuang,
    statusBerubah: sudahLunas && !masihLunas && total > totalLama,
  };
}

/** PATCH satu atau lebih `sale_items` sekaligus. Kosong = tidak ada yang
 *  perlu ditulis, jadi tidak ada permintaan yang dikirim. */
async function patchItem(ids: number[], body: Record<string, unknown>): Promise<HasilTulis> {
  if (ids.length === 0) return { ok: true };
  const url = `${SUPABASE_URL}/rest/v1/sale_items?id=in.(${ids.join(",")})`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      ...headerRest(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) return { ok: false, pesan: `Gagal menyimpan item struk (${r.status}).` };
  const data = (await r.json()) as unknown[];
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, pesan: "Item struk tidak ditemukan di server." };
  }
  return { ok: true };
}

/** Tandai struk terhapus (void). */
export function hapusStruk(id: number): Promise<HasilTulis> {
  return patchStruk(id, {
    deleted_at: new Date().toISOString(),
    stock_restored_on_delete: 0,
  });
}

/** Kembalikan struk yang terhapus ke daftar aktif. */
export function restoreStruk(id: number): Promise<HasilTulis> {
  return patchStruk(id, {
    deleted_at: null,
    stock_restored_on_delete: 0,
  });
}

/* -------------------------------------------------------------------------
   Ubah data customer

   Tabel `customers` tidak punya kolom alamat maupun catatan. Alamat muncul
   di `sales.customer_address` per struk, jadi tidak ada satu tempat untuk
   menyimpannya di sini — lihat mapCustomer di live-mappers.ts. Karena itu
   `UbahCustomerInput` sengaja tidak punya field itu: menerima
   address yang tidak bisa ditulis akan membuat drawer/DVD ini melaporkan
   "Tersimpan" padahal tidak ada yang berubah.

   Kolom yang bisa ditulis dari form Ubah Data Customer:

     name             -> name
     tag              -> tag              (null = Tanpa Tag)
     deposit          -> deposit_balance
     ongkir           -> default_shipping

   `last_order_at` tidak disentuh: itu diturunkan dari struk, bukan dari
   ketikan kasir.
   ------------------------------------------------------------------------- */

export type UbahCustomerInput = {
  /** id numerik baris `customers`, bukan id berawalan "c". */
  id: number;
  name: string;
  /** null = tanpa area/franchise. */
  tag: string | null;
  deposit: number;
  ongkir: number;
};

export async function ubahCustomer(input: UbahCustomerInput): Promise<HasilTulis> {
  const nama = String(input.name ?? "").trim();
  if (!nama) {
    return gabungPesan(galatValidasi("Nama customer tidak boleh kosong."));
  }
  const tag = input.tag && String(input.tag).trim() ? String(input.tag).trim() : null;

  const url = `${SUPABASE_URL}/rest/v1/customers?id=eq.${input.id}`;
  let r: Response;
  try {
    r = await fetch(url, {
      method: "PATCH",
      headers: {
        ...headerRest(),
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        name: nama,
        tag,
        deposit_balance: n(input.deposit),
        default_shipping: n(input.ongkir),
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    /* `fetch` melempal error kalau tidak ada koneksi — DNS gagal,
       offline, CORS ditolak. Tanpa catch di sini, yang muncul di layar
       bukan pesan melainkan unhandled rejection, dan kasir berakhir reload
      melihat data lamanya tanpa tahu kenapa. */
    const offline: GalatTulis = {
      judul: "Tidak ada koneksi ke server",
      penjelasan: "Perangkat ini tidak bisa menghubungi server. Data lu belum tersimpan.",
      langkah: "Cek internet, lalu tekan Simpan lagi.",
      teknis: String(e),
    };
    return gabungPesan(offline);
  }

  if (!r.ok) {
    return gabungPesan(await jelaskan(r, nama));
  }
  /* PATCH dengan filter yang tidak cocok mengembalikan array kosong, bukan
     error. Kalau begitu tidak ada yang berubah — dan itu harus dilaporkan,
     bukan dianggap berhasil. */
  const data = (await r.json()) as unknown[];
  if (!Array.isArray(data) || data.length === 0) {
    return gabungPesan(jelaskanGalatTulis(404, null, nama));
  }
  return { ok: true };
}

/** Bentuk hasil dari `jelaskanGalatTulis`: `pesan` dibuat dari bagian-bagian
 *  supaya pemanggil lama yang cuma menampilkan satu string tetap punya
 *  kalimat lengkap, sementara pemanggil baru bisa menampilkannya berjenjang. */
function gabungPesan(g: GalatTulis): HasilTulis {
  return {
    ok: false,
    judul: g.judul,
    penjelasan: g.penjelasan,
    langkah: g.langkah,
    ...(g.teknis ? { teknis: g.teknis } : {}),
    pesan: `${g.judul}. ${g.penjelasan} ${g.langkah}`,
  };
}

/** Baca body error server lalu petakan jadi kalimat manusia. Body dibaca
 *  satu kali: `r.json()` hanya bisa dipanggil sekali. */
async function jelaskan(r: Response, nama: string): Promise<GalatTulis> {
  let body: unknown = null;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  return jelaskanGalatTulis(r.status, body, nama);
}

/* -------------------------------------------------------------------------
   Hapus permanen

   Berbeda sifatnya dari "hapus struk" di atas: yang itu cuma memindahkan ke
   tab Terhapus dan masih bisa dibalikin. Yang ini benar-benar hilang dari
   database, jadi dua syarat: struk harus sudah terhapus, dan pemanggil harus
   lewat konfirmasi terpisah.

   Syarat "sudah terhapus" bukan sekadar formalitas. Kalau tombol ini
  reachable untuk struk yang masih hidup, satu klik yang salah target
   menghapus struk yang sedang dipakai kasir — dan tidak ada yang bisa
   mengembalikannya.

   sale_items dan sale_payments dihapus lebih dulu karena keduanya punya
   foreign key ke sales.id. Kalau relasinya cascade, DELETE di bawahnya cuma
   jadi no-op — urutan ini aman untuk dua-duanya.
   ------------------------------------------------------------------------- */

async function hapusAnak(table: "sale_items" | "sale_payments", saleId: number): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?sale_id=eq.${saleId}`;
  const r = await fetch(url, {
    method: "DELETE",
    headers: { ...headerRest(), Prefer: "return=minimal" },
  });
  if (!r.ok) throw new Error(`${table}: HTTP ${r.status}`);
}

/** Hapus struk yang sudah terhapus, permanen. Tidak bisa dibalikin. */
export async function hapusStrukPermanen(id: number): Promise<HasilTulis> {
  /* Ditolak kalau struk ternyata masih hidup. */
  const cek = await fetch(
    `${SUPABASE_URL}/rest/v1/sales?id=eq.${id}&deleted_at=not.is.null&select=id`,
    { headers: { ...headerRest(), Prefer: "return=representation" } },
  );
  if (!cek.ok) return { ok: false, pesan: `Gagal memeriksa struk (${cek.status}).` };
  const terjual = (await cek.json()) as unknown[];
  if (!Array.isArray(terjual) || terjual.length === 0) {
    return {
      ok: false,
      pesan:
        "Struk ini belum dihapus. Hapus dulu lewat tombol Hapus — yang dipindah ke Terhapus masih bisa dikembalikan.",
    };
  }

  try {
    await hapusAnak("sale_items", id);
    await hapusAnak("sale_payments", id);
  } catch (e) {
    return { ok: false, pesan: `Gagal menghapus rincian struk: ${(e as Error).message}` };
  }

  const r = await fetch(`${SUPABASE_URL}/rest/v1/sales?id=eq.${id}`, {
    method: "DELETE",
    headers: { ...headerRest(), Prefer: "return=representation" },
  });
  if (!r.ok) return { ok: false, pesan: `Gagal menghapus struk (${r.status}).` };
  const dihapus = (await r.json()) as unknown[];
  if (!Array.isArray(dihapus) || dihapus.length === 0) {
    return { ok: false, pesan: "Struk tidak ditemukan di server." };
  }
  return { ok: true };
}