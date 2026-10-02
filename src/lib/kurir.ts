/* ==========================================================================
   Ongkir per kurir.

   Tabel sales tidak punya kolom kurir — dan tidak akan pernah, karena
   pengirimnya berubah sewaktu-waktu. Yang ada adalah `customers.tag`
   (area/franchise: ITS, GOJEK, Sutorejo, …), dan dari situ kurir bisa
   dipetakan.

   Pemetaan ini disalin apa adanya dari script.js (SHIPPING_COURIER_GROUPS,
   baris 364) supaya angkanya sama dengan laporan versi lama. Menambah atau
   memindahkan kurir di sini = mengubah laporan, jadi harus disadari.
   ========================================================================== */

export const KURIR_GROUPS: { kurir: string; tags: string[] }[] = [
  { kurir: "Hide/Vendi", tags: ["ITS"] },
  { kurir: "Yanto", tags: ["Sutorejo", "BPD", "Mulyosari", "Dharmahusada", "Wisper"] },
  { kurir: "Sudes", tags: ["Kenjeran", "Pakuwon", "Pantai Mentari", "Bhaskara"] },
  { kurir: "GOJEK", tags: ["GOJEK"] },
];

/* Label yang sama dengan script.js — dipakai untuk struk yang benar-benar
   tidak punya jejak area. */
export const TAG_TANPA_PEMETAAN = "Tanpa tag / Belum dipetakan";

const KURIR_DARI_TAG = new Map(
  KURIR_GROUPS.flatMap((g) => g.tags.map((t) => [kunciTag(t), g.kurir] as const)),
);

/** "Sutorejo", " sutorejo ", "Sutorejo " semua berarti hal yang sama. */
function kunciTag(tag: string): string {
  return tag.trim().replace(/\s+/g, " ").toLowerCase();
}

export function kurirDariTag(tag: string | null | undefined): string {
  if (!tag) return "";
  return KURIR_DARI_TAG.get(kunciTag(tag)) ?? "";
}

/* -------------------------------------------------------------------------
   Tag dari nama pelanggan.

   Sales menyimpan `customer_name` bebas (mis. "Bhas 7/17"), sedangkan
   customers menyimpan nama lengkap ("Bhaskara 7/17"). Jadi selain cocok
   persis, ada dua cadangan: cocok longest-substring, lalu tebak dari kata
   area yang muncul di nama (itu yang dilakukan inferCustomerAddressTag di
   script.js lama).
   ---------------------------------------------------------------------- */

/** Kata area yang bisa dikenali langsung dari nama, longest-first supaya
    "Pantai Mentari" tidak tertangkap "Pantai". */
const KATA_AREA = KURIR_GROUPS.flatMap((g) => g.tags)
  .concat(["GOJEK", "gojek", "ITS"])
  .sort((a, b) => b.length - a.length);

function tagDariTeks(nama: string): string {
  const kecil = nama.toLowerCase();
  for (const area of KATA_AREA) {
    if (kecil.includes(area.toLowerCase())) return area;
  }
  return "";
}

/** Peta tag per pelanggan, siap dipakai oleh tagUntukNama. */
export function petaTag(
  customers: { name: string; tag: string | null }[],
): (nama: string) => string {
  const langsung = new Map<string, string>();
  const daftarTag: { nama: string; tag: string }[] = [];
  for (const c of customers) {
    const nama = c.name?.trim();
    if (!nama || !c.tag) continue;
    const tag = c.tag.trim();
    langsung.set(kunciTag(nama), tag);
    daftarTag.push({ nama, tag });
  }
  // Panjang dulu: "Bhaskara III" harus menang atas "Bhaskara".
  daftarTag.sort((a, b) => b.nama.length - a.nama.length);

  return (nama: string) => {
    const k = kunciTag(nama);
    const persis = langsung.get(k);
    if (persis) return persis;
    for (const s of daftarTag) {
      if (k.includes(kunciTag(s.nama))) return s.tag;
    }
    return tagDariTeks(nama);
  };
}

/* -------------------------------------------------------------------------
   Rekap
   ---------------------------------------------------------------------- */

export type BarisKurir = {
  kurir: string;
  /** Tag area yang jadi dasar pemetaan. */
  tag: string;
  count: number;
  total: number;
};

export type RekapKurir = {
  rows: BarisKurir[];
  total: number;
  strukBerongkir: number;
  /** Struk berongkir yang tag-nya tidak bisa dipetakan ke kurir mana pun. */
  tanpaTag: number;
  /** Tanggal transaksi paling awal & terakhir yang ikut dihitung — supaya
      judul kartu bisa menyebut rentangnya, bukan "--" menebak. */
  rentangAwal: string | null;
  rentangAkhir: string | null;
};

/** sales: ongkir sudah diturunkan (ongkirDari), bukan kolom yang dibaca. */
export function rekapOngkirPerKurir(
  sales: { ongkir: number; statusTerhapus: boolean; customerName: string; tanggal?: string }[],
  tagUntukNama: (nama: string) => string,
): RekapKurir {
  const perKurir = new Map<string, BarisKurir>();
  let total = 0;
  let strukBerongkir = 0;
  let tanpaTag = 0;
  let awal: string | null = null;
  let akhir: string | null = null;

  for (const s of sales) {
    if (s.statusTerhapus) continue;
    const ongkir = s.ongkir ?? 0;
    const tag = tagUntukNama(s.customerName ?? "").trim();
    if (ongkir <= 0 && !tag) continue;

    const kurir = kurirDariTag(tag);
    const key = kurir ? `${kurir}|${tag}` : `|${tag || TAG_TANPA_PEMETAAN}`;
    const baris = perKurir.get(key) ?? {
      kurir: kurir || TAG_TANPA_PEMETAAN,
      tag: tag || TAG_TANPA_PEMETAAN,
      count: 0,
      total: 0,
    };
    baris.count += 1;
    baris.total += ongkir;
    perKurir.set(key, baris);

    if (ongkir > 0) {
      total += ongkir;
      strukBerongkir += 1;
    }
    if (!kurir) tanpaTag += 1;

    const t = (s.tanggal ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      if (!awal || t < awal) awal = t;
      if (!akhir || t > akhir) akhir = t;
    }
  }

  const rows = [...perKurir.values()].sort(
    (a, b) => b.total - a.total || b.count - a.count || a.kurir.localeCompare(b.kurir, "id-ID"),
  );
  return { rows, total, strukBerongkir, tanpaTag, rentangAwal: awal, rentangAkhir: akhir };
}

/* -------------------------------------------------------------------------
   Kelompokan per kurir.

   Yang dicari kasir adalah "berapa yang Vendi bawa", bukan "berapa yang
   kiriman ke Kenjeran". Jadi baris dalam (kurir, area) digabung lagi
   menjadi satu baris per kurir, dengan rincian area di dalamnya.
   ---------------------------------------------------------------------- */

export type KurirTotal = {
  kurir: string;
  count: number;
  total: number;
  /** Rincian area milik kurir ini, urut ongkir terbesar. */
  areas: BarisKurir[];
  /** true kalau ini kelompok "tanpa tag" — bukan kurir sungguhan. */
  belumDipetakan: boolean;
};

export function grupPerKurir(rows: BarisKurir[]): KurirTotal[] {
  const peta = new Map<string, KurirTotal>();
  for (const r of rows) {
    const g = peta.get(r.kurir) ?? {
      kurir: r.kurir,
      count: 0,
      total: 0,
      areas: [],
      belumDipetakan: r.kurir === TAG_TANPA_PEMETAAN,
    };
    g.count += r.count;
    g.total += r.total;
    g.areas.push(r);
    peta.set(r.kurir, g);
  }
  return [...peta.values()]
    .map((g) => ({ ...g, areas: g.areas.sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag)) }))
    .sort((a, b) => b.total - a.total || b.count - a.count || a.kurir.localeCompare(b.kurir, "id-ID"));
}
