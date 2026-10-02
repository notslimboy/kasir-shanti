import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Card, IconButton, Pill } from "@/components/ui/card";
import { Field, PageHeader, Tabs, btnGhost, btnPrimary, inputClass } from "@/components/ui/kit";
import { Combobox } from "@/components/ui/combobox-input";
import { Select } from "@/components/ui/select";
import type { Product, Variant } from "@/lib/menu-seed";
import { useData } from "@/lib/data-source";
import { ItemDaftar } from "@/components/list-motion";
import { InputRupiah } from "@/components/ui/input-rupiah";
import { tandaiProdukStale } from "@/lib/data-source-signal";
import { resetSyncHash, syncProductsFromGoogleSheet } from "@/lib/sync-google-sheet";
import { TANPA_KATEGORI, buatClientId, simpanProduk } from "@/lib/simpan-produk";
import { rupiah } from "@/lib/format";
import {
  MIN_HALF_PRICE,
  PRICING_TYPES,
  halfHitsFloor,
  halfVariantPrice,
  isBaseVariant,
  isHalfVariantName,
  type PricingType,
} from "@/lib/pricing";

/* ==========================================================================
   Kelola Menu — CRUD produk & varian.
   Fokus: mengedit. Kasir ada di /kasir.
   ========================================================================== */

export function MenuPage() {
  const live = useData();
  const [sunting, setSunting] = useState<Product[] | null>(null);
  /* Satu baris products = satu baris di editor. Tidak digabung: baris
     berulang di database memang dipakai untuk varian. */
  const items = sunting ?? live.produk;
  /* null = panel detail tertutup. Dipakai null, bukan id tersembunyi,
     supaya "tidak ada yang sedang diedit" itu keadaan yang memang bisa
     terjadi (setelah Batal atau Simpan), bukan state yang dipaksa. */
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("semua");
  const [dirty, setDirty] = useState(false);
  /* Entrance cuma saat sedang menyaring. Daftar penuh yang dibuka pertama
     kali tidak perlu ikut fade — itu 1.095 baris mount sekaligus. */
  const geser = q.trim() !== "" || cat !== "semua";
  /* true selama tombol Simpan menunggu konfirmasi "Tersimpan" tampil.
     Batal tidak punya jeda sama sekali — lihat batal(). */
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* client_id produk yang dibuat di halaman ini dan belum pernah tersimpan.
     Butuh set sendiri: produk yang sudah ada punya kolom `id` di database,
     draf tidak punya sama sekali. */
  const [draf, setDraf] = useState<Set<string>>(() => new Set());
  const [menyimpan, setMenyimpan] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  /* Produk yang barusan ditulis. Panel edit baru ditutup setelah produk itu
     benar-benar muncul di katalog — kalau ditutup duluan, daftar di kiri
     akan sesaat kehilangan produk barunya sendiri. */
  const [baruTersimpan, setBaruTersimpan] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /* Katalog ditarik saat halaman ini dibuka — bukan sejak aplikasi dibuka,
     karena Beranda tidak memakainya dan biayanya ±4,4 detik. */
  useEffect(() => {
    live.pastikanProduk();
  }, [live.pastikanProduk]);

  /* Sinkron produk dari Google Sheet. Tombol manual, bukan otomatis:
     sync pertama hauling 4.000+ baris products, jadi penny dessen user
     tekan. Tombol yang dipencet = Sheet-nya memang berubah. */
  const [menyinkron, setMenyinkron] = useState(false);
  const [hasilSinkron, setHasilSinkron] = useState<string | null>(null);
  /* Nama produk yang hilang dari sheet. Disimpan terpisah karena itu satu-
    -satunya bagian sinkron yang menghapus data — jadi harus dibaca, bukan
     cuma lewat di angka ringkasan. */
  const [dihapus, setDihapus] = useState<string[] | null>(null);

  const sinkronkan = useCallback(async () => {
    if (menyinkron) return;
    /* Tanpa dialog: tombol yang dipencet sudah jadi persetujuan. Konfirmasi
       hanya menambah satu klik dan menutupi layar — produk yang hilang dari
       sheet tetap dilaporkan di daftar `dihapus`. */

    setMenyinkron(true);
    setHasilSinkron(null);
    setDihapus(null);
    /* Paksa tarik ulang walau isi CSV sama — user yang menekan tombol
       berarti ada yang berubah di Sheet, mungkin di sheet(tab) lain atau
       setelah hash lama tersimpan. */
    resetSyncHash();
    try {
      const r = await syncProductsFromGoogleSheet();
      if (r.error) {
        setHasilSinkron(`Gagal: ${r.error}`);
      } else {
        const bagian = [
          `${r.created} baru`,
          `${r.updated} diperbarui`,
          `${r.removed} dihapus`,
          `${r.duplicates} duplikat digabung`,
          `${r.skipped} dilewati`,
        ];
        setHasilSinkron(bagian.join(" · "));
        /* Yang dihapus disebutkan terpisah: itu bagian yang hilang dari layar
           dan perlu dicek, sedangkan angka lain cukup di baris ringkasan. */
        if (r.removed > 0 && r.removedNames?.length) {
          setDihapus(r.removedNames);
        }
      }
    } catch (e) {
      setHasilSinkron(`Gagal: ${(e as Error).message}`);
    } finally {
      setMenyinkron(false);
    }
  }, [menyinkron]);

  /* Batal: tutup seketika. Menunda hanya bikin panel menggantung diam
     sebelum hilang, dan itu terbaca sebagai lag, bukan animasi. Produk draf
     (yang belum pernah tersimpan) ikut dibuang — kalau tidak, ia tetap
     nongor di daftar setelah panel ditutup. */
  const batal = () => {
    if (saved || menyimpan) return;
    if (timer.current) clearTimeout(timer.current);
    if (sel && draf.has(sel)) {
      setSunting((all) => (all ?? live.produk).filter((p) => p.client_id !== sel));
      setDraf((s) => {
        const next = new Set(s);
        next.delete(sel);
        return next;
      });
    }
    setSel(null);
    setDirty(false);
    setGalat(null);
  };

  /* Simpan: menulis ke Supabase dulu, baru menampilkan "Tersimpan".
     Panel ditutup setelah katalog memuat ulang dan produknya terlihat di
     daftar — itu yang membuat "Tersimpan" berarti nyatanya tersimpan, bukan
     cuma tombol yang selesai beranimasi. */
  const simpan = async () => {
    if (saved || menyimpan || !product) return;
    const nama = product.name.trim();
    if (nama === "") {
      setGalat("Nama menu belum diisi.");
      return;
    }
    setGalat(null);
    setMenyimpan(true);
    try {
      const idBaris = live.products.find((r) => r.client_id === product.client_id)?.id ?? null;
      await simpanProduk(product, idBaris);
      setDraf((s) => {
        const next = new Set(s);
        next.delete(product.client_id);
        return next;
      });
      setDirty(false);
      setSaved(true);
      setBaruTersimpan(product.client_id);
      /* Katalog ditandai basi → data-source menarik ulang produk. */
      tandaiProdukStale();
      /* Jaga-jaga: katalog gagal ditarik ulang (offline sesaat), panel tetap
         harus menutup agar tidak menggantung di status "menyimpan". */
      timer.current = setTimeout(() => {
        setSunting(null);
        setSel(null);
        setSaved(false);
        setBaruTersimpan(null);
      }, 1600);
    } catch (e) {
      setGalat((e as Error).message);
    } finally {
      setMenyimpan(false);
    }
  };

  /* Katalog sudah memuat produk yang barusan ditulis → tutup panel. */
  useEffect(() => {
    if (baruTersimpan === null) return;
    if (!live.products.some((r) => r.client_id === baruTersimpan)) return;
    if (timer.current) clearTimeout(timer.current);
    setSunting(null);
    setSel(null);
    setSaved(false);
    setBaruTersimpan(null);
  }, [baruTersimpan, live.products]);

  /** Produk kosong, langsung masuk ke editor. Kategori tidak wajib diisi —
      kalau kosong, kolomnya ditulis kosong dan UI membacanya sebagai
      "Tanpa Kategori".

      Cuma boleh satu draf. Tanpa itu, "+ Menu Baru" yang ditekan berulang
      menumpuk produk kosong di daftar — semuanya kelihatan, tapi tidak satu
      pun bisa disimpan karena namanya kosong. Kalau sudah ada draf, tombol
      ini justru memunculkan draf itu lagi, bukan membuat yang kedua. */
  const menuBaru = () => {
    const adaDraf = [...draf][0];
    if (adaDraf) {
      setSel(adaDraf);
      return;
    }
    const clientId = buatClientId();
    const baru: Product = {
      client_id: clientId,
      name: "",
      sku: "",
      category: TANPA_KATEGORI,
      aliases: [],
      stock: 0,
      stock_unlimited: true,
      variants: [
        {
          client_id: `${clientId}::normal`,
          name: "Normal",
          pricing_type: "fixed",
          price: 0,
          unit_name: "",
          package_quantity: 1,
          receipt_label: "",
          is_default: true,
          allow_quantity_override: true,
          allow_price_override: true,
          active: true,
        },
      ],
    };
    setSunting([...(sunting ?? live.produk), baru]);
    setDraf((s) => new Set(s).add(clientId));
    setSel(clientId);
    setDirty(false);
    setGalat(null);
    setSaved(false);
    /* Tab kategori ikut pindah supaya menu baru langsung kelihatan. Kategori
       "Tanpa Kategori" bukan tempat yang berguna untuk itu — isinya ratusan
       produk lain. */
    setCat(baru.category === TANPA_KATEGORI ? "semua" : baru.category);
  };

  /* Kategori diambil dari data. Di Supabase 374 dari 1000 produk pertama
     berkategori kosong, jadi daftar tetap dari data akan benar. */
  const opsiKategori = useMemo(() => {
    const hitung = new Map<string, number>();
    for (const p of items) hitung.set(p.category, (hitung.get(p.category) ?? 0) + 1);
    return [...hitung.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "id-ID"))
      .map(([id]) => id);
  }, [items]);

  const list = useMemo(
    () =>
      items.filter(
        (p) =>
          (cat === "semua" || p.category === cat) &&
          (q === "" || p.name.toLowerCase().includes(q.toLowerCase()) || p.sku.toLowerCase().includes(q.toLowerCase())),
      ),
    [items, q, cat],
  );

  const product = sel === null ? null : (items.find((p) => p.client_id === sel) ?? null);

  const patch = (fn: (p: Product) => Product) => {
    if (!product) return;
    setSunting((all) => (all ?? live.produk).map((p) => (p.client_id === product.client_id ? fn(p) : p)));
    setDirty(true);
  };

  /**
   * Edit satu varian. Kalau yang diedit adalah varian default, harga
   * "Separuh" ikut turun dan kena lantai Rp 10.000 — inilah tempat aturan
   * itu ditegakkan, bukan di input terpisah.
   */
  const patchVariant = (clientId: string, fn: (v: Variant) => Variant) =>
    patch((p) => {
      const next = p.variants.map((v) => (v.client_id === clientId ? fn(v) : v));
      const editedIsDefault = next.some((v) => v.client_id === clientId && v.is_default);
      if (!editedIsDefault) return { ...p, variants: next };

      const normalPrice = next.find((v) => v.is_default)?.price ?? 0;
      return {
        ...p,
        variants: next.map((v) =>
          isHalfVariantName(v.name) && v.pricing_type === "fixed" && !v.is_default
            ? { ...v, price: halfVariantPrice(normalPrice) }
            : v,
        ),
      };
    });

  const addVariant = () =>
    patch((p) => ({
      ...p,
      variants: [
        ...p.variants,
        {
          client_id: `${p.client_id}::v${p.variants.length + 1}`,
          name: "Varian Baru",
          pricing_type: "fixed",
          price: 0,
          unit_name: "",
          package_quantity: 1,
          receipt_label: "",
          is_default: false,
          allow_quantity_override: true,
          allow_price_override: true,
          active: true,
        },
      ],
    }));

  const removeVariant = (clientId: string) =>
    patch((p) => ({ ...p, variants: p.variants.filter((v) => v.client_id !== clientId) }));

  return (
    <div>
      <PageHeader
        title="Kelola Menu"
        sub="Atur produk, varian (cara jual), harga, dan stok."
        action={
          <div className="flex items-center gap-2">
            <IconButton
              onClick={sinkronkan}
              disabled={menyinkron}
              label={menyinkron ? "Menyinkron dari Google Sheet" : "Tarik produk terbaru dari Google Sheet"}
              title={hasilSinkron ?? "Tarik produk terbaru dari Google Sheet"}
            >
              {/* Berputar saat synkron — itu satu-satunya penanda bahwa
                  synkron benar-benar jalan; hasil sync baru tampil setelah
                  selesai, jadi tanpa ini tombolnya diam seperti macet. */}
              <svg
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
                strokeLinecap="round" strokeLinejoin="round"
                className={`h-[18px] w-[18px] ${menyinkron ? "animate-spin" : ""}`}
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-3.5-7.1" />
                <path d="M21 4v5h-5" />
              </svg>
            </IconButton>
            {/* Satu draf saja: kalau masih ada yang belum tersimpan, tombol ini
                tidak membuat produk kosong kedua — dia hanya memunculkan draf
                itu lagi. */}
            <button
              onClick={menuBaru}
              disabled={menyimpan || (sel !== null && draf.has(sel))}
              title={draf.size > 0 ? "Kembali ke menu baru yang belum disimpan" : "Buat menu baru"}
              className={btnPrimary + " disabled:opacity-40"}
            >
              + Menu Baru
            </button>
          </div>
        }
      />

      {/* Hasil synkron: dismissed sendiri supaya tidak jadi baris yang
          menetap di halaman. Error tidak ikut hilang — itu yang perlu
          dibaca kalau Sheet gagal diambil. */}
      {hasilSinkron && (
        <p
          role="status"
          className={`-mt-2 mb-3 text-sm ${hasilSinkron.startsWith("Gagal") ? "text-destructive" : "text-muted-foreground"}`}
        >
          {hasilSinkron}
        </p>
      )}

      {dihapus && (
        <p className="-mt-1 mb-3 text-sm text-muted-foreground">
          Dihapus dari aplikasi karena sudah tidak ada di sheet:{" "}
          <span className="text-foreground">{dihapus.join(", ")}</span>
        </p>
      )}

      {/* Kolom tetap. Kalau tidak ada produk yang dipilih, sisi kanan memang
          sengaja dibiarkan kosong — bukan Diretas jadi grid kartu. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* ---------- DAFTAR ---------- */}
        <div className="min-w-0">
          <div className="mb-3 space-y-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari menu atau SKU…"
              className={inputClass}
            />
            <Tabs
              value={cat}
              onChange={setCat}
              items={[{ id: "semua", label: "Semua", count: items.length }, ...opsiKategori.map((c) => ({ id: c, label: c }))]}
            />
          </div>

          {/* popLayout: baris yang hilang tidak menahan baris lain di
              tempatnya. Tanpa itu, mengetik di kotak cari terasa seperti
              daftar didorong, bukan difilter. */}
          <div className="space-y-2">
            <AnimatePresence initial={false} mode="popLayout">
            {list.map((p, i) => {
              const n = p.variants.find((v) => v.is_default);
              const on = p.client_id === sel;
              /* Draf belum ada nama dan belum ada harga. Tanpa label, baris
                 itu terlihat seperti menu sungguhan yang rusak — bukan
                 sesuatu yang sengaja menunggu diisi. */
              const drafIni = draf.has(p.client_id);
              return (
                <ItemDaftar key={p.client_id} i={i} aktif={geser}>
                <button
                  onClick={() => setSel(p.client_id)}
                  className={
                    "w-full rounded-2xl p-3.5 text-left transition-all " +
                    (on
                      ? "bg-sidebar text-sidebar-foreground shadow-card ring-2 ring-primary"
                      : "bg-card shadow-card hover:bg-accent/40")
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {drafIni ? "Menu baru — belum disimpan" : p.name}
                      </div>
                      <div className={"truncate text-xs " + (on ? "text-sidebar-foreground/60" : "text-muted-foreground")}>
                        {/* Sebagian besar produk nyata belum punya SKU —
                            pemisah "·" harus ikut disembunyikan kalau tidak
                            ada isi di sebelah kirinya. */}
                        {drafIni ? "Isi nama & kategori, lalu Simpan" : p.sku ? `${p.sku} · ${p.category}` : p.category}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-bold figure">
                        {drafIni ? "—" : rupiah(n?.price ?? 0)}
                      </div>
                      <div className={"text-[11px] " + (on ? "text-sidebar-foreground/60" : "text-muted-foreground")}>
                        {drafIni ? "belum ada harga" : p.stock_unlimited ? "tanpa batas" : `sisa ${p.stock}`}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.variants.slice(0, 4).map((v) => (
                      <span
                        key={v.client_id}
                        className={
                          "rounded-md border px-1.5 py-0.5 text-[10px] font-semibold " +
                          (on ? "border-white/15 text-sidebar-foreground/75" : "border-input text-muted-foreground")
                        }
                      >
                        {v.name}
                      </span>
                    ))}
                    {p.variants.length > 4 && (
                      <span className={"text-[10px] " + (on ? "text-sidebar-foreground/50" : "text-muted-foreground")}>
                        +{p.variants.length - 4}
                      </span>
                    )}
                  </div>
                </button>
                </ItemDaftar>
              );
            })}
            </AnimatePresence>
            {list.length === 0 && (
              <div className="grid place-items-center rounded-2xl border border-dashed border-input py-12 text-center">
                <p className="text-sm font-semibold text-muted-foreground">
                  {live.produkMemuat
                    ? "Memuat menu…"
                    : live.produk.length === 0
                      ? live.produkDimuat
                        ? "Belum ada menu — tekan “+ Menu Baru” untuk menambah"
                        : "Menu belum dimuat"
                      : "Menu tidak ditemukan"}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ---------- EDITOR (hanya saat ada produk terpilih) ---------- */}
        <AnimatePresence mode="wait" initial={false}>
        {product && (() => {
          const normal = product.variants.find((v) => v.is_default);
          return (
          <motion.div
            key={product.client_id}
            /* Masuk: sedikit meluncur dari kanan. Keluar: cepat dan tegas.
               Spring untuk keluar terasa seperti nge-lag, jadi keluar pakai
               durasi pendek. */
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
            className="min-w-0 space-y-4"
          >
          <Card
            title={product.name}
            action={
              <div className="flex items-center gap-2">
                <AnimatePresence mode="wait" initial={false}>
                  {saved ? (
                    <motion.span
                      key="simpan"
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.7 }}
                      transition={{ type: "spring", stiffness: 500, damping: 22 }}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground"
                    >
                      ✓ Tersimpan
                    </motion.span>
                  ) : (
                    dirty && <Pill key="dirty" tone="warning">Belum disimpan</Pill>
                  )}
                </AnimatePresence>
                <button onClick={batal} disabled={saved || menyimpan} className={btnGhost + " disabled:opacity-40"}>
                  Batal
                </button>
                <motion.button
                  onClick={simpan}
                  disabled={saved || menyimpan}
                  whileTap={{ scale: 0.96 }}
                  className={btnPrimary + " disabled:opacity-40"}
                >
                  {menyimpan ? "Menyimpan…" : "Simpan"}
                </motion.button>
              </div>
            }
          >
            {galat && (
              <p role="alert" className="mb-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
                {galat}
              </p>
            )}

            {draf.has(product.client_id) && (
              <p className="mb-3 text-xs text-muted-foreground">
                Menu baru — belum tersimpan. Isi nama dan kategori, lalu tekan Simpan; tab kategorinya muncul sendiri
                setelah tersimpan.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Nama Menu">
                <input
                  value={product.name}
                  onChange={(e) => patch((p) => ({ ...p, name: e.target.value }))}
                  className={inputClass}
                />
              </Field>
              <Field label="SKU">
                <input
                  value={product.sku}
                  onChange={(e) => patch((p) => ({ ...p, sku: e.target.value }))}
                  className={inputClass}
                />
              </Field>
              {/* Kategori bukan daftar terpisah: ketik nama baru, atau pilih
                  yang sudah dipakai produk lain. Tabnya ikut terbentuk dari
                  nilai yang disimpan di sini. */}
              <Field label="Kategori" hint="Ketik kategori baru, atau pilih yang ada.">
                <Combobox
                  value={product.category}
                  onChange={(category) => patch((p) => ({ ...p, category }))}
                  options={opsiKategori}
                  placeholder="misal: Chinese Food"
                  createLabel="Kategori baru"
                  ariaLabel="Kategori"
                />
              </Field>
              <Field label="Stok">
                <div className="flex gap-2">
                  <input
                    type="number"
                    disabled={product.stock_unlimited}
                    value={product.stock_unlimited ? "" : product.stock}
                    onChange={(e) => patch((p) => ({ ...p, stock: Number(e.target.value) || 0 }))}
                    className={inputClass + " figure disabled:opacity-50"}
                  />
                  <button
                    onClick={() => patch((p) => ({ ...p, stock_unlimited: !p.stock_unlimited }))}
                    className={
                      "shrink-0 rounded-xl border px-3 text-xs font-semibold transition-colors " +
                      (product.stock_unlimited ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground")
                    }
                  >
                    ∞
                  </button>
                </div>
              </Field>
            </div>

            <Field label="Alias / kata kunci" hint="Dipakai saat parsing chat WhatsApp. Pisahkan dengan koma.">
              <input
                value={product.aliases.join(", ")}
                onChange={(e) =>
                  patch((p) => ({
                    ...p,
                    aliases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  }))
                }
                placeholder="misal: ayam goreng, ayam baput"
                className={inputClass}
              />
            </Field>
          </Card>

          {/* ---------- HARGA & VARIAN ----------
              Satu daftar varian saja. Tidak ada input harga terpisah di atas:
              tiap baris adalah satu-satunya tempat harga itu diubah. */}
          <Card
            title="Harga & Varian"
            action={
              <button onClick={addVariant} className="rounded-full border border-input px-4 h-9 text-sm font-semibold">
                + Varian
              </button>
            }
          >
            {/* key per produk: ganti produk = remount bersih, tidak ada baris sisa.
                Tambah/hapus varian dalam satu produk tetap dianimasikan. */}
            <ul key={product.client_id} className="space-y-2">
              <AnimatePresence initial={false}>
                {product.variants.map((v) => {
                  const locked = isBaseVariant(v.name);
                  const isHalf = isHalfVariantName(v.name);
                  const isCustom = v.pricing_type === "custom";
                  const showUnit = v.pricing_type === "unit";
                  const showPack = v.pricing_type === "package";
                  const bumped = isHalf && normal ? halfHitsFloor(normal.price) : false;

                  return (
                    <motion.li
                      key={v.client_id}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ duration: 0.16 }}
                      className={
                        "rounded-2xl border p-3 " +
                        (v.is_default ? "border-primary/50 bg-accent/30" : "border-input bg-card")
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {/* default */}
                        <button
                          onClick={() =>
                            patch((p) => ({
                              ...p,
                              variants: p.variants.map((x) => ({
                                ...x,
                                is_default: x.client_id === v.client_id,
                              })),
                            }))
                          }
                          aria-label={`Jadikan ${v.name} harga default`}
                          aria-pressed={v.is_default}
                          className={
                            "grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 text-[9px] font-bold " +
                            (v.is_default
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input text-transparent hover:border-ring")
                          }
                        >
                          ✓
                        </button>

                        {/* nama */}
                        <div className="min-w-[120px] flex-1">
                          <input
                            value={v.name}
                            disabled={locked}
                            onChange={(e) => patchVariant(v.client_id, (x) => ({ ...x, name: e.target.value }))}
                            className={
                              "h-10 w-full rounded-lg border px-3 text-sm font-semibold outline-none " +
                              (locked
                                ? "cursor-not-allowed border-transparent bg-transparent px-0 text-foreground"
                                : "border-input bg-card focus:border-ring")
                            }
                          />
                          {locked && (
                            <p className="mt-0.5 px-0 text-[11px] text-muted-foreground">
                              Varian dasar — nama tidak bisa diubah.
                            </p>
                          )}
                        </div>

                        {/* cara jual */}
                        <Select
                          className="w-40 shrink-0"
                          value={v.pricing_type}
                          onChange={(id) =>
                            patchVariant(v.client_id, (x) => ({ ...x, pricing_type: id as PricingType }))
                          }
                          options={PRICING_TYPES.map((t) => ({ value: t.id, label: t.label }))}
                        />

                        {/* harga */}
                        <div className="w-32 shrink-0">
                          <InputRupiah
                            aria-label={`Harga ${v.name}`}
                            value={v.price}
                            disabled={isCustom}
                            placeholder={isCustom ? " saat transaksi" : ""}
                            onChange={(n) => patchVariant(v.client_id, (x) => ({ ...x, price: n }))}
                            className={
                              "h-10 px-3 disabled:border-dashed disabled:border-input disabled:bg-transparent disabled:text-muted-foreground"
                            }
                          />
                        </div>

                        {/* hapus — varian dasar dikunci, jadi bukan tombol sama sekali */}
                        {locked ? (
                          <span className="shrink-0 px-2.5 py-2 text-xs font-semibold text-muted-foreground/30">—</span>
                        ) : (
                          <button
                            onClick={() => removeVariant(v.client_id)}
                            title="Hapus varian"
                            className="shrink-0 rounded-lg px-2.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            Hapus
                          </button>
                        )}
                      </div>

                      {/* konteks tambahan: satuan / paket / custom / lantai harga */}
                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-7 text-xs">
                        {showUnit && (
                          <label className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Satuan</span>
                            <input
                              value={v.unit_name}
                              onChange={(e) =>
                                patchVariant(v.client_id, (x) => ({ ...x, unit_name: e.target.value }))
                              }
                              placeholder="biji"
                              className="h-8 w-24 rounded-lg border border-input bg-card px-2 text-sm outline-none focus:border-ring"
                            />
                          </label>
                        )}

                        {showPack && (
                          <label className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Isi paket</span>
                            <input
                              type="number"
                              value={v.package_quantity}
                              onChange={(e) =>
                                patchVariant(v.client_id, (x) => ({
                                  ...x,
                                  package_quantity: Number(e.target.value) || 1,
                                }))
                              }
                              className="h-8 w-16 rounded-lg border border-input bg-card px-2 text-right text-sm figure outline-none focus:border-ring"
                            />
                            <span className="text-muted-foreground">porsi</span>
                          </label>
                        )}

                        {isCustom && (
                          <span className="text-muted-foreground">
                            Harga-variant ini diisi kasir saat transaksi, jadi kolom harga dikosongkan.
                          </span>
                        )}

                        {bumped && normal && (
                          <span className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[#F3DBA2] px-2.5 py-1 font-semibold text-[#6B4A0A] dark:bg-[#3A2A10] dark:text-[#F0C987]">
                            <span>
                              Separuh otomatis: {rupiah(Math.floor(normal.price / 2))} → {rupiah(MIN_HALF_PRICE)}
                            </span>
                            <span className="font-normal">
                              (minimal {rupiah(MIN_HALF_PRICE)}). Harga normal perlu ≥ {rupiah(MIN_HALF_PRICE * 2)} agar separuh tidak dibulatkan.
                            </span>
                          </span>
                        )}
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>

            {normal && (
              <p className="mt-3 text-xs text-muted-foreground">
                Harga default dipakai saat kasir memilih menu tanpa memilih varian. Baris{" "}
                <span className="font-semibold">{normal.name}</span> adalah harga yang tampil di keranjang.
              </p>
            )}
          </Card>

          {/* ---------- ADD-ON ---------- */}
          <Card title="Add-on" action={<Pill>Segera</Pill>}>
            <div className="rounded-2xl border border-dashed border-input p-6 text-center">
              <p className="text-sm font-semibold">Belum dipakai</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                Tambahan seperti extra nasi, telur, atau level sambal akan muncul di layar Kasir sebagai pilihan
                terpisah dari varian harga. Gratis, dan tidak memengaruhi aturan harga separuh.
              </p>
              <button disabled className="mt-3 rounded-full border border-input px-4 h-9 text-sm font-semibold text-muted-foreground opacity-60">
                Aktifkan nanti
              </button>
            </div>
          </Card>
          </motion.div>
          );
        })()}
        </AnimatePresence>
      </div>
    </div>
  );
}
