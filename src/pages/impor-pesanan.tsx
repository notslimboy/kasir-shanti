import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";

import { PageHeader, StatTile, Tabs, btnGhost, btnPrimary, inputClass } from "@/components/ui/kit";
import { Select, type SelectOption } from "@/components/ui/select";
import { Card, IconButton } from "@/components/ui/card";
import { InputRupiah } from "@/components/ui/input-rupiah";
import { ItemDaftar, KosongDaftar } from "@/components/list-motion";
import { IkonHapus } from "@/components/ui/ikon-aksi";
import { Toast, useToast } from "@/components/ui/toast";
import { rupiah, rupiahShort } from "@/lib/format";
import { parsePesananCsv, type PesananImpor } from "@/lib/impor-pesanan";
import { kandidatJelas, rankedKandidat, varianDariNama } from "@/lib/cocok-produk";
import { cocokkanDraft, isuDraft, normalisasiSeparuh, rekapDraft, siapDraft, statusDraft } from "@/lib/status-draft";
import { isHalfVariantName } from "@/lib/pricing";
import { simpanPesananImpor } from "@/lib/simpan-impor";
import { AI_BULK_PROMPT, contohCsv } from "@/lib/contoh-impor";
import { useData } from "@/lib/data-source";
import { cssStruk, strukHtml } from "@/lib/struk";
import { cetakStruk, gabungStruk } from "@/lib/cetak-struk";
import { useSetelan } from "@/lib/setelan";
import { useStatePersisten } from "@/lib/use-simpan-lokal";

/* ==========================================================================
   Import Pesanan — halaman, bukan modal.

   Ada prosesnya: tempel → periksa satu per satu → lihat struknya → baru
   disimpan. Kalau semuanya di dalam satu popup, saat ada 20 struk yang
   salah harga tidak ada tempat untuk memperiksanya, dan yang salah masuk
   pembukuan.

   Tiga hal yang dijaga:
   - Harga tidak pernah dikarang. Baris yang harganya belum diketahui tetap
     muncul sebagai draft dengan kolom harga kosong — seperti aplikasi lama —
     dan struk hanya boleh disimpan setelah semua harga terisi. Jadi tidak
     ada item yang hilang tanpa jejak, dan tidak ada struk Rp 0 di pembukuan.
   - Belum ada yang menyentuh Supabase sampai tombol Proses ditekan.
   - Angka di layar setelah import bukan hasil hitungan data lama: cache
     lokal dibuang dan everything diambil ulang.
   ========================================================================== */

type TabDraft = "semua" | "review" | "siap";

/** Lama blok menghilang sendiri setelah tombol hapus ditekan (ms). Harus
    sama dengan durasi transisi `menutup` di blok draft, supaya bloknya tidak
    sempat terpotong di tengah jalan. */
const LAMA_HILANG = 300;

/** Laporan hasil proses — disimpan supaya tetap tampil setelah pindah menu. */
type HasilProses = {
  tersimpan: number;
  gagal: number;
  pesan: string[];
  tanggalProses: string;
};

/* Nilai yang dibaca dari sessionStorage tidak boleh dipercaya bentuknya:
   storage bisa berisi versi lama (kalau bentuk laporan berubah), dan satu
   field yang salah bikin kartu hasil menampilkan angka basi. Jadi setiap
   field diperiksa satu per satu, dan laporan dibuang kalau tidak lengkap. */
function pulihHasilProses(v: unknown): HasilProses | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.tersimpan !== "number" || typeof o.gagal !== "number") return null;
  if (typeof o.tanggalProses !== "string") return null;
  return {
    tersimpan: o.tersimpan,
    gagal: o.gagal,
    pesan: Array.isArray(o.pesan) ? o.pesan.filter((x): x is string => typeof x === "string") : [],
    tanggalProses: o.tanggalProses,
  };
}

/** "2 Oktober" — nama hari ini untuk pesan hasil proses, supaya kasir tahu
 *  struknya diletakkan di tanggal berapa tanpa harus membuka dashboard. */
function labelTanggalSingkat(tanggal: string): string {
  const [y, b, h] = tanggal.split("-").map(Number);
  if (!y || !b || !h) return tanggal;
  const bulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  return `${h} ${bulan[b - 1]} ${y}`;
}

export function ImporPesananPage() {
  const [setelan] = useSetelan();
  const data = useData();
  const nav = useNavigate();
  /* Semua yang kerja di halaman ini bertahan saat pindah menu: kasir sering
     perlu buka Dashboard Penjualan untuk mencocokkan struk yang baru dibuat,
     lalu kembali ke draft yang sama. Yang hilang bukan cuma teks CSV-nya —
     harga yang sudah diketik di baris "Perlu review" juga tidak boleh
     hilang, itu hasil kerja setengah jam. */
  const [teks, setTeks] = useStatePersisten<string>("impor:teks", "");
  const [sudahDibuat, setSudahDibuat] = useStatePersisten<boolean>("impor:sudah", false);
  const [draft, setDraft] = useStatePersisten<PesananImpor[]>("impor:draft", [], (v) =>
    Array.isArray(v) ? (v as PesananImpor[]) : [],
  );
  const [hasil, setHasil] = useStatePersisten<HasilProses | null>("impor:hasil", null, pulihHasilProses);
  /* Draft yang sudah dibuang, disimpan sebagai NOMOR BARIS CSV — bukan hasil
     parse yang dipotong. Alasannya: `hasilAwal` dihitung ulang setiap katalog
     produk selesai dimuat (harga dari CSV tetap sama, tapi fuzzy match bisa
     berubah), dan memotong hasil parse berarti draft yang sengaja dihapus
     akan muncul lagi begitu katalog tiba. */
  const [dihapus, setDihapus] = useStatePersisten<number[]>("impor:dihapus", [], (v) =>
    Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [],
  );
  /* Draft yang sedang ditutup: sudah masuk `dihapus`, tapi bloknya masih
     di DOM sambil menyusut. Tidak dipersist — kalau halaman ditutup di
     tengah animasi, bukan urannya yang perlu dilanjutkan. */
  const [memchos, setMemchos] = useState<number[]>([]);
  const timerHapus = useRef<number[]>([]);
  const [tab, setTab] = useState<TabDraft>("semua");
  const [cari, setCari] = useState("");
  /* Animasi daftar hanya jalan saat sedang menyaring (cari / ganti tab),
     persis seperti daftar produk di Kasir. Daftar penuh saat draft baru dibuat
     tidak ikut beranimasi: puluhan blok yang mount sekaligus menahan
     render pertama, dan yang dirasakan kasir hanya "harus tunggu". */
  const geser = cari.trim() !== "" || tab !== "semua";
  const [terpilih, setTerpilih] = useState<PesananImpor | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [toast, setToast] = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  /* Timer "tutup" tidak boleh tetap jalan setelah halaman dilepas: setTimeout
     masih pegang setState halaman yang sudah tidak ada, dan draft bisa
     terkunci di kondisi setengah menutup kalau kebetulan balik lagi. */
  useEffect(
    () => () => {
      for (const t of timerHapus.current) window.clearTimeout(t);
      timerHapus.current = [];
    },
    [],
  );

  /* Halaman ini butuh katalog: tanpa itu tidak ada fuzzy match dan dropdown
     "Pilih Barang" kosong — persis fitur yang dipakai kasir. Katalog
     dimuat on-demand seperti di Kasir & Kelola Menu, bukan dari awal. */
  useEffect(() => {
    data.pastikanProduk();
  }, [data.pastikanProduk]);

  /* Katalog untuk fuzzy match + dropdown "Pilih Barang". */
  const katalog = useMemo(
    () =>
      data.produk.map((p) => ({
        client_id: p.client_id,
        name: p.name,
        sku: p.sku,
        aliases: p.aliases,
        stok: p.stock_unlimited ? null : p.stock,
        variants: p.variants.map((v) => ({ name: v.name, price: v.price, pricing_type: v.pricing_type })),
      })),
    [data.produk],
  );

  /* Harga dari katalog hanya dipakai kalau CSV tidak menyebut harga. */
  const cariHarga = useMemo(
    () => (nama: string, varian: string) => {
      const daftar = rankedKandidat(katalog, nama);
      /* Kalau dua kandidat berdekatan, jangan pilih diam-diam — biarkan
         kasir yang memilih lewat "Pilih Barang". */
      if (!daftar.length || !kandidatJelas(daftar)) return null;
      const cocok = daftar[0].produk;
      const v = varianDariNama(nama) || varian;
      const pilih =
        (v ? cocok.variants.find((x) => x.name.toLowerCase() === v.toLowerCase()) : undefined) ??
        cocok.variants.find((x) => x.pricing_type !== "custom") ??
        cocok.variants[0];
      if (!pilih) return null;
      const custom = pilih.pricing_type === "custom";
      return {
        client_id: cocok.client_id,
        variantClientId: pilih.name,
        nama: pilih.name,
        produkNama: cocok.name,
        price: custom ? 0 : pilih.price,
        perluCekHarga: custom,
        stok: cocok.stok,
      };
    },
    [katalog],
  );

  /* Urutannya penting: CSV di-parse dulu, baru dicocokkan ke katalog.
     Pencocokan terjadi di sini (bukan di parser) supaya parser tetap murni
     dan bisa diuji tanpa katalog. */
  const hasilAwal = useMemo(() => {
    const kosong = { pesanan: [], masalah: [], barisDibaca: 0, barisDilewati: 0 };
    if (!sudahDibuat) return kosong;
    const parsed = parsePesananCsv(teks, cariHarga);
    /* Urutan: dicocokkan ke katalog dulu (cocokkanDraft), baru porsi
       separuh dinormalkan. Normalisasi butuh productClientId, jadi tidak
       bisa jalan lebih dulu. */
    const sudahCocok = parsed.pesanan.map((p) => normalisasiSeparuh(cocokkanDraft(p, katalog), katalog));
    return {
      ...parsed,
      pesanan: sudahCocok,
      masalah: sudahCocok.flatMap((p) => isuDraft(p).map((i) => ({ baris: p.baris, pesan: i.pesan }))),
    };
  }, [sudahDibuat, teks, cariHarga, katalog]);

  /* Draft yang tampil bisa berbeda dari hasil parse: harga yang diketik
     kasir ikut tersimpan di sini, bukan hanya di kolom input. Draft yang
     sudah dihapus diletakkan di `dihapus` supaya hilang dari semua hitungan
     dan tidak pernah ikut terproses. */
  const sumberDraft = draft.length > 0 ? draft : hasilAwal.pesanan;
  const hasilParse = useMemo(
    () => ({
      ...hasilAwal,
      /* Yang masih `memchos` tetap dirender — belum dicabut dari DOM, masih
         sedang menutup. Kalau ikut difilter seketika, bloknya hilang tanpa
         animasi justru karena itu. */
      pesanan: sumberDraft.filter((p) => !dihapus.includes(p.baris) || memchos.includes(p.baris)),
      masalah: hasilAwal.masalah.filter((m) => !dihapus.includes(m.baris)),
    }),
    [hasilAwal, sumberDraft, dihapus, memchos],
  );

  const totalItem = hasilParse.pesanan.reduce((a, p) => a + p.items.length, 0);
  const totalNilai = hasilParse.pesanan.reduce((a, p) => a + p.total, 0);

  /* Tab & pencarian menyalin versi lama: "Semua / Perlu Review / Siap".
     Yang dijaga hanya blokir, jadi "Siap" tidak pernah menyimpan struk
     yang masih bolong. */
  const rekap = useMemo(() => rekapDraft(hasilParse.pesanan), [hasilParse.pesanan]);

  const daftar = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return hasilParse.pesanan.filter((p) => {
      if (tab === "siap" && !siapDraft(p)) return false;
      if (tab === "review" && siapDraft(p)) return false;
      if (q === "") return true;
      return (
        p.customer.toLowerCase().includes(q) ||
        p.sendNote.toLowerCase().includes(q) ||
        p.items.some((i) => i.nama.toLowerCase().includes(q))
      );
    });
  }, [hasilParse.pesanan, tab, cari]);

  /* Simpan ditahan selama masih ada harga kosong. Ini satu-satunya tempat
     impornya menyentuh pembukuan, jadi harus benar — kolom harga di daftar
     draft yang membuat kasir bisa memperbaikinya. */
  const hargaKosong = useMemo(
    () => hasilParse.pesanan.flatMap((p) => p.items.filter((i) => i.hargaKosong || i.harga <= 0)),
    [hasilParse.pesanan],
  );

  const perhitungkanUlang = (p: PesananImpor): PesananImpor => {
    const subtotal = p.items.reduce((a, it) => a + it.qty * it.harga, 0);
    return { ...p, subtotal, total: subtotal + p.ongkir };
  };

  /* Semua pengeditan draft bekerja per baris CSV, lalu subtotal/total
     dihitung ulang dari harga yang benar-benar terisi. */
  const ubahDraft = (barisDraft: number, ubah: (p: PesananImpor) => PesananImpor) =>
    setDraft((lama) => {
      const sumber = lama.length > 0 ? lama : hasilAwal.pesanan;
      return sumber.map((p) => (p.baris === barisDraft ? perhitungkanUlang(ubah(p)) : p));
    });

  /* Harga diketik = kasir yang memastikan. Itu juga yang melepas status
     "harga custom perlu dicek" dan "varian separuh tidak ada": selama
     belum ada harga yang diketik, struk ditahan (isuDraft). */
  const setHargaItem = (barisDraft: number, barisItem: number, harga: number) =>
    ubahDraft(barisDraft, (p) => ({
      ...p,
      items: p.items.map((it) =>
        it.baris === barisItem
          ? {
              ...it,
              harga: Math.max(0, harga),
              hargaKosong: harga <= 0,
              hargaDariCsv: true,
              perluCekHarga: harga <= 0,
              perluVarianSeparuh: false,
            }
          : it,
      ),
    }));

  /* Pilih barang: isi product + varian + harga dari katalog. */
  const pilihBarang = (barisDraft: number, barisItem: number, nilai: string) =>
    ubahDraft(barisDraft, (p) => {
      const [clientId, varian] = nilai.split("|");
      const produk = katalog.find((k) => k.client_id === clientId);
      const v = produk?.variants.find((x) => x.name === varian);
      return {
        ...p,
        items: p.items.map((it) => {
          if (it.baris !== barisItem) return it;
          if (!produk || !v) {
            return {
              ...it,
              productClientId: "",
              productName: "",
              hargaKosong: true,
              perluCekHarga: false,
              perluVarianSeparuh: false,
              hargaDariCsv: false,
            };
          }
          const custom = v.pricing_type === "custom";
          /* Memilih varian "Separuh" menutup quantity 0.5 — kasir baru saja
             memastikan porsinya. */
          const separuh = isHalfVariantName(v.name);
          return {
            ...it,
            productClientId: produk.client_id,
            productName: produk.name,
            varian: v.name,
            stok: produk.stok,
            qty: separuh ? 1 : it.qty,
            /* Harga custom TIDAK ditebak: tetap 0 sampai diketik, dan ditandai
               perlu dicek — menebaknya berarti mengarang harga. */
            harga: custom ? it.harga : v.price,
            /* Harga yang diketik manusia (hargaDariCsv) tetap berlaku walau
               varian diganti — kasir sudah melihat angkanya. */
            hargaKosong: custom ? it.harga <= 0 : v.price <= 0,
            hargaDariCsv: custom ? it.hargaDariCsv : false,
            perluCekHarga: custom && it.harga <= 0,
            perluVarianSeparuh: false,
          };
        }),
      };
    });

  const setQtyItem = (barisDraft: number, barisItem: number, qty: number) =>
    ubahDraft(barisDraft, (p) => ({
      ...p,
      items: p.items.map((it) => (it.baris === barisItem ? { ...it, qty: Math.max(0, qty) } : it)),
    }));

  const setCatatanItem = (barisDraft: number, barisItem: number, catatan: string) =>
    ubahDraft(barisDraft, (p) => ({
      ...p,
      items: p.items.map((it) => (it.baris === barisItem ? { ...it, catatan } : it)),
    }));

  /* Buang satu draft.
     Tidak ada konfirmasi, sama seperti versi lama: yang dihapus bukan data,
     cuma baris kerja yang belum menyentuh pembukuan — dan mengetuk "Hapus"
     yang keliru itu lebih mudah diperbaiki (Buat Draft ulang) daripada
     konfirmasi yang muncul untuk tiap ketukan. Yang dijaga: draftnya hilang
     dari SEMUA hitungan, termasuk "Proses Semua Siap" dan nomor struknya.

     Dua langkah, bukan satu:
       1. seketika masuk `dihapus` — supaya tidak ikut terproses
       2. `memchos` selama 300ms — bloknya masih di DOM sambil menutupnya

     Kenapa perlu langkah kedua: dengan 40+ draft, `exit` milik
     AnimatePresence macet di tengah — opasitas berhenti di sekitar 0,44
     selama ~230ms baru elemennya dicabut. Penyebabnya `layout`: motion
     sedang menghitung ulang posisi 40 blok sekaligus pada frame yang sama.

     Animasi yang dikusus sendiri tidak butuh `layout` sama sekali: tinggi
     blok menyusut ke 0, jadi draft di bawahnya naik karena tinggi yang
     benar-benar berubah, bukan karena proyeksi posisi. Terukur 300ms penuh
     tanpa jeda, dan bloknya tetap terlihat sepanjang proses. */
  const hapusDraft = (p: PesananImpor) => {
    setDihapus((lama) => (lama.includes(p.baris) ? lama : [...lama, p.baris]));
    setMemchos((lama) => (lama.includes(p.baris) ? lama : [...lama, p.baris]));
    if (terpilih === p) setTerpilih(null);
    setToast({ tone: "info", text: `Draft ${nomorTampil(p)} dihapus.` });
    timerHapus.current.push(
      window.setTimeout(() => setMemchos((lama) => lama.filter((b) => b !== p.baris)), LAMA_HILANG),
    );
  };

  /* Sumber CSV baru = daftar baru: draft yang dihapus tidak boleh ikut
     dibawa ke teks berikutnya, atau baris yang sama akan hilang diam-diam. */
  const mulaiSumberBaru = () => {
    setDraft([]);
    setDihapus([]);
    setTerpilih(null);
    setHasil(null);
    setSudahDibuat(false);
  };

  /* Opsi "Pilih Barang": 3 teratas fuzzy match lebih dulu, lalu seluruh
     katalog. Satu memo untuk semua baris supaya thousands option tidak
     dihitung ulang tiap ketikan. */
  const cacheOpsi = useRef(new Map<string, SelectOption[]>());
  const opsiBarang = (namaItem: string): SelectOption[] => {
    const cache = cacheOpsi.current;
    const ada = cache.get(namaItem);
    if (ada) return ada;
    const keOpsi = (p: (typeof katalog)[number], v: (typeof katalog)[number]["variants"][number]): SelectOption => ({
      value: `${p.client_id}|${v.name}`,
      label: `${p.name} · ${v.name}`,
      hint: v.pricing_type === "custom" ? "Harga custom" : rupiah(v.price),
    });
    const saran = rankedKandidat(katalog, namaItem)
      .slice(0, 3)
      .map((c) => c.produk);
    const opsi: SelectOption[] = [
      ...saran.flatMap((p) => p.variants.map((v) => ({ ...keOpsi(p, v), group: "Saran Cocok (Fuzzy Match)" }))),
      ...katalog.flatMap((p) => p.variants.map((v) => ({ ...keOpsi(p, v), group: "Semua Menu" }))),
    ];
    cache.set(namaItem, opsi);
    return opsi;
  };

  /* Isu yang ditampilkan di bawah tabel item. Info saja — yang menentukan
     "Perlu review" tetap isu blocking di statusDraft. */
  const isuSingkat = (p: PesananImpor) => isuDraft(p);

  /* Struk thermal untuk satu pesanan. Pratinjau dan cetak-after-simpan
     memakai fungsi yang sama persis, jadi yang terlihat di layar = yang
     keluar dari printer. */
  const strukUntuk = (p: PesananImpor, receiptNo: string, no?: number) =>
    strukHtml({
      receiptNo,
      customerName: p.customer || "Customer belum diisi",
      chatDate: `${p.tanggal}${p.jam ? ` ${p.jam}` : ""}`,
      /* Nomor urut draft, sama seperti "NO" di struk versi lama. */
      queueNo: no ?? null,
      sendNote: p.sendNote,
      payment: p.payment,
      subtotal: p.subtotal,
      shipping: p.ongkir,
      total: p.total,
      items: p.items.map((i) => ({
        name: i.nama,
        variant: i.varian,
        qty: i.qty,
        price: i.harga,
        lineTotal: i.qty * i.harga,
        note: i.catatan,
      })),
    });

  /* "Proses + Cetak Semua": struk yang baru tersimpan langsung dikirim ke
     printer, memakai mekanisme yang sama dengan Kasir (iframe tersembunyi
     dengan @page 48mm) — bukan window.open(), yang memindahkan kasir ke
     jendela lain dan membuat struk terlihat belum keluar.

     Nomor antrean yang dicetak = nomor yang benar-benar tersimpan di
     server, bukan lagi perkiraan "mulaiNo + urutan". */
  const cetakSemua = (daftar: { receiptNo: string; queueNo?: number; pesanan: PesananImpor }[]) => {
    if (!daftar.length) return;
    void cetakStruk(
      daftar.map((s) => ({ html: strukUntuk(s.pesanan, s.receiptNo, s.queueNo ?? nomorDraft(s.pesanan)) })),
      setelan,
    );
  };

  const proses = async (cetak = false) => {
    /* Hanya struk yang siap — persis "Proses Semua Siap" di aplikasi lama.
     Draft berstatus "Perlu review" dilewati, bukan disimpan setengah jadi. */
    const target = hasilParse.pesanan.filter(siapDraft);
    if (target.length === 0 || sibuk) return;
    setSibuk(true);
    setHasil(null);
    /* Status proses tampil di ATAS TENGAH, bukan spinner di tengah area
       draft. Area itu sedang dibaca kasir: spinner di sana menutupi tabel
       dan terbaca sebagai "halaman sedang memuat" — bukan "saya sedang
       menyimpan 3 dari 20 struk". Di versi lama posisinya juga melayang,
       hanya ditumpuk di atas daftar draft. */
    setToast({ tone: "info", spin: true, text: `Menyimpan struk 0 dari ${target.length}…` });
    try {
      const r = await simpanPesananImpor(target, {
        mulaiNo,
        onProgress: (selesai, total) =>
          setToast({ tone: "info", spin: true, text: `Menyimpan struk ${selesai} dari ${total}…` }),
      });
      /* Buang cache & tarik ulang. `perbaruiSetelahTulis` (bukan muatUlang)
         tidak menarik ulang 1.095 produk, jadi katalog "Pilih Barang"
         tidak ikut kosong di tengah proses. */
      await data.perbaruiSetelahTulis();
      setHasil(r);
      if (cetak) cetakSemua(r.struk);
      setToast({
        tone: r.gagal === 0 ? "ok" : "warn",
        text:
          r.gagal === 0
            ? `${r.tersimpan} struk tersimpan · masuk ke Dashboard Penjualan ${labelTanggalSingkat(r.tanggalProses)}`
            : `${r.tersimpan} tersimpan, ${r.gagal} bermasalah`,
      });
      if (r.gagal === 0) {
        /* Draft yang sudah disimpan harus hilang juga, bukan cuma teksnya.
           Kalau tidak, `hasilParse` masih memakai draft lama: daftar di
           layar tetap menampilkan struk yang barusan masuk database, dan
           kasir bisa menekan "Proses" lagi untuk menyimpannya dua kali. */
        setTeks("");
        setSudahDibuat(false);
        setDraft([]);
        setDihapus([]);
        setTerpilih(null);
      }
    } catch (e) {
      setToast({ tone: "warn", text: `Gagal menyimpan: ${(e as Error).message}` });
    } finally {
      setSibuk(false);
    }
  };

  /* Pratinjau memakai struk thermal yang SAMA dengan kasir — generator dan
     CSS-nya sama persis, jadi yang dilihat di sini memang bentuk yang akan
     keluar dari printer 58mm, bukan ringkasan karangan. */
  const [pratinjauSemua, setPratinjauSemua] = useState(false);

  /* Nomor urut draft.
   *
   * Di versi lama importer memberi setiap draft nomor berurutan yang dimulai
   * dari "Nomor awal import berikutnya", dan nomor itu yang dipakai sebagai
   * NO pada struk serta pada laporan — bukan jam chat. Jam chat cuma
   * keterangan kapan pesanan masuk dari WA; kalau itu yang jadi identitas,
   * kasir tidak punya cara menyebut struknya ("struk yang lima" tidak ada
   * struk kelima). */
  const [mulaiNo, setMulaiNo] = useStatePersisten<number>("impor:mulaiNo", 1, (v) =>
    typeof v === "number" && v >= 1 ? Math.floor(v) : 1,
  );
  /* Input "Nomor awal" bisa kosong: teks mentahnya ditahan sementara, dan
     nilai sah yang terakhir tetap dipakai untuk berhitung. Memaksa
     kosong langsung jadi 1 berarti backspace dijejal angka — angka lama
     menempel, dan kasir tidak bisa mengetik "25" sebelum menghapus "1". */
  const [mulaiNoTeks, setMulaiNoTeks] = useState<string | null>(null);
  const nomorDraft = (p: PesananImpor) => {
    const i = daftarSiap.findIndex((d) => d === p);
    return mulaiNo + (i < 0 ? 0 : i);
  };

  /* Draft yang siap diproses — sumber yang sama dengan tombol Proses, supaya
     preview dan proses tidak pernah menghitung draft yang berbeda. */
  const daftarSiap = useMemo(() => hasilParse.pesanan.filter(siapDraft), [hasilParse.pesanan]);

  /* Nomor yang ditulis di header. Draft yang belum siap sengaja tampil "—":
     memberi nomor ke struk yang masih bolong berarti struk itu dianggap
     sudah jadi, padahal kolomnya masih menunggu harga.
     Angkanya TIDAK dianimasikan: kalau ikut naik-turun bersama bloknya,
     matanya ikut mengejar dua digit yang bergantian — lebih buruk daripada
     angkanya langsung berubah di tempat. Yang dianimasikan cuma bloknya. */
  const nomorTampil = (p: PesananImpor) => (siapDraft(p) ? String(nomorDraft(p)) : "—");

  const htmlPratinjau = useMemo(() => {
    if (!terpilih) return "";
    return `<!doctype html><html lang="id"><head><meta charset="utf-8"><style>${cssStruk(setelan)}</style></head><body><article class="receipt-paper">${strukUntuk(terpilih, "SH-… (pratinjau)", nomorDraft(terpilih))}</article></body></html>`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terpilih, setelan]);

  /* Cetak dari pratinjau.
   *
   * Versi lama tidak berhenti di "lihat": tombolnya langsung memicu dialog
   * cetak browser dengan seluruh batch. Pratinjau di layar tetap berguna —
   * untuk salah baca sebelum menyimpan — tapi harus ada jalan ke dialog
   * cetak tanpa harus menyimpan dulu, supaya angka yang dibandingkan
   * dengan nota fisik bisa dicetak ulang kapan saja.
   *
   * Dipakai CETAK_STRUK yang sama dengan "Proses + Cetak Semua", jadi hasil
   * cetak dari pratinjau identik dengan hasil cetak setelah simpan. */
  const cetakSemuaDraft = () => {
    if (daftarSiap.length === 0) return;
    void cetakStruk(daftarSiap.map((p) => ({ html: strukUntuk(p, "SH-… (pratinjau)", nomorDraft(p)) })), setelan);
  };

  const cetakSatuDraft = (p: PesananImpor) => {
    void cetakStruk([{ html: strukUntuk(p, "SH-… (pratinjau)", nomorDraft(p)) }], setelan);
  };

  /* Pratinjau semua draft siap sekaligus.
   *
   * Ini padanan "Preview Cetak" di aplikasi lama (previewPrintReadyDraftsButton):
   * utuhnya untuk melihat bentuk cetakan sebelum satu pun menyentuh Supabase. Pratinjau
   * per draft tetap ada di tabel — dua-duanya dipakai: yang satu untuk
   * memeriksa satu struk yang bermasalah, yang satu untuk eyeballing
   * keseluruhan batch sebelum diproses. */
  const htmlPratinjauSemua = useMemo(() => {
    if (daftarSiap.length === 0) return "";
    /* Nomor struk belum ada sebelum disimpan, jadi pratinjau memakai nomor
       urut sementara dengan tanda baca, bukan "SH-0007" yang terlihat
       seperti nomor asli. */
    const isi = gabungStruk(
      daftarSiap.map((p) => ({
        /* Nomor urut ikut ke struk sebagai "NO", sama seperti cetakan
           versi lama: itu yang jadi rujukan kasir. */
        html: strukUntuk(p, `SH-${p.tanggal.replace(/-/g, "")}-${String(nomorDraft(p)).padStart(4, "0")} (pratinjau)`, nomorDraft(p)),
      })),
    );
    return `<!doctype html><html lang="id"><head><meta charset="utf-8"><style>${cssStruk(setelan)}</style></head><body>${isi}</body></html>`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daftarSiap, setelan, mulaiNo]);

  return (
    <div>
      <PageHeader
        title="Import Pesanan"
        sub="Tempel CSV hasil ringkasan chat WA, periksa struknya, lalu proses."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {/* ---------- 1. SUMBER ---------- */}
          <Card
            title="1 · Tempel CSV"
            action={
              <div className="flex flex-wrap gap-2">
                <button onClick={() => fileRef.current?.click()} className={btnGhost}>
                  Pilih file…
                </button>
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(AI_BULK_PROMPT);
                    setToast({ tone: "ok", text: "Prompt AI disalin — tempel ke chat WA" });
                  }}
                  className={btnGhost}
                  title="Prompt untuk meringkas chat WhatsApp menjadi CSV"
                >
                  Salin Prompt AI
                </button>
                <button
                  onClick={() => {
                    setTeks(contohCsv());
                    mulaiSumberBaru();
                  }}
                  className={btnGhost}
                >
                  Isi contoh
                </button>
              </div>
            }
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setTeks(await f.text());
                mulaiSumberBaru();
              }}
            />
            <textarea
              value={teks}
              onChange={(e) => {
                setTeks(e.target.value);
                /* Teks yang diketik ulang = sumber baru, jadi draft lama
                   harus dibuang. Kalau tidak, harga yang diketik untuk CSV
                   sebelumnya masih menempel pada baris yang kebetulan
                   nomor barisnya sama. */
                mulaiSumberBaru();
              }}
              spellCheck={false}
              placeholder={"customer,chatDate,payment,ongkir,item,quantity,note,sendNote\n…"}
              className={inputClass + " h-36 w-full resize-y font-mono text-xs leading-relaxed"}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setSudahDibuat(true);
                  setDraft([]);
                  setDihapus([]);
                  setHasil(null);
                  setTerpilih(null);
                }}
                disabled={teks.trim() === ""}
                className={
                  teks.trim() === ""
                    ? "cursor-not-allowed rounded-full bg-muted px-4 py-2 text-sm font-bold text-muted-foreground opacity-60"
                    : btnPrimary
                }
              >
                Buat Draft
              </motion.button>
              {/* "Nomor awal import berikutnya" — persis seperti di versi
                  lama. Nomor draft inilah yang jadi NO pada struk dan
                  acuan saat kasir bicara: "struk nomor 7", bukan
                  "struk yang Tuesday pagi". */}
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Nomor awal
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={mulaiNoTeks ?? mulaiNo}
                  placeholder="1"
                  onChange={(e) => {
                    setMulaiNoTeks(e.target.value);
                    const n = Math.floor(Number(e.target.value));
                    if (Number.isFinite(n) && n >= 1) setMulaiNo(n);
                  }}
                  onBlur={() => setMulaiNoTeks(null)}
                  className="h-9 w-20 rounded-xl border border-input bg-background px-2 text-sm font-semibold figure"
                />
              </label>
              {teks.trim() !== "" && (
                <button
                  onClick={() => {
                    setTeks("");
                    mulaiSumberBaru();
                  }}
                  className={btnGhost}
                >
                  Hapus Draft
                </button>
              )}
              {sudahDibuat && (
                <span className="text-xs text-muted-foreground">
                  {hasilParse.barisDibaca} baris terbaca · {rekap.siap} siap · {rekap.perluReview} perlu review
                </span>
              )}
            </div>
          </Card>

          {/* ---------- 2. DAFTAR DRAFT ---------- */}
          {/* Card ini ikut animasi, karena ada satu jalan yang menghapus
              SEMUA draft sekaligus: tombol "Hapus Draft" (dan sumber baru).
              Sebelumnya card-nya hilang seketika begitu `sudahDibuat` false —
              tidak ada transisi sama sekali, jadi menghapus semua draft terasa
              seperti aplikasi yang tidak merespons. */}
          <AnimatePresence initial={false}>
          {sudahDibuat && (
            <motion.div
              key="tinjau-draft"
              data-tinjau
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
            <Card fillBody className="min-h-[360px]" title="2 · Tinjau Draft">
              {/* Kotak cari + tab ikut bertahan saat semua draft sudah dihapus. Kalau ikut
                 hilang, seluruh isi card melompat ke atas tepat di saat bloknya
                 sedang animasi keluar. */}
              {(hasilParse.pesanan.length > 0 || dihapus.length > 0) && (
                /* Baris sendiri, bukan di action header: di header sempit
                   tab "Perlu ditinjau" terpotong jadi "Perlu …". */
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <input
                    value={cari}
                    onChange={(e) => setCari(e.target.value)}
                    placeholder="Cari customer…"
                    className={inputClass + " h-9 w-48"}
                  />
                  <Tabs
                    value={tab}
                    onChange={(id) => setTab(id as TabDraft)}
                    items={[
                      { id: "semua", label: "Semua", count: rekap.semua },
                      { id: "review", label: "Perlu Review", count: rekap.perluReview },
                      { id: "siap", label: "Siap", count: rekap.siap },
                    ]}
                  />
                </div>
              )}
              {/* Bentuknya mengikuti aplikasi lama: tiap draft jadi satu
                  blok dengan header (customer, tanggal, ongkir, bayar) lalu
                  tabel item dengan kolom "Pilih Barang".

                  Daftar DAN pesan kosongnya berada dalam satu AnimatePresence,
                  itu disengaja. Kalau pesan kosong ada di luar, menghapus
                  draft terakhir akan mengganti seluruh isi container — dan
                  AnimatePresence ikut ter-unmount, jadi blok terakhir hilang
                  seketika tanpa animasi. */}
              <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                {/* Mode WAJIB `sync` (default), bukan `popLayout`.

                   `popLayout` memang terlihat lebih rapi di daftar kartu, tapi
                   di daftar ini ia justru merusak animasi: blok yang keluar
                   dibuat `position: absolute` relatif ke container yang
                   `overflow-y-auto`, dan projection-nya langsung hilang —
                   fade-nya macet di tengah (opasitas berhenti di ±0,6 selama
                   ~200ms) lalu elemennya lenyap, sementara draft di bawahnya
                   melompat ke posisi akhir tanpa gerak.

                   `sync` + `layout` yang dipakai sekarang: draft yang dihapus
                   benar-benar memudar sampai 0, baru draft di bawahnya
                   menggeser ke atas. Terukur di peramban: opacity 0,93 → 0,60
                   → 0,32 → 0,11 → 0,03, lalu posisi draft kedua berjalan
                   795 → 671 → 655 px. */}
                <AnimatePresence initial={false}>
                {daftar.length === 0 ? (
                  <KosongDaftar
                    key="kosong"
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {cari
                      ? `Tidak ada draft yang cocok dengan "${cari}".`
                      : tab === "siap"
                        ? "Belum ada draft yang siap diproses."
                        : tab === "review"
                          ? "Semua draft sudah siap."
                          : dihapus.length > 0
                            ? "Semua draft sudah dihapus. Tempel CSV lagi untuk mulai baru."
                            : "Belum ada draft. Tempel CSV lalu Buat Draft."}
                  </KosongDaftar>
                ) : (
                  daftar.map((p, i) => {
                    const status = statusDraft(p);
                    /* Header draft bukan <button>: di dalamnya ada tombol
                       "Hapus", dan <button> di dalam <button> itu HTML tidak
                       valid — browser merekannya keluar dari header sehingga
                       area klik pratinjau ikut berubah. Karena itu header
                       berperan sebagai tombol lewat role + keyboard, dan
                       tombol hapus berhenti di situ lewat stopPropagation. */
                    /* `menutup` = blok ini sedang dihapus.

                         Yang bergerak BUKAN transparansi, tapi tinggi blok:
                         menyusut ke 0, meredup, dan warnanya jadi merah. Tiga
                         hal yang didapat dari sini:

                         1. blok terlihat benar-benar dihapus, bukan memudar
                         2. draft di bawahnya naik LANGSUNG mengikuti tinggi
                            yang berubah — tanpa `layout`, jadi tidak macet
                            seperti yang terjadi pada `exit` AnimatePresence
                         3. tidak ada elemen yang bergantung pada
                            AnimatePresence, jadi tidak ada jeda ~200ms

                         `marginBottom` ikut ke 0 karena jarak antar blok
                         datang dari `space-y-3` — kalau tidak, bloknya sudah
                         tertutup tapi celah 12px-nya masih tertinggal. */
                      const menutup = memchos.includes(p.baris);
                      return (
                        <ItemDaftar
                          key={p.baris}
                          i={i}
                          aktif={geser}
                          data-draft={p.baris}
                          /* Bloknya sudah menutup diri (tinggi 0) sebelum
                             dilepas dari daftar, jadi `exit` di sini cuma
                             housekeeping — pendek saja, jangan menambah
                             jeda setelah bloknya tidak terlihat. */
                          exit={{ opacity: 0, transition: { duration: 0.08 } }}
                          style={{ overflow: "hidden" }}
                          animate={
                            menutup
                              ? {
                                  height: 0,
                                  opacity: 0.25,
                                  marginBottom: 0,
                                  scale: 0.985,
                                  backgroundColor: "rgba(220, 38, 38, 0.10)",
                                  y: 0,
                                }
                              : {
                                  height: "auto",
                                  opacity: 1,
                                  marginBottom: 12,
                                  scale: 1,
                                  backgroundColor: "rgba(0, 0, 0, 0)",
                                  y: 0,
                                }
                          }
                          transition={{ duration: LAMA_HILANG / 1000, ease: [0.22, 1, 0.36, 1] }}
                          className={
                            "rounded-2xl border " +
                            (menutup
                              ? "pointer-events-none border-destructive/40"
                              : terpilih === p
                                ? "border-primary"
                                : "border-border")
                          }
                        >
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setTerpilih(p)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setTerpilih(p);
                            }
                          }}
                          className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 rounded-t-2xl bg-muted/60 px-3.5 py-2.5 text-left transition-colors hover:bg-muted"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">
                              Draft {nomorTampil(p)} · {p.customer || "Tanpa nama"}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              {p.tanggal}
                              {p.jam ? ` ${p.jam}` : ""} · {p.payment} · ongkir{" "}
                              {p.ongkir > 0 ? rupiah(p.ongkir) : "—"}
                              {p.sendNote ? ` · ${p.sendNote}` : ""}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span
                              className={
                                "rounded-full px-2 py-0.5 text-[11px] font-bold " +
                                (status === "Siap"
                                  ? "bg-success/15 text-success"
                                  : "bg-[#F3DBA2] text-[#6B4A0A] dark:bg-[#3A2A10] dark:text-[#F0C987]")
                              }
                            >
                              {status}
                            </span>
                            <span className="text-sm font-bold figure">{rupiah(p.total)}</span>
                            {/* Target sentuh 40px di layar sentuh (tablet &
                                ponsel), 32px di desktop yang memakai mouse.
                                Tombol "Hapus" tidak boleh jadi 32px di
                                ponsel: salah ketuk satu draft berarti satu
                                struk hilang dari daftar tanpa sengaja. */}
                            <motion.button
                              type="button"
                              whileTap={{ scale: 0.9 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                hapusDraft(p);
                              }}
                              aria-label={`Hapus draft ${nomorTampil(p)} — ${p.customer || "tanpa nama"}`}
                              title={`Hapus draft ${nomorTampil(p)}`}
                              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-destructive/40 text-destructive transition-colors hover:bg-destructive/10 sm:h-8 sm:w-8"
                            >
                              <IkonHapus />
                            </motion.button>
                          </span>
                        </div>

                        <div className="overflow-x-auto px-3.5 pb-3">
                          <table className="w-full min-w-[640px] text-sm">
                            <thead>
                              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                                <th className="py-2 pr-2">Barang</th>
                                <th className="py-2 pr-2">Pilih barang</th>
                                <th className="py-2 pr-2 text-right">Qty</th>
                                <th className="py-2 pr-2 text-right">Harga</th>
                                <th className="py-2">Catatan</th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.items.map((it) => (
                                <tr key={it.baris} className="border-t border-border/60 align-middle">
                                  <td className="py-1.5 pr-2">
                                    <div className="max-w-[190px] truncate font-medium">{it.nama}</div>
                                    {it.productName && (
                                      <div className="max-w-[190px] truncate text-[11px] text-muted-foreground">
                                        {it.productName}
                                        {it.varian ? ` · ${it.varian}` : ""}
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-1.5 pr-2">
                                    {/* Select kustom, bukan <select> bawaan: popup OS
                                        tidak bisa diberi token tema. Kelompok
                                        "Saran Cocok" = 3 teratas fuzzy match, seperti
                                        versi lama. */}
                                    <Select
                                      ariaLabel={`Pilih barang untuk ${it.nama}`}
                                      value={it.productClientId ? `${it.productClientId}|${it.varian}` : ""}
                                      onChange={(v) => pilihBarang(p.baris, it.baris, v)}
                                      placeholder="Pilih barang"
                                      searchable
                                      searchPlaceholder="Cari nama barang…"
                                      className={
                                        "[&>button]:h-8 [&>button]:rounded-lg [&>button]:text-xs " +
                                        (it.productClientId ? "" : "[&>button]:border-[#E0B978]")
                                      }
                                      options={opsiBarang(it.nama)}
                                    />
                                  </td>
                                  <td className="py-1.5 pr-2">
                                    <input
                                      type="number"
                                      inputMode="numeric"
                                      min={0}
                                      value={it.qty > 0 ? it.qty : ""}
                                      placeholder="0"
                                      onChange={(e) => setQtyItem(p.baris, it.baris, Number(e.target.value))}
                                      className="h-8 w-16 rounded-lg border border-border bg-background px-2 text-right text-xs font-semibold figure"
                                    />
                                  </td>
                                  <td className="py-1.5 pr-2">
                                    <label className="flex items-center justify-end gap-1">
                                      <span className="text-[10px] uppercase text-muted-foreground">Rp</span>
                                      <InputRupiah
                                        aria-label={`Harga ${it.nama}`}
                                        value={it.harga}
                                        placeholder={it.hargaKosong ? "isi harga" : "0"}
                                        onChange={(n) => setHargaItem(p.baris, it.baris, n)}
                                        className={
                                          "h-8 w-24 border bg-background px-2 text-xs font-semibold " +
                                          (it.hargaKosong
                                            ? "border-[#E0B978] text-[#6B4A0A] dark:border-[#6B5427] dark:text-[#F0C987]"
                                            : "border-border")
                                        }
                                      />
                                    </label>
                                  </td>
                                  <td className="py-1.5">
                                    <input
                                      value={it.catatan}
                                      onChange={(e) => setCatatanItem(p.baris, it.baris, e.target.value)}
                                      placeholder="—"
                                      className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs"
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {isuSingkat(p).length > 0 && (
                            <ul className="mt-2 space-y-0.5">
                              {isuSingkat(p).map((m, k) => (
                                <li key={k} className="text-[11px] text-muted-foreground">
                                  • {m.pesan}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </ItemDaftar>
                    );
                  })
                )}
                </AnimatePresence>
              </div>
            </Card>
            </motion.div>
          )}
          </AnimatePresence>

          {/* ---------- HASIL ---------- */}
          {hasil && (
            <Card title="3 · Hasil Proses">
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Tersimpan" value={String(hasil.tersimpan)} tone="accent" />
                <StatTile label="Bermasalah" value={String(hasil.gagal)} tone={hasil.gagal > 0 ? "warn" : undefined} />
              </div>
              {hasil.tersimpan > 0 && (
                /* Struk hasil import memakai tanggal PROSES, jadi otomatis
                   muncul di tab "Harian" Dashboard Penjualan. Tombol di
                   bawah cuma pintasan ke sana — bukan syarat agar data
                   terlihat, supaya kasir tidak mencari struk yang memang
                   sudah ada. */
                <p className="mt-3 text-xs text-muted-foreground">
                  Struk tersimpan di tanggal {labelTanggalSingkat(hasil.tanggalProses)} dan langsung
                  muncul di tab Harian.
                </p>
              )}
              {hasil.tersimpan > 0 && (
                <button
                  onClick={() => nav("/penjualan")}
                  className={btnPrimary + " mt-3 w-full"}
                >
                  Buka Dashboard Penjualan
                </button>
              )}
              {hasil.pesan.length > 0 && (
                <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto">
                  {hasil.pesan.map((p, i) => (
                    <li key={i} className="rounded-xl bg-muted px-3 py-1.5 text-xs">
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        {/* ---------- SAMPING: RINGKASAN + PRATINJAU STRUK ---------- */}
        <div className="space-y-4">
          <Card title="Ringkasan">
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Struk" value={String(hasilParse.pesanan.length)} />
              <StatTile label="Item" value={String(totalItem)} />
              <StatTile label="Total nilai" value={rupiahShort(totalNilai)} />
              <StatTile
                label="Harga belum diisi"
                value={String(hargaKosong.length)}
                tone={hargaKosong.length > 0 ? "warn" : undefined}
              />
            </div>
            {/* Dua tombol seperti versi lama: simpan saja, atau simpan lalu
                langsung cetak struknya. Keduanya hanya menyentuh draft
                berstatus "Siap" — draft "Perlu review" dilewati. */}
            <div className="mt-4 grid gap-2">
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => void proses(false)}
                disabled={rekap.siap === 0 || sibuk || !sudahDibuat}
                className={
                  rekap.siap === 0 || sibuk || !sudahDibuat
                    ? "w-full cursor-not-allowed rounded-full bg-muted px-4 py-2.5 text-sm font-bold text-muted-foreground opacity-60"
                    : `${btnPrimary} w-full`
                }
              >
                {sibuk ? "Menyimpan…" : rekap.siap === 0 ? "Belum ada draft siap" : `Proses Semua Siap (${rekap.siap} struk)`}
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => void proses(true)}
                disabled={rekap.siap === 0 || sibuk || !sudahDibuat}
                className={
                  rekap.siap === 0 || sibuk || !sudahDibuat
                    ? "w-full cursor-not-allowed rounded-full bg-muted px-4 py-2.5 text-sm font-semibold text-muted-foreground opacity-60"
                    : "w-full rounded-full border border-border bg-background px-4 py-2.5 text-sm font-semibold hover:bg-muted"
                }
              >
                {sibuk ? "Menyimpan…" : `Proses + Cetak Semua (${rekap.siap} struk)`}
              </motion.button>
              {/* Preview Cetak (padanan previewPrintReadyDraftsButton di
                  aplikasi lama): melihat seluruh batch sekaligus sebelum
                  satu pun tersimpan. Pratinjau per draft tetap dipakai untuk
                  memeriksa satu struk yang bermasalah. */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setPratinjauSemua(true)}
                disabled={rekap.siap === 0 || !sudahDibuat}
                className={
                  rekap.siap === 0 || !sudahDibuat
                    ? "w-full cursor-not-allowed rounded-full bg-muted px-4 py-2.5 text-sm font-semibold text-muted-foreground opacity-60"
                    : "w-full rounded-full border border-border bg-background px-4 py-2.5 text-sm font-semibold hover:bg-muted"
                }
              >
                Preview Cetak Semua ({rekap.siap} struk)
              </motion.button>
            </div>
            {rekap.siap > 0 && (
              <p className="mt-3 text-xs text-muted-foreground figure">
                Draft {mulaiNo}–{mulaiNo + rekap.siap - 1} · {rekap.siap} struk
              </p>
            )}
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              Draft berstatus <strong>Perlu review</strong> tidak ikut diproses: barangnya belum
              cocok atau harganya belum diisi. Selesaikan dulu di tabel di atas.
            </p>
          </Card>

          {pratinjauSemua && htmlPratinjauSemua && (
            <Card
              title={`Pratinjau Cetak · ${daftarSiap.length} struk siap`}
              action={
                <div className="flex items-center gap-2">
                  {/* Jalur ke dialog cetak browser — padanan perilaku
                      "Preview Cetak" di versi lama. Icon saja: teks
                      "Cetak (2 struk)" di header kartu jadi tiga baris
                      dandan merebut ruang judul. */}
                  <IconButton
                    onClick={cetakSemuaDraft}
                    label={`Cetak ${daftarSiap.length} struk (buka dialog cetak browser)`}
                    title={`Cetak ${daftarSiap.length} struk`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
                      strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
                      <path d="M6 9V3h12v6M6 19H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 15h10v6H7v-6Z" />
                    </svg>
                  </IconButton>
                  <button
                    onClick={() => setPratinjauSemua(false)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
                  >
                    Tutup
                  </button>
                </div>
              }
            >
              <p className="mb-2 text-[11px] text-muted-foreground">
                Nomor struk masih perkiraan — nomor aslini diberikan saat disimpan.
                Draft “Perlu review” tidak ikut ditampilkan.
              </p>
              {/* Struk thermal asli digabung berurutan, dipisah pemisah
                  antar struk — persis seperti hasil gabungStruk saat cetak. */}
              <iframe
                title="Pratinjau semua struk"
                srcDoc={htmlPratinjauSemua}
                sandbox="allow-same-origin"
                className="h-[70vh] w-full rounded-2xl border border-border bg-white"
              />
            </Card>
          )}

          {terpilih && htmlPratinjau && (
            <Card
              title={`Pratinjau Cetak · ${terpilih?.customer || "Tanpa nama"}`}
              action={
                terpilih && (
                  <IconButton
                    onClick={() => cetakSatuDraft(terpilih)}
                    label="Cetak struk ini (buka dialog cetak browser)"
                    title="Cetak struk ini"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
                      strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
                      <path d="M6 9V3h12v6M6 19H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 15h10v6H7v-6Z" />
                    </svg>
                  </IconButton>
                )
              }
            >
              {/* Struk thermal asli, dirender lewat iframe supaya CSS
                  struk tidak menimpa styling halaman. */}
              <iframe
                title="Pratinjau struk"
                srcDoc={htmlPratinjau}
                sandbox="allow-same-origin"
                className="h-[600px] w-full rounded-2xl border border-border bg-white"
              />
            </Card>
          )}
        </div>
      </div>

      <Toast toast={toast} posisi="atas-tengah" />
    </div>
  );
}
