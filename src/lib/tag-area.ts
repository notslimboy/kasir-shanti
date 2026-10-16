/* ==========================================================================
   Inferensi tag area.

   Disalin dari `infer_customer_address_tag` di update_customers_csv.py.
   Aturannya di sana Python, di sini JavaScript.

   Kenapa aturan ini ada di app dan tidak hanya di script:

   Kolom Tag di Detail Struk membaca `customers.tag`, dan kolom itu kosong
   untuk sebagian customer — tag aslinya disimpan sebagai alias berawalan
   `tagalamat:`, bukan di kolom. "Anis BTH" salah satunya: tag-nya `ITS`
   bisa dibaca dari alias `ANIS BRIN`, jadi parser tahu customer itu masuk
   area ITS sementara app tidak punya apa pun untuk ditampilkan.

   Konsekuensinya kasir melihat tanda hubung untuk struk yang sebenarnya
   punya area. Tanpa area, kurir tidak bisa ditentukan dan rekap ongkir
   per kurir menghitung struk yang seharusnya ikut.

   Aturan di sini HANYA dipakai sebagai cadangan. Kalau `customers.tag`
   terisi, itu yang ditampilkan — nilai yang benar-benar tersimpan, bukan
   tebakan. Menebak lebih baik daripada kosong, tapi lebih buruk daripada
   nilai yang sudah pasti benar.
   ========================================================================== */

/* Kata kunci yang menandai area. Urutannya dari yang paling spesifik:
   "Pantai Mentari" harus tertangkap sebelum "Pantai Mentari" yang lebih
   umum, dan "Mulyosari Tengah" sebelum "Mulyosari". */
const AREA: { tag: string; pola: RegExp }[] = [
  { tag: "Sutorejo", pola: /\b(?:sutorejo|suto|sut)\s*(?:tengah|teng|tgh)\b|\bsutotengah\b|\bsutoteng\b|\bsutotgh\b/ },
  { tag: "Sutorejo", pola: /\b(?:sutorejo|suto|sut)\s*(?:selatan|sel)\b|\bsutoselatan\b|\bsutosel\b/ },
  { tag: "Sutorejo", pola: /\b(?:sutorejo|suto|sut)\s*(?:utara|ut)\b|\bsutoutara\b|\bsutout\b/ },
  { tag: "Sutorejo", pola: /\b(?:sutorejo|suto|sut)\s*(?:timur|tim)\b|\bsutotimur\b|\bsutotim\b/ },
  { tag: "Sutorejo", pola: /\bsutorejo\b|\bsuto\b|\banak\s*7\s*37\b|\bartha\s*catur\b/ },
  { tag: "BPD", pola: /\bbpd\b/ },
  { tag: "Mulyosari", pola: /\bmuly(?:o|osari)?\s*(?:tengah|tng|teng|tgh)\b|\bmulyotengah\b|\bmulyotng\b|\bmulyoteng\b|\bmulyotgh\b/ },
  { tag: "Mulyosari", pola: /\bmuly(?:o|osari)?\s*(?:utara|ut)\b|\bmulyoutara\b|\bmulyout\b/ },
  { tag: "Mulyosari", pola: /\bmulyosari\b|\bmulyo\b|\bmuly\b/ },
  { tag: "Wisper", pola: /\b(?:wisper|wis\s*per|spr)\b/ },
  { tag: "Bhaskara", pola: /\b(?:bhaskara|bhaska|bhas|bhsksari)\b|\bbu\s*bambang\s*gg\s*1\b|\bzainal\s*gg\s*3\b/ },
  { tag: "Kenjeran", pola: /\b(?:kenjeran|pantai\s*ment(?:ari|ri)|sahabudin|tuwowo|tohir|babatan|dupak(?:\s*pecah\s*belah)?|pecah\s*belah|ngadi|putro\s*agung)\b/ },
  { tag: "Keputih", pola: /\bkeputih\b|\bjoko\s*sukolilo\b/ },
  { tag: "Dharmahusada", pola: /\bdharmahusada\b/ },
  { tag: "Pakuwon", pola: /\bpakuwon\b|\b(?:puri|griya)\s*asri\b|\bvilla\s*royal\b|\broyal\s+[a-z]?\d\b|\bsan\s*(?:antonio|diego)\b|\bwestwood\b|\bflorence\b|\blaguna\b|\bmutiara\b|\bnenet\b/ },
  { tag: "Bumi Galaxy", pola: /\bbumi\s*galaxy\s*permai\b|\bbumigalaxypermai\b|\bgalaxy\s*permai\b|\bsma\s*5\s*ratna\s*juli\b|\bsma5ratnajuli\b/ },
  { tag: "Bumi Marina", pola: /\bbumi\s*marina\b/ },
  { tag: "Rungkut", pola: /\brungkut\b/ },
  { tag: "Manyar", pola: /\bmanyar\b/ },
  { tag: "Kalijudan", pola: /\bkalijudan\b/ },
  { tag: "Supit", pola: /\bsupit\b/ },
];

/* Kata yang menandai area ITS. Inilah yang menangkap "Anis BTH" lewat alias
   `ANIS BRIN` — BRIN adalah badan riset ITS, dan tidak ada nama area di
   namanya sendiri. */
const KATA_ITS =
  /\b(?:its|dptsi|bapkm|sdmo|dpsp|spkb|ftspk|wr\s*3|teknik|tek|t\s*lingkungan|lingku(?:ngan)?|arsitek(?:tur)?|bahasa|mesin|kimia|fisika|geofisika|statistika|mipa|instrumen(?:tasi)?|hidrodinamika|brin|nasdec|riset|research\s*center|gedung\s*riset|gedung\s*rc|rc\s*(?:lt|lantai)|perpus(?:takaan)?|manajemen\s*bisnis)\b/;

/* "W 6", "D 23", "T 4" — pola blok ITS. Sengaja diperiksa paling akhir:
   "BPD B 34-35" adalah BPD, bukan blok. Kalau blok diperiksa lebih dulu,
   hampir semua nama yang berakhir angka akan tertangkap sebagai ITS.

   Bentuk yang harus tertangkap, semuanya ejaan nyata di data:
     "W 6"          huruf + angka
     "ITS T 73"     dengan awalan ITS
     "Blok V No 9"  dengan kata "No" sebelum angkanya
     "P / 7"        huruf P, dan pemisah garis miring
   "No"/"Nomor" boleh muncul sebelum angka karena begitulah kasir dan
   pelanggan menulis blok. Kata "no" tanpa angka tetap tidak cocok. */
const BLOK_ITS =
  /\b(?:its\s*)?(?:perum\s*)?(?:blok\s*)?(?:(p1)\s*[/ -]?\s*\d+|([tuvwjdnxmrficahbp])(?!\s*o\s*\d)\s*(?:lama\s*)?(?:[/.-]|\s)*(?:no(?:mor|m)?\.?\s*)?[a-z]?\s*\d+)\b/;

const GOJEK = /\bgo\s*jek\b|\bgojek\b/;

/** Buang semua yang bukan huruf dan angka. "Sutorejo Tengah 12/10" menjadi
    "sutorejointengah1210", dan pola butuh bentuk tanpa spasi: "SutTgh"
    tidak akan pernah cocok kalau spasinya masih ada. */
function padat(v: string): string {
  return v.toLowerCase().replace(/[^0-9a-z]+/g, "");
}

/** Huruf, angka, dan spasi saja — untuk pencocokan batas kata. */
function bersih(v: string): string {
  return v.toLowerCase().replace(/[^0-9a-z]+/g, " ").trim();
}

/**
 * Tebak tag area dari nama dan semua alias-nya.
 *
 * Urutan pemeriksaan bukan arbitrer:
 *
 * 1. GOJEK lebih dulu — "GOJEK" bisa muncul di nama yang juga memuat kata
 *    area lain, dan kurirnya memang GOJEK, bukan tebakan area.
 * 2. Kata ITS kedua, karena langsung menangkap "Gedung FKK ITS Lt 2"
 *    tanpa harus menebak dari blok.
 * 3. Area spesifik, dari yang paling spesifik.
 * 4. Blok ITS paling akhir, karena polanya paling longgar.
 *
 * Mengembalikan string kosong kalau tidak ada yang cocok. Kosong berarti
 * "tidak diketahui" — bukan berarti customer ini tidak punya area.
 */
export function inferTagArea(nama: string, alias: readonly string[] = []): string {
  const mentah = [nama, ...alias].join(" ");
  if (mentah.trim() === "") return "";
  const teks = `${bersih(mentah)} ${padat(mentah)}`.trim();
  if (GOJEK.test(teks)) return "GOJEK";
  if (KATA_ITS.test(teks)) return "ITS";
  for (const a of AREA) if (a.pola.test(teks)) return a.tag;
  if (BLOK_ITS.test(teks)) return "ITS";
  return "";
}

/** Awalan yang dipakai `update_customers_csv.py` untuk menyimpan tag di
    tabel alias, karena kolom `customers.tag` belum selalu terisi. */
export const AWALAN_TAG = "tagalamat:";

/** Tag yang tersimpan sebagai alias, bukan di kolom `customers.tag`. */
export function tagDariAlias(alias: readonly string[]): string | undefined {
  for (const a of alias) {
    const t = a.trim();
    if (t.toLowerCase().startsWith(AWALAN_TAG)) {
      const nilai = t.slice(AWALAN_TAG.length).trim();
      if (nilai !== "") return nilai;
    }
  }
  return undefined;
}