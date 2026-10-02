/* ==========================================================================
   Pencocokan item CSV → barang katalog.

   Diported dari script.js lama (getDraftProductCandidateScore,
   getRankedDraftProductCandidates, isClearDraftProductCandidate) dengan
   skor yang lebih sederhana tapi Entscheidungslogik sama: nama persis
   menang, lalu alias, lalu kemiripan kata, lalu substring.

   Kenapa perlu fuzzy: nama di CSV dari chat WhatsApp ("nasi goreng rumahan")
   hampir tidak pernah sama persis dengan nama menu di katalog ("Nasi Goreng
   Rumah"). Versi lama menaruh 3 teratas di optgroup "Saran Cocok (Fuzzy
   Match)" supaya kasir tinggal memilih, dan itu yang bikin alurnya cepat.
   ========================================================================== */

export type KandidatProduk = {
  client_id: string;
  name: string;
  sku: string;
  aliases: string[];
  variants: { name: string; price: number; pricing_type: string }[];
  /** Sisa stok; null = tanpa batas. */
  stok: number | null;
};

export type BobotKandidat = { produk: KandidatProduk; skor: number };

/** Sama seperti normalizeKey di script.js: huruf kecil, tanpa tanda baca. */
export function normalizeKunci(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Kata dari nama yang bukan informasi varian/porsi. */
const KATA_VARIAN = ["separuh", "setengah", "normal", "custom input", "harga custom", "penuh", "1 2", "1/2", "3 4", "3/4"];

/** Ambil nama "___" dari "___ 1/2" — sisa yang bukan keterangan porsi. */
export function namaPokok(rawName: string): string {
  let n = normalizeKunci(rawName);
  for (const k of KATA_VARIAN) n = n.replace(new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  return n.replace(/\s+/g, " ").trim();
}

/** Varian yang disebut di dalam nama, mis. "nasi goreng 1/2" → "Separuh". */
export function varianDariNama(rawName: string): string {
  const n = normalizeKunci(rawName);
  if (/\b(separuh|setengah|1\s*\/?\s*2)\b/.test(n)) return "Separuh";
  if (/\b(3\s*\/?\s*4)\b/.test(n)) return "3/4";
  if (/\bnormal\b/.test(n)) return "Normal";
  return "";
}

/** Berapa bagian nama CSV yang benar-benar ada di nama katalog. */
function tokenOverlap(a: string, b: string): number {
  const ta = a.split(" ").filter(Boolean);
  const tb = new Set(b.split(" ").filter(Boolean));
  if (!ta.length) return 0;
  let cocok = 0;
  for (const t of ta) if (tb.has(t)) cocok += 1;
  return cocok / ta.length;
}

/** Dice similarity atas bigram — sama seperti getStringSimilarity di
    script.js. Menyangkap salah ketik ("kwetiau" vs "kwetiaw") yang tidak
    akan terlihat oleh pencocokan kata. */
export function kemiripanBigram(a: string, b: string): number {
  const s1 = a.trim();
  const s2 = b.trim();
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;
  const bigram = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const b1 = bigram(s1);
  const b2 = bigram(s2);
  let sama = 0;
  let total = 0;
  for (const n of b2.values()) total += n;
  for (const [g, n] of b1) {
    total += n;
    const ada = b2.get(g);
    if (ada) sama += Math.min(n, ada);
  }
  return total === 0 ? 0 : (2 * sama) / total;
}

/** Skor 0–100: kunci katalog mana pun yang paling mirip dengan nama CSV. */
export function skorKandidat(produk: KandidatProduk, rawName: string): number {
  const query = namaPokok(rawName);
  if (!query) return 0;
  const target = normalizeKunci(produk.name);
  const alias = produk.aliases.map(normalizeKunci);

  if (query === target || alias.includes(query)) return 100;
  if (query.startsWith(`${target} `) || target.startsWith(`${query} `)) return 90;
  if (alias.some((a) => a.startsWith(query) || query.startsWith(a))) return 84;

  let skor = 0;
  if (target.includes(query) || query.includes(target)) skor = Math.max(skor, 72);

  /* Sisa hanya dihitung kalau dianggapnya benar-benar mirip: minimal dua
     kata yang sama, ATAU kemiripan bigram tinggi. Satu kata yang kebetulan
     sama ("nasi goreng seafood" → "nasi putih") TIDAK boleh sampai — itu
     chosek diam-diam ke menu yang salah. */
  const kataSama = query.split(" ").filter((t) => target.split(" ").includes(t)).length;
  if (kataSama >= 2) skor = Math.max(skor, tokenOverlap(query, target) * 70);
  for (const a of alias) {
    const samaAlias = query.split(" ").filter((t) => a.split(" ").includes(t)).length;
    if (samaAlias >= 2) skor = Math.max(skor, tokenOverlap(query, a) * 62);
  }
  skor = Math.max(skor, Math.round(kemiripanBigram(query, target) * 30));
  for (const a of alias) skor = Math.max(skor, Math.round(kemiripanBigram(query, a) * 26));

  if (produk.sku && normalizeKunci(produk.sku) === query) skor = 100;
  return Math.round(skor);
}

/** Tiga kandidat terbaik di atas ambang — sama seperti versi lama. */
export function rankedKandidat(produk: KandidatProduk[], rawName: string, ambang = 11): BobotKandidat[] {
  return produk
    .map((p) => ({ produk: p, skor: skorKandidat(p, rawName) }))
    .filter((c) => c.skor >= ambang)
    .sort((a, b) => b.skor - a.skor || a.produk.name.localeCompare(b.produk.name, "id-ID"));
}

/** True kalau kandidat pertama jelas lebih cocok — sama seperti
    isClearDraftProductCandidate: selisih 6 poin, atau 30+ dan 1,25× lipatan. */
export function kandidatJelas(daftar: BobotKandidat[]): boolean {
  const [teratas, kedua] = daftar;
  if (!teratas) return false;
  if (!kedua) return true;
  if (teratas.skor >= kedua.skor + 6) return true;
  return teratas.skor >= 30 && teratas.skor >= kedua.skor * 1.25;
}