/* ==========================================================================
   Pencarian menu cepat — dipakai halaman penjualan untuk menyaring struk
   berdasarkan nama item (bukan customer).

   Typo-tolerant via Levenshtein edit distance, tanpa dependensi eksternal.
   Kasir mengetik pendek dan asal-asalan, jadi cocokMenu harus menangkap
   "tepo" → "Tepo Tahu", "rwan" → "Rawon", "telor gulung" → "Telur Gulung"
   sambil tetap menolak "rawon" → "Ayam Panggang" atau "sate" → "Rawon".
   ========================================================================== */

import { normalizeKunci } from "./cocok-produk";
import type { Sale } from "./sale";

export type RincianMenu = {
  nama: string;
  porsi: number;
  struk: number;
};

export type RingkasanMenu = {
  tampil: Sale[];
  jumlahStruk: number;
  totalPorsi: number;
  rincian: RincianMenu[];
};

/** Levenshtein jarak edit — iterative, rolling dua baris. */
function jarakLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Baris sebelumnya dan baris sekarang
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // hapus
        curr[j - 1] + 1,    // sisip
        prev[j - 1] + cost, // ganti
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Ambang Levenshtein yang diterima untuk panjang token tertentu. */
function batasLevenshtein(panjang: number): number {
  // Token < 3 karakter hanya cocok lewat exact/prefix.
  // Di atas itu: jarak 2 juga diperiksa, tetapi untuk d=2 ada filter
  // tambahan: semua karakter token pendek harus ada di token panjang
  // (cegah "tepo"(4)↔"tempe"(5) meski d=2 karena 'o'∉tempe).
  if (panjang >= 3) return 2;
  return 0;
}

/** True kalau dua token (sudah dinormalisasi) cocok. */
function tokenCocok(tq: string, tn: string): boolean {
  // 1. Sama persis
  if (tq === tn) return true;
  // 2. Prefix: satu awalan yang lain, min 3 karakter
  if (tq.length >= 3 && tn.startsWith(tq)) return true;
  if (tn.length >= 3 && tq.startsWith(tn)) return true;
  // 3. Levenshtein — ambang berdasarkan panjang token terpendek.
  const minLen = Math.min(tq.length, tn.length);
  const batas = batasLevenshtein(minLen);
  if (batas <= 0) return false;
  const d = jarakLevenshtein(tq, tn);
  if (d > batas) return false;
  // 3a. Untuk d=2, filter: semua karakter token pendek harus ada di
  //     token panjang. Cegah "tepo"↔"tempe" (d=2, min=4, 'o'∉tempe).
  //     Tapi "rwan"↔"rawon" (d=2, min=4, r,w,a,n ∈ rawon) tetap lolos.
  if (d === 2) {
    const pendek = tq.length <= tn.length ? tq : tn;
    const panjang = tq.length <= tn.length ? tn : tq;
    for (const ch of pendek) {
      if (!panjang.includes(ch)) return false;
    }
  }
  return true;
}

/** True kalau query cocok dengan nama item, dengan toleransi typo.
 *
 *  Algoritma:
 *  1. Normalisasi kedua sisi pakai `normalizeKunci`.
 *  2. Query kosong/hanya spasi → false.
 *  3. Substring fast path (query length >= 2) → true.
 *  4. Token path: setiap token query harus cocok dengan setidaknya satu
 *     token nama. Cocok = exact, prefix (min 3 char), atau Levenshtein
 *     <= ambang berdasarkan panjang token terpendek.
 *  5. Guard: query satu kata vs nama multi-token — pastikan bukan cuma
 *     Levenshtein di jauh (cegah "rawon" → "Tepo Tahu").
 */
export function cocokMenu(cari: string, namaItem: string): boolean {
  const q = normalizeKunci(cari);
  const n = normalizeKunci(namaItem);

  if (!q) return false;
  if (!n) return false;

  // Fast path — substring (min 2 karakter supaya "es" → "Es Dawet" tetap
  // jalan, tapi "r" → "Rawon" tidak).
  if (q.length >= 2 && n.includes(q)) return true;

  const tokenQ = q.split(" ").filter(Boolean);
  const tokenN = n.split(" ").filter(Boolean);

  // Setiap token query harus cocok dengan setidaknya satu token nama
  for (const tq of tokenQ) {
    let cocok = false;
    for (const tn of tokenN) {
      if (tokenCocok(tq, tn)) { cocok = true; break; }
    }
    if (!cocok) return false;
  }

  // Guard: query satu kata vs nama multi-token — pastikan ada kecocokan
  // non-Levenshtein-atau-Levenshtein-ringan (substring/prefix/exact atau
  // Levenshtein <= 1) dengan minimal satu token nama, supaya "rawon" tidak
  // lolos ke "Tepo Tahu" hanya karena Levenshtein jarak jauh.
  if (tokenQ.length === 1 && tokenN.length > 1) {
    const tq = tokenQ[0];
    let kuat = false;
    for (const tn of tokenN) {
      if (tn.includes(tq)) { kuat = true; break; }
      if (tq.includes(tn) && tn.length >= 3) { kuat = true; break; }
      if (tn.length >= 3 && tn.startsWith(tq)) { kuat = true; break; }
      if (tq.length >= 3 && tq.startsWith(tn)) { kuat = true; break; }
      if (tn === tq) { kuat = true; break; }
      // Levenshtein distance 1 juga dianggap kuat — "dewet"→"dawet"
      if (tq.length >= 3 && tn.length >= 3 && jarakLevenshtein(tq, tn) <= 1) {
        kuat = true; break;
      }
    }
    if (!kuat) return false;
  }

  return true;
}

/** Ringkasan menu dari daftar struk: struk mana yang mengandung item yang
 *  cocok, total porsi, dan rincian per item. */
export function ringkasMenu(struk: Sale[], cari: string): RingkasanMenu {
  const q = normalizeKunci(cari);

  // Query kosong → hasil kosong (jangan sembunyikan semua struk)
  if (!q) {
    return { tampil: [], jumlahStruk: 0, totalPorsi: 0, rincian: [] };
  }

  const tampil: Sale[] = [];
  const petaRincian = new Map<string, { porsi: number; struk: Set<number> }>();

  for (const s of struk) {
    const lines = s.lines ?? [];
    let ada = false;

    for (const line of lines) {
      if (cocokMenu(q, line.name)) {
        ada = true;
        const existing = petaRincian.get(line.name);
        if (existing) {
          existing.porsi += line.qty;
          existing.struk.add(s.id);
        } else {
          petaRincian.set(line.name, {
            porsi: line.qty,
            struk: new Set([s.id]),
          });
        }
      }
    }

    if (ada) tampil.push(s);
  }

  // Hitung total porsi dari rincian (hanya baris yang cocok)
  let totalPorsi = 0;
  const rincian: RincianMenu[] = [];
  for (const [nama, data] of petaRincian) {
    totalPorsi += data.porsi;
    rincian.push({ nama, porsi: data.porsi, struk: data.struk.size });
  }

  // Sort: porsi desc, lalu nama asc
  rincian.sort((a, b) => b.porsi - a.porsi || a.nama.localeCompare(b.nama, "id-ID"));

  return {
    tampil,
    jumlahStruk: tampil.length,
    totalPorsi,
    rincian,
  };
}