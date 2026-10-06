/* ==========================================================================
   Import Pesanan dari CSV.

   Format dan perilaku-nya mengikuti Bulk Input di aplikasi lama
   (script.js, sekitar baris 5500–5700) supaya file yang sudah pernah dipakai
   — termasuk sample-bulk-orders.csv — langsung bisa dibuka di sini.

   Tiga hal yang dijaga:

   1. Draft selalu muncul, apa pun formatnya. Baris yang harganya belum
      diketahui TETAP dibuat — persis seperti aplikasi lama — supaya yang
      belum bisa dibaca kelihatan dan bisa diperbaiki. Yang berbeda: struk
      tidak boleh DISIMPAN selama masih ada harga kosong. Import dengan harga
      0 diam-diam adalah cara paling cepat merusak pembukuan.

   2. Baris berurutan dengan nama, tanggal, pembayaran, dan ongkir yang
      sama dianggap SATU pesanan — persis seperti versi lama (groupKey =
      customer|chatDate|payment|shipping). Catatan kirim tidak ikut jadi
      pemisah, karena sering diisi berbeda-beda antar item dari orang yang
      sama; memisahkannya akan memecah satu struk jadi beberapa.

   3. Tanggal dibaca dalam format Indonesia ("28/5/2026 10.15"), dan jam
      disimpan sebagai UTC — sama seperti kasir yang menambah struk manual.
   ========================================================================== */

/* -------------------------------------------------------------------------
   CSV
   ---------------------------------------------------------------------- */

/** Pemecah CSV yang membaca kutip secara naif. Alas: memisahkan dengan koma
    membuat "Nasi Goreng, besar" jadi dua kolom. */
export function pisahCsv(teks: string): string[][] {
  const baris: string[][] = [];
  let sel = "";
  let diDalamKutip = false;
  let barisSekarang: string[] = [];
  let adaIsi = false;

  const tutupSel = () => {
    barisSekarang.push(sel);
    sel = "";
    adaIsi = false;
  };
  const tutupBaris = () => {
    tutupSel();
    baris.push(barisSekarang);
    barisSekarang = [];
  };

  const s = teks.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (diDalamKutip) {
      if (c === '"') {
        // "" di dalam kutip = satu tanda kutip
        if (s[i + 1] === '"') {
          sel += '"';
          i++;
        } else {
          diDalamKutip = false;
        }
      } else {
        sel += c;
      }
      continue;
    }
    if (c === '"') {
      diDalamKutip = true;
      adaIsi = true;
      continue;
    }
    if (c === ",") {
      tutupSel();
      continue;
    }
    if (c === "\r") continue;
    if (c === "\n") {
      tutupBaris();
      continue;
    }
    sel += c;
    adaIsi = true;
  }
  if (adaIsi || sel !== "" || barisSekarang.length > 0) tutupBaris();
  return baris.filter((b) => b.some((x) => x.trim() !== ""));
}

/* Alias kolom, sama persis dengan yang dibaca versi lama. */
const ALIAS: Record<string, string[]> = {
  customer: ["customer", "kontak", "namakontak", "namacustomer", "pelanggan"],
  chatDate: ["chatdate", "tanggalchat", "tanggalmasuk", "waktuchat"],
  payment: ["payment", "pembayaran"],
  ongkir: ["ongkir", "shipping", "ongkoskirim"],
  item: ["item", "menu", "barang", "nama", "name", "produk"],
  quantity: ["quantity", "qty", "jumlah", "jml"],
  note: ["note", "catatan", "keterangan"],
  sendNote: ["sendnote", "send_note", "sendnotes", "catatankirim", "tujuankirim"],
  price: ["price", "harga"],
  variant: ["variant", "varian", "variasi", "variantname"],
  unit: ["unit", "satuan", "unitname"],
  sku: ["sku", "kode"],
};

const kunci = (s: string) => s.trim().toLowerCase().replace(/[\s_-]/g, "");

function petaKolom(header: string[]): Map<string, number> {
  const peta = new Map<string, number>();
  header.forEach((h, i) => {
    const k = kunci(h);
    for (const [nama, alias] of Object.entries(ALIAS)) {
      if (alias.includes(k) && !peta.has(nama)) peta.set(nama, i);
    }
  });
  return peta;
}

/* -------------------------------------------------------------------------
   Nilai
   ---------------------------------------------------------------------- */

/** "Rp 10.000", "10000", "10,5" → 10000 / 10.5. versi lama: buang semua
    bukan angka,|hapus titik ribuan, koma jadi desimal. */
export function parseUang(v: unknown): number {
  if (typeof v === "number") return Math.max(0, v);
  const bersih = String(v ?? "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const n = Number.parseFloat(bersih);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** True kalau teksnya jelas bukan angka — dipakai untuk membedakan "0"
    yang disengaja dari kolom yang tidak terisi. */
function bukanAngka(v: string): boolean {
  const t = v.trim();
  return t !== "" && !/^[\d.,\s]+$/.test(t) && !/^\s*(rp|idr)?\s*[\d.,]+/i.test(t);
}

/** "28/5/2026 10.15" → { tanggal: "2026-05-28", jam: "10:15" }.
    Port normalizeQueueDate (script.js:5787) + pemisahan jamnya. */
export function parseTanggal(v: string): { tanggal: string; jam: string } {
  const raw = String(v ?? "").trim();
  if (!raw) return { tanggal: "", jam: "" };

  const jamCocok = raw.match(/(\d{1,2})[.:](\d{2})$/);
  const jam = jamCocok ? `${jamCocok[1].padStart(2, "0")}:${jamCocok[2]}` : "";
  const bagianTanggal = (jamCocok ? raw.slice(0, jamCocok.index) : raw).trim();

  const iso = bagianTanggal.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return { tanggal: `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`, jam };

  const numerik = bagianTanggal.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (numerik) {
    const tahun = numerik[3].length === 2 ? `20${numerik[3]}` : numerik[3];
    return { tanggal: `${tahun}-${pad(numerik[2])}-${pad(numerik[1])}`, jam };
  }
  return { tanggal: "", jam };
}

const pad = (v: string) => String(Number(v)).padStart(2, "0");

/** Tanggal lokal kasir → instants UTC, sama seperti batasRentangUTC di
    live.ts. Tanpa konversi ini, jam 00.30 WIB tercatat sebagai 17.30 UTC
    tanggal sebelumnya dan struknya muncul di hari yang salah. */
export function keCompletedAt(tanggal: string, jam: string, zona = 7): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return null;
  const [j, m] = jam.split(":").map(Number);
  const jamValid = Number.isFinite(j) && Number.isFinite(m) ? j : 0;
  const menitValid = Number.isFinite(m) ? m : 0;
  const ms = Date.UTC(
    Number(tanggal.slice(0, 4)),
    Number(tanggal.slice(5, 7)) - 1,
    Number(tanggal.slice(8, 10)),
    jamValid - zona,
    menitValid,
    0,
    0,
  );
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/* -------------------------------------------------------------------------
   Hasil parse
   ---------------------------------------------------------------------- */

export type ItemImpor = {
  nama: string;
  qty: number;
  harga: number;
  /** true = harga belum diketahui (tidak ada di CSV dan tidak ketemu di
      katalog). Baris ini TETAP muncul di daftar — sama seperti aplikasi
      lama — supaya kasir tinggal mengisinya, bukan mencari-cari di mana
      baris yang hilang. Tapi struk tidak boleh disimpan selama masih ada
      harga kosong: satu struk Rp 0 merusak pembukuan diam-diam. */
  hargaKosong: boolean;
  /** true = harga ini datang dari kolom `harga` di CSV (atau diketik kasir),
      BUKAN dari katalog. Dibedakan karena keduanya sama-sama "> 0" di
      object: tanpa flag ini, harga katalog untuk varian biasa akan terlihat
      seperti harga yang sudah dipastikan orang, dan harga varian yang
      dipilih tidak pernah bisa menang. */
  hargaDariCsv?: boolean;
  /** client_id barang katalog yang sudah dicocokkan. Kosong = belum cocok,
      dan itu yang membuat draft berstatus "Perlu review". */
  productClientId: string;
  productName: string;
  /** Varian priced custom perlu dicek orang sebelum dipakai. */
  perluCekHarga: boolean;
  /** true = pesan ini porsi separuh (quantity 0.5) tapi produk katalognya
      tidak punya varian "Separuh". Nilai TIDAK ditebak: draft ditahan dan
      kasir yang memilih, karena jatuh diam-diam ke varian Normal membuat
      struk separuh tercatat sebagai porsi penuh. */
  perluVarianSeparuh?: boolean;
  /** Sisa stok katalog; null = tanpa batas. Dipakai untuk isu "stok kurang". */
  stok: number | null;
  catatan: string;
  varian: string;
  sku: string;
  /** Baris CSV asal, untuk pesan kesalahan yang bisa ditenguki. */
  baris: number;
};

export type PesananImpor = {
  customer: string;
  /** YYYY-MM-DD, waktu lokal kasir. */
  tanggal: string;
  jam: string;
  completedAt: string | null;
  payment: string;
  ongkir: number;
  sendNote: string;
  items: ItemImpor[];
  subtotal: number;
  total: number;
  /** Baris CSV tempat pesanan ini dimulai. */
  baris: number;
};

export type MasalahImport = { baris: number; pesan: string };

export type HasilImport = {
  pesanan: PesananImpor[];
  masalah: MasalahImport[];
  barisDibaca: number;
  barisDilewati: number;
};

export type CariHarga = (
  nama: string,
  varian: string,
) => {
  client_id: string;
  /** Varian yang benar-benar dipilih — dipakai supaya pencocokan barang
      tidak selalu memilih varian pertama. */
  variantClientId?: string;
  nama: string;
  /** Nama barang (bukan varian). */
  produkNama?: string;
  price: number;
  perluCekHarga?: boolean;
  stok?: number | null;
} | null;

/** Parse CSV pesanan. `cariHarga` dipakai untuk mengisi harga dari katalog
    kalau kolom price kosong; kalau tidak ketemu, barisnya jadi masalah. */
export function parsePesananCsv(teks: string, cariHarga?: CariHarga): HasilImport {
  const masalah: MasalahImport[] = [];
  const tabel = pisahCsv(teks);
  if (tabel.length === 0) return { pesanan: [], masalah, barisDibaca: 0, barisDilewati: 0 };

  const header = tabel[0];
  const peta = petaKolom(header);
  const ambil = (row: string[], nama: string) => {
    const i = peta.get(nama);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  if (!peta.has("item")) {
    return {
      pesanan: [],
      masalah: [{ baris: 1, pesan: `Kolom menu tidak ditemukan. Header yang ada: ${header.join(", ")}` }],
      barisDibaca: 0,
      barisDilewati: tabel.length - 1,
    };
  }

  const hasil: PesananImpor[] = [];
  let berjalan: PesananImpor | null = null;
  let metaLalu: string | null = null;
  let barisDibaca = 0;
  let barisDilewati = 0;

  /* Pemisahnya customer + tanggal + pembayaran + ongkir. sendNote TIDAK ikut:
     satu struk sering punya catatan kirim berbeda per item ("kirim pos"
     di item pertama, kosong di item berikutnya) dan memisahkannya akan
     memecah satu struk jadi beberapa struk. */
  const kunciMeta = (customer: string, tanggal: string, payment: string, ongkir: string) =>
    [customer, tanggal, payment, ongkir].join("\u0000");

  for (let i = 1; i < tabel.length; i++) {
    const row = tabel[i];
    const noBaris = i + 1;
    barisDibaca++;

    const namaItem = ambil(row, "item");
    if (!namaItem) {
      barisDilewati++;
      masalah.push({ baris: noBaris, pesan: "Nama menu kosong" });
      continue;
    }

    const qtyTeks = ambil(row, "quantity") || "1";
    const qty = parseUang(qtyTeks);
    if (qty <= 0) {
      barisDilewati++;
      masalah.push({ baris: noBaris, pesan: `Jumlah "${qtyTeks}" bukan angka positif` });
      continue;
    }

    const customer = ambil(row, "customer");
    const tanggal = parseTanggal(ambil(row, "chatDate"));
    const payment = ambil(row, "payment") || "Tunai";
    const ongkirTeks = ambil(row, "ongkir");
    const ongkir = ongkirTeks ? parseUang(ongkirTeks) : 0;
    if (ongkirTeks && bukanAngka(ongkirTeks)) {
      masalah.push({ baris: noBaris, pesan: `Ongkir "${ongkirTeks}" dibaca sebagai ${ongkir}` });
    }
    const sendNote = ambil(row, "sendNote");

    const varian = ambil(row, "variant");
    const hargaTeks = ambil(row, "price");
    const dariKatalog = cariHarga?.(namaItem, varian) ?? null;
    let harga = hargaTeks ? parseUang(hargaTeks) : dariKatalog?.price ?? 0;
    let hargaKosong = false;
    if (!hargaTeks && !dariKatalog) {
      /* Harga belum diketahui. Baris tetap muncul sebagai draft dengan kolom
         harga kosong — dibuang diam-diam membuat kasir huntung ke mana
         itemnya hilang. */
      hargaKosong = true;
    }
    if (harga <= 0) hargaKosong = true;
    if (hargaTeks && bukanAngka(hargaTeks)) {
      masalah.push({ baris: noBaris, pesan: `Harga "${hargaTeks}" dibaca sebagai ${harga}` });
    }

    const k = kunciMeta(customer, tanggal.tanggal, payment, ongkirTeks);
    if (!berjalan || k !== metaLalu) {
      const completedAt = keCompletedAt(tanggal.tanggal, tanggal.jam);
      if (berjalan) hasil.push(berjalan);
      berjalan = {
        customer,
        tanggal: tanggal.tanggal,
        jam: tanggal.jam,
        completedAt,
        payment,
        ongkir,
        sendNote,
        items: [],
        subtotal: 0,
        total: 0,
        baris: noBaris,
      };
      metaLalu = k;
    }
    /* Catatan kirim digabung, bukan ditimpa: item kedua sering tidak
       mengulangi kolomnya. */
    if (sendNote && !berjalan.sendNote) berjalan.sendNote = sendNote;

    berjalan.items.push({
      nama: namaItem,
      qty,
      harga,
      hargaKosong,
      hargaDariCsv: Boolean(hargaTeks),
      productClientId: dariKatalog ? dariKatalog.client_id : "",
      productName: dariKatalog?.produkNama ?? "",
      varian: varian || dariKatalog?.nama || "",
      perluCekHarga: Boolean(dariKatalog?.perluCekHarga),
      stok: dariKatalog?.stok ?? null,
      catatan: ambil(row, "note"),
      sku: ambil(row, "sku"),
      baris: noBaris,
    });
    berjalan.subtotal += qty * harga;
  }
  if (berjalan) hasil.push(berjalan);

  for (const p of hasil) {
    p.total = Math.max(0, p.subtotal + p.ongkir);
    for (const it of p.items) {
      if (it.hargaKosong) {
        masalah.push({
          baris: it.baris,
          pesan: `Harga "${it.nama}"${it.varian ? ` (${it.varian})` : ""} belum diisi — isi di kolom harga`,
        });
      }
      if (!it.productClientId) {
        masalah.push({ baris: it.baris, pesan: `"${it.nama}" belum dicocokkan ke barang katalog` });
      }
    }
  }

  return { pesanan: hasil, masalah, barisDibaca, barisDilewati };
}
