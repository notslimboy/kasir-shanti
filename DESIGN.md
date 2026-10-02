# Design System — Kasir Shanti (Next)

Source of truth visual: [`design/reference.png`](design/reference.png)
Di-*sample* langsung dari pixel gambar (bukan dikira-kira), 29 Sep 2026.

> **Penting:** referensi ini adalah dashboard admin/e-commerce generik. Ia
> **tidak** mencakup POS checkout, struk thermal, mode offline, atau bahasa
> Indonesia. Bagian bawah memisahkan apa yang terbawa dan apa yang harus
> diterjemahkan.

---

## 1. Palette

Semua nilai di bawah diambil dari piksel gambar.

| Token | Nilai | Peran |
|---|---|---|
| `--forest` | `#032313` | Sidebar gelap, ikon |
| `--forest-deep` | `#092C1B` | KPI card aktif, teks pada lime |
| `--forest-mid` | `#397968` | Segmen donat tengah, garis sekunder |
| `--lime` | `#AEDD33` | **Accent utama** — ikon aktif, segmen donat |
| `--lime-soft` | `#BDE55D` | Garis chart lime |
| `--lime-area` | `#D9F0A2` | Isi area di bawah garis chart |
| `--lime-bar` | `#78A22B` | Indikator aktif di sidebar |
| `--page` | `#F5FCE3` | Background halaman (krem-limau pucat) |
| `--surface` | `#FFFFFF` | Kartu |
| `--mint` | `#ECF3F1` | Pill status sukses / lunas |
| `--amber` | `#F3DBA2` | Pill status menunggu / belum lunas |
| `--amber-ink` | `#B45309` | Teks pada amber (perlu kontras ≥4.5:1) |
| `--orange` | `~#F0A04B` | ⚠️ **perlu cek mata** — garis tipis, sulit disample |

### Aturan warna

- **Satu aksen saja: lime.** Hijau tua = struktur, lime = aksi/penekanan.
- **Forest-deep hanya untuk satu hal:** kartu KPI yang sedang aktif/fokus.
  Kalau dua kartu gelap, tidak ada yang menonjol.
- **Lime tidak pernah jadi background teks panjang** — kontrasnya rendah.
  Lime untuk ikon, angka besar, garis, dan border aktif saja.
- **Angka selalu tabular.** Semua nominal rupiah rata kanan, rata kolom.

### Dark mode

Referensi **tidak punya dark mode**. Untuk POS yang dipakai malam, dark mode
wajib ada. Turunan yang masuk akal:

| Token | Dark |
|---|---|
| `--page` | `#0A1510` |
| `--surface` | `#10201A` |
| `--forest` | `#061E12` |
| `--lime` | `#B8E84A` (dinaikkan agar terbaca di gelap) |

---

## 2. Bentuk

Referensi ini **sangat rounded** — ini signature-nya, jangan dikecilkan.

| Token | Nilai | Dipakai untuk |
|---|---|---|
| `--radius-card` | `24px` | KPI card, chart card, tabel card |
| `--radius-inner` | `16px` | Elemen di dalam card |
| `--radius-control` | `12px` | Tombol, input, tab |
| `--radius-pill` | `999px` | Pill status, chip filter, avatar |
| `--radius-sheet` | `32px` | Sheet/modal |

**Shadow** — lembut, besar, tidak keras:
```
--shadow-card:  0 8px 24px -12px rgba(3, 35, 19, 0.14);
--shadow-pop:   0 16px 40px -16px rgba(3, 35, 19, 0.22);
--shadow-none:  none;
```

---

## 3. Layout

```
┌──────┬───────────────────────────────────────────────┐
│      │ Topbar: brand ⌄      search        [+] aksi    │
│ side │───────────────────────────────────────────────│
│ bar  │ ┌────┐ ┌────┐ ┌────┐ ┌────┐   KPI row (4)      │
│      │ └────┘ └────┘ └────┘ └────┘                    │
│ 88px ├─────────────────────────────┬─────────────────┤
│      │                             │  Donut + legend │
│      │   Chart besar (2/3)         │  (1/3)           │
│      │                             │                 │
│      ├─────────────────────────────┤  Gauge kartu    │
│      │   Tabel (full width)        │  (1/3)           │
│      └─────────────────────────────┴─────────────────┘
```

- **Sidebar 88px, icon-only**, `--forest`, rounded di sisi kanan
- Icon aktif: lime + **bar lime 4px di sisi kiri** (`--lime-bar`)
- Avatar di dasar sidebar
- **Breakpoint mobile:** sidebar jadi bottom bar atau drawer. Di POS, lebar
  390px harus bisa menyelesaikan transaksi.

---

## 4. Komponen

### Sidebar
- Ikon saja, 20px, stroke 1.75
- Item aktif: ikon lime + bar kiri 4px `--lime-bar` + bg `rgba(174,221,51,0.10)`
- Hover: bg putih 6%

### Topbar
- Kiri: nama + chevron (dropdown workspace)
- Tengah: search pill, bg putih, radius pill
- Kanan: icon button + primary action `+ Tambah` (bg lime, teks `#092C1B`)

### KPI card
```
┌─────────────────────────┐
│ Total Sales      (icon) │   label: 13px, #5A6B5F
│ $564.00                 │   angka: 30px, 700, tabular
│ [+15%] from last month  │   delta pill + teks
└─────────────────────────┘
```
- **Varian aktif:** bg `--forest-deep`, label putih, angka putih, delta lime
- Delta naik: pill bg lime 18%, teks forest-deep
- Delta turun: pill bg merah 14%, teks merah tua
- Ikon: bulatan 40px, bg lime 18%, ikon forest-deep

### Chart besar
- Line chart, 2 seri (omzet + transaksi)
- Garis 3px, **tanpa smoothing berlebihan**, area fill di bawah garis 1
- Sumbu Y format ringkas (`260M`, bukan `260.000.000`)
- Tooltip: kartu putih, radius 12px, shadow-pop, label kecil + angka besar tabular
- **Hover: crosshair dashed + titik besar** (seperti di referensi)

### Donut + legend
- Donut tebal (~22px), gap putih 4px antar segmen
- 4 warna: forest-deep → forest-mid → lime → orange
- Legend: bullet 6px + label kiri, persentase **rata kanan tabular**

### Gauge
- Setengah lingkaran, track `#EEF4DE`, fill forest-deep
- Angka besar di tengah, `%` kecil

### Tabel
- Header: `#F5FCE3`, uppercase 11px, tracking 0.06em, `#5A6B5F`
- Baris: border-bottom `#EEF4DE`, tinggi 64px
- Checkbox 20px rounded 6px, centang lime
- Kolom: # · Order ID · Produk (+thumbnail) · Tanggal · Harga · Status · Aksi
- **Harga rata kanan, tabular**
- Status pill: `Lunas` bg mint teks hijau tua · `Belum lunas` bg amber teks amber-ink
- Aksi: tombol ikon bulat, hover bg lime 12%

---

## 5. Tipografi

Referensi memakai sans geometric/-rounded. Rekomendasi:

- **UI / heading:** Plus Jakarta Sans (sudah dipakai di app lama, sudah disukai)
- **Angka:** Azeret Mono tabular — atau tabular-nums di Plus Jakarta Sans

| Peran | Ukuran | Weight | Tracking |
|---|---|---|---|
| Display (angka KPI) | 30px | 700 | −0.02em |
| H1 halaman | 20px | 700 | −0.02em |
| Card title | 16px | 600 | −0.01em |
| Body | 14px | 500 | 0 |
| Label / column head | 11–13px | 600 | 0.02em (uppercase untuk header) |
| Delta pill | 12px | 600 | 0 |

---

## 6. Yang terbawa dari referensi

✅ Struktur KPI row · chart besar + kolom donat · tabel dengan status pill
✅ Sidebar icon-only dengan active bar lime · palette forest+lime
✅ Radius besar (16–24px) · shadow lembut

## 7. Yang harus diterjemahkan (referensi tidak punya ini)

| Referensi (EN) | Versi kasir (ID) |
|---|---|
| `$564.00` | `Rp 265.000` |
| Total Sales | Omset / Transaksi |
| Profit | ⚠️ **tidak ada** — katering tidak hitung profit |
| Invoice | Struk |
| Total Visitor / Affiliate Program | **tidak relevan** → ganti **Ongkir per Kurir** + **Metode Pembayaran** |
| "On Progress" / "Pending" | `Lunas` / `Belum Lunas` / `Terhapus` |
| "Add new product" | `+ Tambah Menu` |
| "Search here..." | `Cari menu, SKU, atau customer...` |
| "Recent Order" | `Struk Terbaru` |
| "View all" | `Lihat semua` |

### Yang belum ada di referensi sama sekali — harus desain sendiri
1. **POS checkout** — layar transaksi utama. Prioritas #1.
2. **Struk thermal 72mm** — format fisik, tidak boleh服从 style kartu.
3. **State offline** — loading, sync, error, retry.
4. **Variant / harga** — pricing type (normal / per-unit / paket / custom).
5. **Multi-tenant reality** — 1 toko, 1 kasir, tidak ada workspace switcher.

---

## 8. Kontrol: tidak ada widget bawaan browser

`<select>`, `<input type="date">`, dan `<datalist>` membuka UI milik sistem
operasi. UI itu tidak bisa diberi token tema, warnanya beda tiap platform,
dan panelnya sering terpotong di layar kasir yang sempit.

Semua kontrol karena itu dibangun sendiri di `src/components/ui/`:

| Kebutuhan | Komponen | Catatan |
|---|---|---|
| Pilihan tunggal | `Select` | buka/animasi Motion, ketung untuk cari, keyboard penuh |
| Rentang tanggal | `DateRangePicker` | pilih dari–sampai dalam satu kalender, ada preset |

`src/lib/native-controls.test.ts` memindai `src/` dan gagal kalau ada tag
tersebut muncul lagi. Kalau test itu gagal, komponennya yang salah — bukan
testnya.

---

## 9. Chart

Semua chart wajib beranimasi, termasuk saat pindah halaman. Karena setiap
halaman di-unmount saat route berubah, chart baru selalu remount dan animasi
intro ikut terulang — tidak perlu state tambahan.

- `CHART_ANIM` / `CHART_ANIM_FAST` dari `src/components/chart-motion.ts`
  disebar ke `<Area>`, `<Bar>`, `<Pie>`. Jangan tulis `isAnimationActive={false}`.
- `ChartBox` punya dua mode: `height={260}` untuk chart pendek, atau `fill`
  untuk chart yang harus ikut tinggi kartu (`<Card fillBody>`). Tanpa `fill`,
  kartu di grid akan menyisakan ruang kosong di bawah chart.

Verifikasi chart tidak bisa pakai `--screenshot --virtual-time-budget`:
virtual time melompatkan timer tapi tidak menghasilkan frame, jadi animasi
mandek dan chart terlihat kosong. Pakai browser sungguhan.

---

## 10. Aturan main

1. **Satu aksen: lime.** Kalau butuh warna kedua, tanya dulu apakah itu meaning.
2. **Forest-deep untuk satu kartu saja** per layar.
3. **Rupiah selalu tabular, selalu `Rp`**, tidak pernah `$`.
4. **Copy bahasa Indonesia.** String Inggris berikutnya = bug.
5. **Tidak boleh truncate label** — button text tidak pernah jadi `Kelola`.
6. **Angka tidak pernah jadi Convention** — nominal harus rata kolom.
7. **Radius besar itu signature.** 24px card, jangan jadi 8px.
8. **Tidak ada angka palsu** — semua dari Supabase atau ditandai dummy.
9. **Setiap aksi kasir berbalas.** Tambah ke keranjang harus kelihatan — tanpa
   umpan balik, kasir tidak yakin menu yang diketuk sudah masuk.

---

## 11. Yang belum diputuskan

- [ ] Font display: Plus Jakarta Sans ataugeometric lain yang lebih bulat?
- [ ] Dark mode: perlu? (kalau POS dipakai malam, ya)
- [ ] Grafik: Recharts atau hand-rolled SVG?
- [ ] Mobile: sidebar jadi bottom bar atau drawer?
- [ ] Angka orange persisnya (perlu cek mata dari gambar)

Setelah lima hal di atas diputuskan, baru bangun komponen.
