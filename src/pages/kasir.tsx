import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { CartItem, HeldOrder } from "@/lib/page-data";
import { delayDaftar } from "@/components/list-motion";
import { rupiah } from "@/lib/format";
import { useData } from "@/lib/data-source";
import { Toast } from "@/components/ui/toast";
import { InputRupiah } from "@/components/ui/input-rupiah";
import { cetakStrukSatuan } from "@/lib/cetak-struk";
import { simpanPenjualan, type BarisJual, type HasilJual } from "@/lib/simpan-penjualan";
import { cacheBaca, cacheKosongkanKecuali, cacheTulis } from "@/lib/cache-db";
import { useSetelan } from "@/lib/setelan";
import { InputCustomer } from "@/components/ui/input-customer";
import { CatatanInput } from "@/components/ui/catatan-input";
import { saranCustomer } from "@/lib/cocok-customer";
import { triggerSyncFromSheet } from "@/lib/sync-google-sheet";
import { rapikanCatatan, ringkasCatatan } from "@/lib/catatan-item";
import { cssStruk, strukHtml, type DataStruk } from "@/lib/struk";
import { PageHeader, btnGhost, btnPrimary, inputClass } from "@/components/ui/kit";
import { Pill } from "@/components/ui/card";

/* ==========================================================================
   Kasir / POS — layar utama. Menu di kiri, keranjang sticky di kanan.
   Di mobile: keranjang jadi sheet penuh (bukan bottom bar).
   ========================================================================== */

const SHOP = "CATERING SHANTI";
/* Dipakai kalau order di-hold tanpa nama customer — jangan dibiarkan kosong,
   nanti tidak bisa dicari saat mau diambil lagi. */
const TANPA_NAMA = "Tanpa Nama";

/* Kunci cache untuk daftar order tersimpan. */
const KUNCI_HOLD = "kasir-hold";

function fmtQty(n: number) {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

export function KasirPage() {
  const live = useData();
  /* Kasir bisa saja setel "kurangi gerakan" di OS — atau punya vestibular
     disorder. Animasi daftar enak, tapi bukan harga yang dibayar kasir
     dengan mual setiap kali mengetik. */
  const kurangi = useReducedMotion();
  const [setelan] = useSetelan();
  const [cat, setCat] = useState("Semua");
  const [q, setQ] = useState("");
  /* Keranjang selalu kosong saat aplikasi dibuka: mewarisi isi keranjang
     dari data contoh berarti kasir bisa menjual barang yang tidak ada. */
  const [cart, setCart] = useState<CartItem[]>([]);
  /* Ongkir mulai dari NOL, bukan angka literal.

     Nilai bawaan Rp 15.000 membuat kasir membuka aplikasi dan langsung
     melihat "Total Rp 15.000" di keranjang yang masih kosong. Tambah
     satu menu pun totalnya melompat naik Rp 15.000 — dan penyebabnya
     tidak terlihat di layar. Kasir bisa menyimpannya tanpa sadar,
     lalu pelanggan membayar ongkir yang tidak pernah disebutkan.

     Ongkir yang benar datang dari data customer (lihat efek
     `terisiOngkir` di bawah). Kalau customer tidak cocok atau belum
     diisi, kasir mengetiknya sendiri di kolom Ongkir — dan angka nol
     adalah state yang jujur: belum ada ongkir yang diketahui.

     Ini pola yang sama seperti "angka contoh diam-diam dipakai sampai
     orang percaya angka salah" yang tercatat di AGENTS.md. */
  const [ongkir, setOngkir] = useState(0);
  const [diskon, setDiskon] = useState(0);
  const [pay, setPay] = useState("Tunai");
  const [customer, setCustomer] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  /* Hold disimpan ke IndexedDB, bukan hanya useState.
     Alasannya praktis: kasir menekan "Simpan Hold" precisely karena ada
     orderan lain yang harus dilayani sekarang — dan refresh halaman
     ( atau aplikasi ke-restart karena PWA di-update ) adalah hal yang
     terjadi tanpa peringatan. Hold yang hilang berarti kasir mengetik
     ulang seluruh order itu, dan itu memancing mereka untuk tidak
     memakai fitur sama sekali.

     `cacheTulis` sudah gagal-diam-diam, jadi status "tersimpan" di
     tombol tidak pernah menggantung karena storage sedang sibuk. */
  const [holds, setHolds] = useState<HeldOrder[]>([]);
  /* Dibaca setelah render pertama supaya halaman tidak kosong dulu.
     Menunggu di effect akan menunda seluruh isi halaman kasir hanya
     supaya tiga baris hold muncul lebih cepat. */
  useEffect(() => {
    let batal = false;
    void cacheBaca<{ holds: HeldOrder[] }>(KUNCI_HOLD).then((c) => {
      if (batal || !c?.data?.holds) return;
      setHolds(c.data.holds);
    });
    return () => {
      batal = true;
    };
  }, []);
  /* Konfirmasi ditulis tepat di samping tombolnya, bukan melayang di atas
     layar: kasir sedang menekan tombol itu, jadi jawabannya harus muncul
     di tempat jarinya, bukan di sudut yang sedang tidak dilihat. */
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Transaksi yang baru selesai. Struknya tetap bisa dicetak ulang dari
     sini — jadi saat auto print mati, kasir tidak perlu mencari struk
     yang baru saja keluar. */
  const [selesai, setSelesai] = useState<HasilJual | null>(null);
  const [menyelesaikan, setMenyelesaikan] = useState(false);

  /* Data struk 58mm dari hasil simpan. Satu sumber supaya pratinjau dan
     cetakan tidak mungkin berbeda — persis aturan struk di aplikasi lama. */
  const dataStrukDari = (hasil: HasilJual): DataStruk => ({
    receiptNo: hasil.receiptNo,
    storeName: setelan.storeName,
    storeAddress: setelan.storeAddress,
    footer: setelan.footer,
    receiptWidth: setelan.receiptWidth,
    receiptFontSize: setelan.receiptFontSize,
    receiptMode: setelan.receiptMode,
    payment: hasil.struk.payment,
    customerName: hasil.struk.customer || "Customer belum diisi",
    chatDate: hasil.struk.chatDate,
    queueNo: hasil.struk.queueNo,
    sendNote: hasil.struk.sendNote,
    subtotal: hasil.struk.subtotal,
    shipping: hasil.struk.shipping,
    total: hasil.struk.total,
    items: hasil.struk.items,
  });

  const say = (text: string, tone: "ok" | "warn" = "ok") => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    setNote({ tone, text });
    noteTimer.current = setTimeout(() => setNote(null), 2200);
  };

  /* Simpan Hold: keranjang harus ikut kosong. Kalau isinya tetap ada di
     layar, kasir akan mengira hold gagal dan menyalin order-nya dua kali. */
  /* Status tombol Simpan Hold. Konfirmasitnya hidup DI DALAM tombol, bukan
     sebagai chip di sebelah: chip membuat deretan tombol melompat ke kanan
     tiap ada pesan, dan itu terbaca sebagai glitch — bukan umpan balik. */
  const [holdStatus, setHoldStatus] = useState<"idle" | "tersimpan" | "kosong">("idle");
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const simpanHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (cart.length === 0) {
      setHoldStatus("kosong");
      say("Keranjang masih kosong", "warn");
      holdTimer.current = setTimeout(() => setHoldStatus("idle"), 1800);
      return;
    }
    const nama = customer.trim() || TANPA_NAMA;
    const label = `Hold #${holds.length + 1}`;
    const jumlah = cart.length;
    const baru: HeldOrder = {
      id: `h${Date.now()}`,
      label,
      customer: nama,
      savedAt: "Baru saja",
      items: cart,
    };
    const berikut = [baru, ...holds];
    setHolds(berikut);
    void cacheTulis(KUNCI_HOLD, { holds: berikut });
    setCart([]);
    /* Id baris keranjang = client_id|varian, jadi baris yang sama bisa
       muncul lagi di order berikutnya. Kalau state catatan ikut masih
       terpasang, inputnya terbuka lagi tanpa kasir memintanya. */
    setSCatatan(null);
    setCustomer("");
    setDiskon(0);
    /* Kalau masih ada isinya di layar, kasir akan mengira hold gagal lalu
       menyalin order-nya dua kali. */
    setHoldStatus("tersimpan");
    say(`${jumlah} item masuk ${label}`);
    holdTimer.current = setTimeout(() => setHoldStatus("idle"), 2200);
  };

  /* Hold yang dibuka langsung dihapus dari daftar: isinya pindah ke
     keranjang yang sedang aktif, dan kasir masih menyelesaikannya di layar.

     Ini sengaja konsisten dengan keputusan "keranjang selalu kosong saat
     aplikasi dibuka" (lihat useState cart di atas): kalau keranjang ikut
     hilang setelah refresh, maka hold yang masih tersimpan dan BELUM dibuka
     tetap aman, sementara yang sudah dibuka tidak — jadi tidak ada keadaan
     di mana ada order tersimpan yang tidak terlihat di layar. Hold yang
     dibiarkan setelah dibuka justru lebih buruk: kasir bisa membukanya
     lagi dan menjual order yang sama dua kali. */
  const bukaHold = (h: HeldOrder) => {
    setCart(h.items);
    setSCatatan(null);
    setCustomer(h.customer || TANPA_NAMA);
    const berikut = holds.filter((x) => x.id !== h.id);
    setHolds(berikut);
    void cacheTulis(KUNCI_HOLD, { holds: berikut });
    setHoldOpen(false);
    say(`${h.label} dimuat ke keranjang`);
  };

  /* Feedback tambah: keranjang harus bergerak, kalau tidak kasir tidak
     yakin menu yang diketuk benar-benar masuk. Satu state pulse dipakai
     untuk kartu menu, baris keranjang, dan angka item.
     isNew hanya true kalau baris benar-benar baru muncul — menambah qty
     tidak boleh membuat daftar ikut bergulir. */
  const [pulse, setPulse] = useState<{ key: string; n: number; isNew: boolean } | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      if (noteTimer.current) clearTimeout(noteTimer.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  const flash = (key: string, isNew = false) => {
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    setPulse((p) => ({ key, n: (p?.n ?? 0) + 1, isNew }));
    pulseTimer.current = setTimeout(() => setPulse(null), 620);
  };

  /* Baris baru bisa muncul di bawah lipatan daftar. Gulirkan ke sana, tapi
     hanya seperlunya: kalau sudah kelihatan, jangan sampai daftarbergoyang.
     CartBody dirender dua kali (panel desktop dan sheet mobile), jadi yang
     dicari adalah elemen yang benar-benar terlihat. */
  useEffect(() => {
    if (!pulse?.isNew) return;
    const keBaris = () => {
      const nodes = document.querySelectorAll<HTMLElement>(
        `[data-cart-item="${CSS.escape(pulse.key)}"]`,
      );
      const target = Array.from(nodes).find((n) => n.offsetParent !== null);
      target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    keBaris();
    /* Baris baru masih bergeser saat animasi layout berjalan, jadi posisi
     scrollIntoView pertama dihitung dari posisi yang belum final: daftar
     berhenti underscroll dan baris baru terpotong ~8px di tepi bawah.
     Gulir sekali lagi setelah posisinya diam. */
    const t = setTimeout(keBaris, 140);
    return () => clearTimeout(t);
  }, [pulse]);

  /* Katalog = 1.095 baris products + 3.285 varian, berdurasi ±4,4 detik.
     Beranda tidak butuh itu, jadi baru ditarik ketika kasir benar-benar
     dibuka. */
  useEffect(() => {
    live.pastikanProduk();
  }, [live.pastikanProduk]);

  /* Sinkron produk dari Google Sheet otomatis saat halaman kasir dibuka.
     Non-bloking: UI tetap responsif walau sheet lambat. */
  useEffect(() => {
    triggerSyncFromSheet();
  }, []);

  /* Katalog langsung dari database: satu baris products = satu kartu.
     Tidak digabung — baris berulang itu memang dipakai untuk varian,
     jadi hasil query harus tampil apa adanya. */
  const katalog = useMemo(() => {
    return live.produk.map((p) => {
      const daftar = p.variants.map((v) => ({
        name: v.name,
        price: v.price,
        aktif: v.active,
        /* Harga custom berarti kasir yang mengetik nilainya. Kalau price 0
           diperlakukan sebagai harga, pesanannya masuk pembukuan Rp 0. */
        custom: v.pricing_type === "custom" || v.price <= 0,
      }));
      const v = p.variants.find((x) => x.is_default) ?? p.variants[0];
      return {
        id: p.client_id,
        name: p.name,
        category: p.category,
        price: v?.price ?? 0,
        stock: p.stock_unlimited ? null : p.stock,
        /* Varian aktif saja yang bisa dipilih — varian nonaktif ditampilkan
           supaya kasir tidak bingung mencari "Separuh" yang tak bisa dipesan. */
        variants: daftar.filter((x) => x.aktif),
      };
    });
  }, [live.produk]);

  const kategori = useMemo(() => {
    const set = new Set<string>();
    for (const m of katalog) if (m.category) set.add(m.category);
    return ["Semua", ...[...set].sort((a, b) => a.localeCompare(b, "id-ID"))];
  }, [katalog]);

  const list = useMemo(
    () =>
      katalog.filter(
        (m) =>
          (cat === "Semua" || m.category === cat) &&
          (q === "" || m.name.toLowerCase().includes(q.toLowerCase())),
      ),
    [katalog, cat, q],
  );

  /* Varian menentukan harga. "Nasi Goreng · Separuh" harus masuk keranjang
     seharga separuh, bukan harga menu penuh — kalau tidak, setiap pesanan
     setengah porsi tercatat terlalu mahal. */
  const add = (id: string, namaVarian?: string) => {
    const m = katalog.find((x) => x.id === id);
    if (!m) return;
    const v = namaVarian ? m.variants.find((x) => x.name === namaVarian) : m.variants[0];
    const varian = v?.name ?? "";
    const harga = v?.price ?? m.price;
    const key = `${id}|${varian}`;
    const isNew = !cart.some((x) => x.id === key);
    setCart((c) => {
      const found = c.find((x) => x.id === key);
      if (found) {
        if (found.stock !== null && found.qty + 1 > found.stock) return c;
        return c.map((x) => (x.id === key ? { ...x, qty: x.qty + 1 } : x));
      }
      return [
        ...c,
        {
          id: key,
          name: m.name,
          variant: varian,
          price: harga,
          custom: Boolean(v?.custom),
          qty: 1,
          stock: m.stock,
        },
      ];
    });
    flash(key, isNew);
  };

  /* Harga baris custom diketik kasir. Nol berarti belum diisi — bukan
     "gratis", dan pembayaran tidak boleh diteruskan sampai diisi. */
  const setHarga = (key: string, harga: number) =>
    setCart((c) =>
      c.map((x) => (x.id === key ? { ...x, price: Math.max(0, Math.round(harga)) } : x)),
    );

  /* Catatan per baris: "tanpa sambel", "tanpa lontong". Kasir tidak
     menekan tombol simpan atau enter untuk menyimpannya — nilai diambil
     apa adanya saat blur, supaya kasir bisa mengetik lalu langsung
     menekan item berikutnya tanpa satu pun langkah tambahan.

     Hanya satu baris yang boleh terbuka. Dua input aktif di keranjang
     yang sama berarti keyboard HP bouncing saat kasir mengetik. */
  const [sCatatan, setSCatatan] = useState<string | null>(null);

  /* Spasi tepi dibuang sebelum disimpan, dan isian yang jadi kosong
     dihapus total — bukan tersimpan sebagai "". Lihat catatan-item.ts:
     kolom note di database dan cetakan struk harus menerima nilai yang
     sama persis untuk kasus "tidak ada catatan". */
  const setCatatan = (key: string, teks: string) =>
    setCart((c) => {
      const bersih = rapikanCatatan(teks);
      return c.map((x) =>
        x.id === key ? { ...x, note: bersih } : x,
      );
    });

  const hargaBelumLengkap = cart.some((i) => i.custom && i.price <= 0);

  /* Ongkir lama customer terisi sendiri begitu namanya cocok dengan data
     pelanggan. Sifatnya hanya mengisi, tidak mengunci: kasir tetap boleh
     mengubahnya karena kadang ongkir naik. */
  const terisiOngkir = useRef(false);
  useEffect(() => {
    const nama = customer.trim().toLowerCase();
    if (nama === "" || terisiOngkir.current) return;
    const cocok = live.customers.find((c) => c.name.trim().toLowerCase() === nama);
    if (!cocok) return;
    terisiOngkir.current = true;
    if (cocok.ongkir > 0) setOngkir(cocok.ongkir);
  }, [customer, live.customers]);
  /* Kalau nama dikosongkan atau diganti, Isi-otomatis boleh jalan lagi. */
  useEffect(() => {
    if (customer.trim() === "") terisiOngkir.current = false;
  }, [customer]);

  const setQty = (key: string, qty: number) =>
    setCart((c) =>
      qty <= 0
        ? c.filter((x) => x.id !== key)
        : c.map((x) => (x.id === key ? { ...x, qty } : x)),
    );

  const subtotal = cart.reduce((a, i) => a + i.price * i.qty, 0);
  const total = Math.max(0, subtotal - diskon + ongkir);

  /* Saran customer untuk dropdown keranjang. Alias diambil dari
     `customer_aliases` dan sudah terikat ke nama aslinya — jadi
     mengetik "Bhas Sari 38" menemukan "Bhaskara sari 38", dan yang
     tersimpan ke struk tetap nama asli supaya ongkir dan riwayatnya
     tidak terbelah jadi dua customer. */
  const opsiCustomer = useMemo(
    () => saranCustomer(live.customers, live.customerAlias),
    [live.customers, live.customerAlias],
  );

  /* Cart item id = "client_id|varian", jadi client_id barang dan nama
     varian bisa diambil tanpa state tambahan. */
  const jadiBarisJual = (): BarisJual[] =>
    cart.map((i) => {
      const [clientId, varian] = i.id.split("|");
      return {
        productClientId: clientId,
        variantClientId: "",
        menuName: i.name,
        variantName: varian ?? i.variant,
        name: i.name,
        price: i.price,
        qty: i.qty,
        note: i.note ?? "",
        tanpaBatas: i.stock === null,
      };
    });

  /* Selesaikan transaksi. Urutannya mengikuti versi lama: simpan dulu,
     baru kosongkan keranjang, baru perbarui data layar — supaya kalau
     simpan gagal, orderan kasir tidak ikut hilang. */
  const selesaikan = async (cetak: boolean) => {
    if (cart.length === 0 || hargaBelumLengkap || menyelesaikan) return;
    /* Stok kurang harus dicegat di sini, bukan setelah struk tercetak:
       struk yang sudah keluar tidak bisa ditarik kembali. */
    const kurang = cart.find((i) => i.stock !== null && i.qty > i.stock);
    if (kurang) {
      say(`${kurang.name} stok tinggal ${kurang.stock}`, "warn");
      return;
    }
    setMenyelesaikan(true);
    try {
      const hasil = await simpanPenjualan({
        customer,
        payment: pay,
        items: jadiBarisJual(),
        ongkir,
        diskon,
        note: "",
        sendNote: "",
      });
      setCart([]);
      setSCatatan(null);
      setDiskon(0);
      setCustomer("");
      setCartOpen(false);
      setSelesai(hasil);
      /* Dashboard, ringkasan, dan laporan membaca dari cache lokal.
         Cache dikosongkan dulu supaya halaman lain tidak menampilkan angka
         yang sudah basi — termasuk struk yang baru saja ini.

         Daftar order tersimpan dikecualikan: yang terus dihapus adalah
         cache data pasar, sedangkan daftar itu bukan data pasar. Kalau
         ikut terhapus, kasir menyelesaikan satu order dan semua order
         lain yang sedang menunggu ikut hilang. */
      await cacheKosongkanKecuali(KUNCI_HOLD);
      await live.muatUlang();
      say(`${hasil.receiptNo} tersimpan`);
      /* printFlow "preview" berarti struk sengaja BELUM dicetak: kasir
         memeriksa tampilannya dulu lewat tombol "Cetak Struk". */
      if (cetak && setelan.autoPrint && setelan.printFlow === "direct") void cetakHasil(hasil);
    } catch (e) {
      say(`Transaksi gagal: ${(e as Error).message}`, "warn");
    } finally {
      setMenyelesaikan(false);
    }
  };

  /* Pratinjau struk: dipakai saat setelan.printFlow = "preview", yaitu
     struk belum dicetak dan kasir memeriksa dulu. Generator dan CSS-nya
     sama persis dengan yang dipakai mencetak, jadi yang dilihat memang
     bentuk kertas yang akan keluar. */
  const htmlPratinjau = useMemo(() => {
    if (!selesai || setelan.printFlow !== "preview") return "";
    const data = dataStrukDari(selesai);
    return `<!doctype html><html lang="id"><head><meta charset="utf-8"><style>${cssStruk(setelan)}</style></head><body><article class="receipt-paper">${strukHtml(data, setelan)}</article></body></html>`;
  }, [selesai, setelan]);

  /* Cetak struk yang baru tersimpan — lewat mekanisme yang sama dengan
     cetak batch di Import Pesanan: iframe tersembunyi dengan @page 48mm,
     bukan window.open(). */
  const cetakHasil = (hasil: HasilJual) => void cetakStrukSatuan(dataStrukDari(hasil), setelan);

  /* Tiga keadaan yang berbeda, tidak boleh jadi satu: sedang memuat,
     katalog benar-benar kosong, dan filter tidak cocok. */
  const judulKatalog = live.produkMemuat
    ? "Memuat menu…"
    : live.produk.length === 0
      ? live.produkDimuat
        ? "Belum ada menu"
        : "Menu belum dimuat"
      : "Menu tidak ditemukan";
  const pesanKatalog = live.produkMemuat
    ? "Katalog sedang ditarik dari Supabase"
    : live.produk.length === 0
      ? live.produkDimuat
        ? "Tambah menu dulu di halaman Kelola Menu"
        : live.status === "live"
          ? "Tutup lalu buka lagi halaman ini, atau muat ulang dari lencana status"
          : "Supabase belum terbaca"
      : "Coba kata kunci lain";

  const CartBody = (
    <>
      {/* customer */}
      <div className="mb-3">
        <InputCustomer
          value={customer}
          onChange={setCustomer}
          placeholder="Nama / alamat customer…"
          saran={opsiCustomer}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">Ongkir lama customer terisi otomatis.</p>
      </div>

      {/* items — bagian yang boleh merebut ruang. Semua blok di bawahnya
          sengaja dibuat rapat supaya daftar orderan tidak tergencet. */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain">
        <AnimatePresence initial={false}>
          {cart.map((i) => (
            <motion.div
              key={i.id}
              data-cart-item={i.id}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={
                pulse?.key === i.id
                  ? { opacity: 1, y: 0, scale: [1, 1.035, 1] }
                  : { opacity: 1, y: 0, scale: 1 }
              }
              exit={{ opacity: 0, x: 20 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              className={
                "rounded-2xl border bg-card p-3 transition-colors " +
                (pulse?.key === i.id ? "border-primary" : "border-border")
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{i.name}</div>
                  {i.custom ? (
                    /* Varian custom: harga belum diketahui sampai kasir
                       mengetiknya. Menampilkan "Rp 0" akan terbaca sebagai
                       barang gratis. */
                    <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="shrink-0">{i.variant}</span>
                      <span className="figure">Rp</span>
                      <InputRupiah
                        aria-label={`Harga ${i.variant}`}
                        value={i.price}
                        onChange={(n) => setHarga(i.id, n)}
                        placeholder="isi harga"
                        className={
                          "h-8 w-24 px-2 text-sm font-semibold " +
                          (i.price > 0 ? "border-border" : "border-warning")
                        }
                      />
                    </label>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      {i.variant} · {rupiah(i.price)}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-sm font-bold figure">{rupiah(i.price * i.qty)}</div>
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                <button
                  onClick={() => setQty(i.id, i.qty - 1)}
                  aria-label="Kurangi"
                  className="grid h-8 w-8 place-items-center rounded-full border border-input text-foreground transition-colors hover:border-ring active:scale-90"
                >
                  −
                </button>
                <span className="w-10 text-center text-sm font-semibold figure">{fmtQty(i.qty)}</span>
                <button
                  onClick={() => {
                    setQty(i.id, i.qty + 1);
                    flash(i.id, false); // qty naik, bukan item baru
                  }}
                  aria-label="Tambah"
                  className="grid h-8 w-8 place-items-center rounded-full border border-input text-foreground transition-colors hover:border-ring active:scale-90"
                >
                  +
                </button>
                <span className="ml-auto text-xs text-muted-foreground figure">
                  {i.stock === null ? "Tanpa batas" : `sisa ${i.stock}`}
                </span>
              </div>
              {/* Catatan: hanya lewat sini. Ditaruh di bawah baris qty
                  supaya baris tanpa catatan tetap setinggi aslinya —
                  orderan tanpa permintaan khusus adalah kasus umum,
                  jadi jangan memberatkan setiap baris untuknya. */}
              {sCatatan === i.id ? (
                <CatatanInput
                  /* key per baris: tanpa itu React memakai ulang instance yang
                     sama untuk baris berikutnya dan draft baris lama terbawa. */
                  key={i.id}
                  awal={i.note ?? ""}
                  placeholder="mis. tanpa sambel, tanpa lontong"
                  ariaLabel={`Catatan ${i.name}`}
                  onSelesai={(catatan) => {
                    setCatatan(i.id, catatan ?? "");
                    setSCatatan(null);
                  }}
                  className={
                    "mt-2 h-9 w-full rounded-xl border border-input bg-card px-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
                  }
                />
              ) : i.note ? (
                <button
                  onClick={() => setSCatatan(i.id)}
                  aria-label={`Ubah catatan ${i.name}`}
                  className="mt-2 flex w-full items-center gap-1.5 rounded-xl bg-accent/60 px-2.5 py-1.5 text-left transition-colors hover:bg-accent"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {i.note}
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                    Ubah
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => setSCatatan(i.id)}
                  className="mt-2 text-[11px] font-semibold text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  + Catatan
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {cart.length === 0 && (
          <div className="grid place-items-center rounded-2xl border border-dashed border-input px-4 py-8 text-center">
            <p className="text-sm font-semibold text-muted-foreground">Keranjang kosong</p>
            <p className="mt-1 text-xs text-muted-foreground">Ketuk menu untuk menambah</p>
          </div>
        )}
      </div>

      {/* totals — dibuat rapat: label kecil di atas input, Diskon dan Ongkir
          sebaris. Tujuannya satu: jangan sampai daftar orderan tergencet. */}
      <div className="mt-2.5 shrink-0 space-y-1.5 border-t border-border pt-2.5">
        <Row label="Subtotal" value={rupiah(subtotal)} />
        <div className="grid grid-cols-2 gap-2">
          <MiniField label="Diskon">
            <InputRupiah
              aria-label="Diskon"
              value={diskon}
              onChange={setDiskon}
              placeholder="0"
              className="h-9 px-2.5"
            />
          </MiniField>
          <MiniField label="Ongkir">
            <InputRupiah
              aria-label="Ongkir"
              value={ongkir}
              onChange={setOngkir}
              placeholder="0"
              className="h-9 px-2.5"
            />
          </MiniField>
        </div>
        <div className="flex items-baseline justify-between pt-0.5">
          <span className="text-sm font-semibold text-muted-foreground">Total</span>
          <span className="text-lg font-bold tracking-tight figure">{rupiah(total)}</span>
        </div>
      </div>

      {/* payment */}
      <div className="mt-2.5 shrink-0">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Pembayaran
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {["Tunai", "QRIS", "Debit", "Transfer"].map((m) => (
            <button
              key={m}
              onClick={() => setPay(m)}
              className={
                "h-9 rounded-xl border text-xs font-semibold transition-colors " +
                (pay === m
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-card text-muted-foreground")
              }
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2.5 grid shrink-0 grid-cols-[auto_1fr] gap-2">
        <button onClick={() => { setCart([]); setSCatatan(null); }} className={btnGhost}>
          Kosongkan
        </button>
        {/* Transaksi dengan baris custom yang harganya masih kosong tidak
            boleh diselesaikan: totalnya akan salah, dan yang bayar tidak
            pernah nol. */}
        <button
          onClick={() => void selesaikan(true)}
          disabled={cart.length === 0 || hargaBelumLengkap || menyelesaikan}
          title={hargaBelumLengkap ? "Isi harga untuk varian custom dulu" : undefined}
          className={btnPrimary}
        >
          {menyelesaikan
            ? "Menyimpan…"
            : hargaBelumLengkap
              ? "Isi harga custom dulu"
              : `Bayar ${rupiah(total)}`}
        </button>
      </div>
    </>
  );

  return (
    <div>
      {/* Satu toast untuk seluruh halaman. CartBody dirender dua kali (panel
          desktop dan sheet mobile), jadi kalau Toast ditaruh di dalamnya,
          pesan yang sama muncul dua kali sekaligus. */}
      <Toast toast={note} />

      {/* Konfirmasi transaksi. Satu panel di luar keranjang supaya tidak
          muncul dua kali (keranjang dirender di panel desktop dan sheet
          mobile) dan tetap terlihat di kedua ukuran layar. */}
      {selesai && (
        <div className="mb-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                Transaksi tersimpan · {selesai.receiptNo}
              </p>
              <p className="text-xs text-muted-foreground">
                No. antrean {selesai.struk.queueNo} · {selesai.struk.payment} ·{" "}
                {rupiah(selesai.struk.total)}
                {setelan.autoPrint && setelan.printFlow === "direct"
                  ? " · struk sudah dikirim ke printer"
                  : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button onClick={() => cetakHasil(selesai)} className={btnPrimary}>
                Cetak Struk
              </button>
              <button onClick={() => setSelesai(null)} className={btnGhost}>
                Orderan Baru
              </button>
            </div>
          </div>
          {htmlPratinjau && (
            <iframe
              title="Pratinjau struk"
              srcDoc={htmlPratinjau}
              sandbox="allow-same-origin"
              className="mt-3 h-[420px] w-full rounded-xl border border-border bg-white"
            />
          )}
        </div>
      )}

      <PageHeader
        title="Kasir"
        sub="Pilih menu, masukkan keranjang, lalu selesaikan pembayaran."
        action={
          /* Lebar penuh di bawah sm: PageHeader justify-between membuat
             dua tombol ini duduk di kiri dengan ruang kosong besar di
             kanan layar HP. Di tablet (sm+) kembali ikut isinya. */
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {/* Satu tombol, tiga kondisi. Lebarnya dikunci supaya teks
                "Tersimpan" tidak membuat tombol melebar lalu susunan
                tombol di kanannya bergeser. */}
            <motion.button
              onClick={simpanHold}
              whileTap={holdStatus === "idle" ? { scale: 0.95 } : undefined}
              aria-live="polite"
              className={
                "inline-flex h-11 min-w-[9.5rem] flex-1 items-center justify-center gap-1.5 rounded-full px-4 " +
                "text-sm font-semibold transition-colors duration-200 sm:flex-none " +
                (holdStatus === "tersimpan"
                  ? "bg-primary text-primary-foreground"
                  : holdStatus === "kosong"
                    ? "bg-[#F3DBA2] text-[#6B4A0A] dark:bg-[#3A2A10] dark:text-[#F0C987]"
                    : btnGhost)
              }
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={holdStatus}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.14 }}
                  className="flex items-center gap-1.5"
                >
                  {holdStatus === "tersimpan" && <span aria-hidden>✓</span>}
                  {holdStatus === "tersimpan" ? "Tersimpan" : holdStatus === "kosong" ? "Keranjang kosong" : "Simpan Hold"}
                </motion.span>
              </AnimatePresence>
            </motion.button>
            <motion.button
              onClick={() => setHoldOpen(true)}
              whileTap={{ scale: 0.95 }}
              className={btnGhost + " flex-1 sm:flex-none"}
            >
              Buka Hold
            </motion.button>

          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* ---- MENU ---- */}
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari menu atau SKU…"
              className={inputClass + " max-w-xs"}
            />
            <div className="flex gap-1 overflow-x-auto rounded-full bg-muted p-1">
              {kategori.map((c) => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={
                    "shrink-0 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors " +
                    (cat === c ? "bg-card shadow-card" : "text-muted-foreground")
                  }
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* mode="popLayout": kartu yang keluar ikut animasi hilang, sementara
              sisanya langsung naik ke tempat yang kosong. Tanpa itu, tiap
              ketikan bikin semua kartu melompat ke posisi baru. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence initial={false} mode="popLayout">
            {list.map((m, i) => {
              /* Satu produk = satu kartu. Varian jadi baris di dalam kartu dan
                 bisa diklik satu per satu — bukan label pasif. Mengetuk
                 "Separuh Porsi" harus benar-benar memasukkan separuh porsi ke
                 keranjang, dengan harga separuh porsi. */
              const varianDipilih = m.variants.length > 1;
              /* Varian custom tidak ikut dihitung: harganya belum diketahui,
                 jadi menjadikannya "mulai Rp 0" berbohong. */
              const hargaBawaan = m.variants.filter((v) => !v.custom).map((v) => v.price);
              const termurah = hargaBawaan.length ? Math.min(...hargaBawaan) : m.price;
              /* Animation only when filtering. Full catalog on first open
                 is 1,095 cards — animating that blocks first paint. */
              const geser = q.trim() !== "" || cat !== "Semua";
              return (
                <motion.div
                  key={m.id}
                  layout
                  initial={geser ? { opacity: 0, y: 8 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  exit={geser ? { opacity: 0, scale: 0.97 } : undefined}
                  transition={{ duration: 0.18, delay: delayDaftar(i, kurangi), ease: [0.22, 1, 0.36, 1] }}
                  className="relative"
                >
                  <motion.div
                    layout
                    className={
                      "flex h-full w-full flex-col rounded-3xl bg-card p-4 text-left shadow-card transition-colors " +
                      (pulse?.key.startsWith(`${m.id}|`) ? "ring-2 ring-primary" : "")
                    }
                  >
                    <span className="text-sm font-semibold leading-snug">{m.name}</span>
                    <span className="mt-0.5 text-xs text-muted-foreground">{m.category}</span>

                    {varianDipilih && (
                      <span className="mt-2 text-lg font-bold tracking-tight figure">
                        {rupiah(termurah)}
                        <span className="ml-1 text-xs font-medium text-muted-foreground">mulai</span>
                      </span>
                    )}

                    <div className="mt-2 flex items-center gap-1.5">
                      {m.stock === null ? (
                        <Pill>Tanpa batas</Pill>
                      ) : (
                        <Pill tone={m.stock <= 10 ? "warning" : "neutral"}>sisa {m.stock}</Pill>
                      )}
                      {varianDipilih && <Pill>{m.variants.length} varian</Pill>}
                    </div>

                    <ul className="mt-3 space-y-1.5">
                      {m.variants.map((v) => {
                        const key = `${m.id}|${v.name}`;
                        const hot = pulse?.key === key;
                        return (
                          <li key={v.name}>
                            <motion.button
                              /* Hook untuk E2E. Selector lama `li button`
                                 ikut mengenai filter kategori di sidebar,
                                 jadi test pernah mengklik chip filter
                                 alih-alih varian — dan lalu melompat
                                 `test.skip` tanpa satu pun assertion
                                 dijalankan. */
                              data-variant-add={v.name}
                              onClick={() => add(m.id, v.name)}
                              whileTap={{ scale: 0.97 }}
                              className={
                                "flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left transition-colors " +
                                (hot ? "bg-primary/12" : "bg-accent/50 hover:bg-accent")
                              }
                            >
                              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{v.name}</span>
                              <span className="shrink-0 text-sm font-bold figure">
                                {v.custom ? (
                                  <span className="text-xs font-semibold text-muted-foreground">harga custom</span>
                                ) : (
                                  rupiah(v.price)
                                )}
                              </span>
                              <span
                                aria-hidden="true"
                                className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-base font-bold leading-none text-primary-foreground"
                              >
                                +
                              </span>
                            </motion.button>
                          </li>
                        );
                      })}
                    </ul>
                  </motion.div>

                  {/* umpan balik: "+1" melayang naik lalu hilang */}
                  <AnimatePresence>
                    {pulse && pulse.key.startsWith(`${m.id}|`) && (
                      <motion.span
                        key={pulse.n}
                        initial={{ opacity: 0, y: 0, scale: 0.6 }}
                        animate={{ opacity: [0, 1, 1, 0], y: [0, -8, -34, -48], scale: [0.6, 1.15, 1, 0.9] }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.62, times: [0, 0.12, 0.6, 1], ease: "easeOut" }}
                        className="pointer-events-none absolute right-3 top-3 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground shadow-pop"
                      >
                        +1
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
            </AnimatePresence>
            {list.length === 0 && (
              <motion.div
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: kurangi ? 0 : 0.15 }}
                className="col-span-full grid place-items-center rounded-3xl border border-dashed border-input py-16 text-center"
              >
                <p className="font-semibold text-muted-foreground">{judulKatalog}</p>
                <p className="mt-1 text-sm text-muted-foreground">{pesanKatalog}</p>
              </motion.div>
            )}
          </div>
        </div>

        {/* ---- KERANJANG (desktop) ---- */}
        <aside className="hidden xl:block">
          <div className="sticky top-24 flex max-h-[calc(100dvh-8rem)] flex-col rounded-3xl bg-card p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Keranjang</h2>
              <Pop n={cart.length} className="text-xs text-muted-foreground figure">
                {cart.length} item
              </Pop>
            </div>
            {CartBody}
          </div>
        </aside>
      </div>

      {/* ---- KERANJANG (mobile sheet) ---- */}
      <div className="xl:hidden">
        <button
          /* Tanpa `aria-label`, isinya hanya jumlah item dan nominal
             ("0 item" + "Rp 15.000"). Screen reader membacanya sebagai
             "tombol, 0 item, Rp 15.000" — kasir tidak tahu itu keranjang.
             Nama harus menyebut fungsinya, bukan angkanya: nominal
             berubah tiap detik, nama harusnya tidak. */
          aria-label={`Buka keranjang, ${cart.length} item`}
          onClick={() => setCartOpen(true)}
          className="fixed inset-x-4 bottom-4 z-40 flex h-14 items-center justify-between rounded-full bg-sidebar px-5 text-sidebar-foreground shadow-pop"
        >
          <span className="font-semibold">
            <Pop n={cart.length}>{cart.length} item</Pop>
          </span>
          <Pop n={total} className="font-bold figure">
            {rupiah(total)}
          </Pop>
        </button>

        <AnimatePresence>
          {cartOpen && (
            <div className="fixed inset-0 z-50">
              <motion.button
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                aria-label="Tutup keranjang"
                className="absolute inset-0 bg-black/40"
                onClick={() => setCartOpen(false)}
              />
              <motion.div
                initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 320, damping: 34 }}
                className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-3xl bg-card p-4 shadow-pop"
              >
                <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-muted" />
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-bold">Keranjang · {SHOP}</h2>
                  <button onClick={() => setCartOpen(false)} className="text-sm text-muted-foreground">
                    Tutup
                  </button>
                </div>
                {CartBody}
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* ---- BUKA HOLD (sheet) ---- */}
      <AnimatePresence>
        {holdOpen && (
          <div className="fixed inset-0 z-50">
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              aria-label="Tutup daftar hold"
              className="absolute inset-0 bg-black/40"
              onClick={() => setHoldOpen(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col rounded-t-3xl bg-card p-4 shadow-pop"
            >
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-muted" />
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-bold">Orderan Disimpan</h2>
                <button
                  onClick={() => setHoldOpen(false)}
                  className="text-sm text-muted-foreground"
                >
                  Tutup
                </button>
              </div>

              <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                <AnimatePresence initial={false}>
                  {holds.map((h, i) => {
                    const totalHold = h.items.reduce((a, x) => a + x.price * x.qty, 0);
                    return (
                      <motion.li
                        key={h.id}
                        layout
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -24, height: 0 }}
                        transition={{ type: "spring", stiffness: 340, damping: 30, delay: i * 0.04 }}
                      >
                        <button
                          onClick={() => bukaHold(h)}
                          className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3.5 text-left transition-colors hover:border-primary"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{h.customer}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {h.items.length} item · {h.savedAt}
                            </div>
                            <div className="mt-1 truncate text-[11px] text-muted-foreground">
                              {ringkasCatatan(h.items, fmtQty)}
                            </div>
                          </div>
                          <div className="shrink-0 text-sm font-bold figure">
                            {rupiah(totalHold)}
                          </div>
                        </button>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="figure">{value}</span>
    </div>
  );
}

/** Input bernomor ringkas: label kecil di atas, input penuh di bawah. */
function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

/* Angka yang melompat tiap nilainya berubah — kunci pada nilai supaya
   remount, lalu skala masuk pakai spring. */
function Pop({
  n,
  children,
  className,
}: {
  n: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.span
      key={n}
      initial={{ scale: 0.72, opacity: 0.4 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 620, damping: 18 }}
      className={className}
    >
      {children}
    </motion.span>
  );
}
