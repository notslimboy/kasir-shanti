import { AWALAN_TAG, inferTagArea, tagDariAlias } from "./tag-area";

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
  { kurir: "Raka/Vendi", tags: ["ITS"] },
  { kurir: "Yanto", tags: ["Sutorejo", "BPD", "Mulyosari", "Dharmahusada", "Wisper"] },
  { kurir: "Sudes", tags: ["Kenjeran", "Pakuwon", "Pantai Mentari", "Bhaskara"] },
  { kurir: "GOJEK", tags: ["GOJEK"] },
];

/* Label yang sama dengan script.js — dipakai untuk struk yang benar-benar
   tidak punya jejak area. */
export const TAG_TANPA_PEMETAAN = "Tanpa tag / Belum dipetakan";

/** Bentuk baris `customer_aliases` yang dipakai untuk mencari tag. */
export type AliasTag = { customer_id: number; alias: string };

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

/** Bentuk minimum customer untuk pencarian tag. */
type CustomerPetaTag = { id?: string; name: string; tag: string | null };

/** Peta tag per pelanggan, siap dipakai oleh tagUntukNama.
 *
 *  Urutan sumber tag, dari yang paling dapat dipercaya:
 *
 *  1. `customers.tag` — nilai yang benar-benar tersimpan.
 *  2. Alias berawalan `tagalamat:` — tag yang disimpan di tabel alias
 *     karena kolomnya belum terisi.
 *  3. Nama pelanggan — supaya alias yang tidak punya tag pun bisa
 *     diinferensi, bukan cuma nama yang ada di struk.
 *  4. `inferTagArea` pada nama yang dicari — nama struk sering bukan
 *     nama customers, jadi aturannya harus tetap berlaku di sini.
 *
 *  Yang tadinya hanya membaca kolom `tag` membuat "Anis BTH" tampil
 *  tanpa area, padahal tag-nya `ITS` tersimpan di alias `ANIS BRIN`.
 *
 *  Fungsi yang dikembalikan mencocokkan nama di struk ke nama pelanggan
 *  DAN ke aliasnya, karena kasir menulis nama yang sama dengan beberapa
 *  ejaan: "Anis BTH", "Anish BTH", dan "ANIS BRIN" semuanya pelanggan yang
 *  sama. Alias tanpa tag tidak menambah apa pun — tag tetap hanya datang
 *  dari pelanggan yang memang punya.
 */
export function petaTag(
  customers: CustomerPetaTag[],
  alias: readonly AliasTag[] = [],
): (nama: string) => string {
  const langsung = new Map<string, string>();
  const daftarTag: { nama: string; tag: string }[] = [];

  /* Alias yang dikenal kasir, dipakai untuk mengenali nama di struk yang
     BUKAN nama customer-nya ("Anish BTH" untuk "Anis BTH"). Dipisah dari
     `daftarTag` karena urutannya harus di bawah: nama resmi lebih tepat,
     alias cuma nama lain yang kebetulan dipakai. */
  const dariAlias = new Map<string, string>();
  const daftarAlias: { nama: string; tag: string }[] = [];

  /* Alias dikelompokkan per customer_id, bukan dicocokkan lewat nama.
     Pencocokan nama rapuh: "Bhas Sari 38" dan "Bhaskara sari 38" beda satu
     huruf, dan pencocokan longgar bisa menempelkan tag ke customer yang
     kebetulan mirip — setelah itu struk masuk ke area yang salah. */
  const aliasPerCustomer = new Map<number, string[]>();
  for (const a of alias) {
    const arr = aliasPerCustomer.get(a.customer_id);
    if (arr) arr.push(a.alias);
    else aliasPerCustomer.set(a.customer_id, [a.alias]);
  }
  /* `id` di UI dibuat dari kolom id numerik ("c1902"), jadi hubungannya
     ke baris aslinya harus dibaca balik dari situ. Kalau format itu
     berubah, tag tersimpan di alias ikut hilang — bukan error, hanya
     area yang kosong. */
  const nomorDari = (id: string | undefined): number | null => {
    const m = /^c(\d+)$/.exec(String(id ?? ""));
    return m ? Number(m[1]) : null;
  };

  for (const c of customers) {
    const nama = c.name?.trim();
    if (!nama) continue;
    const nomor = nomorDari(c.id);
    /* Kolom tag lebih dulu. Alias `tagalamat:` baru dipakai kalau kolomnya
       kosong — kalau keduanya ada dan berbeda, kolom yang menang karena
       itu yang di-maintenance manual. */
    const dariKolom = c.tag?.trim();
    const aliasCustomer = aliasPerCustomer.get(nomor ?? -1) ?? [];
    const dariAliasTersimpan = tagDariAlias(aliasCustomer);
    const tag = dariKolom || dariAliasTersimpan || inferTagArea(nama, aliasCustomer);
    if (!tag) continue;
    langsung.set(kunciTag(nama), tag);
    daftarTag.push({ nama, tag });
    /* Nama lain untuk customer yang sama ikut dipetakan. Tanpa ini, struk
       yang ditulis "Anish BTH" tampil tanpa area walau pelanggannya jelas
       "Anis BTH" — dan rekap ongkir per kurir kehilangan struknya.
       `tagalamat:` dilewati: itu tempat menyimpan tag, bukan nama orang. */
    for (const a of aliasCustomer) {
      const kunci = kunciTag(a);
      if (!kunci || kunci.startsWith(AWALAN_TAG)) continue;
      if (!dariAlias.has(kunci)) dariAlias.set(kunci, tag);
      daftarAlias.push({ nama: a, tag });
    }
  }

  // Panjang dulu: "Bhaskara III" harus menang atas "Bhaskara".
  daftarTag.sort((a, b) => b.nama.length - a.nama.length);
  daftarAlias.sort((a, b) => b.nama.length - a.nama.length);

  return (nama: string) => {
    const k = kunciTag(nama);
    const persis = langsung.get(k) ?? dariAlias.get(k);
    if (persis) return persis;
    /* Nama resmi dulu, baru alias: kalau dua pelanggan berbeda punya nama
       yang saling mengandung, yang namanya tertulis di struk harus menang
       atas alias pelanggan lain. */
    for (const s of daftarTag) {
      if (k.includes(kunciTag(s.nama))) return s.tag;
    }
    for (const s of daftarAlias) {
      if (k.includes(kunciTag(s.nama))) return s.tag;
    }
    /* Nama di struk sering bukan nama di customers — kasir menyingkat
       ("Bhas 7/17"), atau struk lama memakai nama yang sudah diganti. Aturan
       lengkap di sini, karena nama yang dicari tidak ada di peta mana pun. */
    const tebak = inferTagArea(nama);
    return tebak || tagDariTeks(nama);
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
