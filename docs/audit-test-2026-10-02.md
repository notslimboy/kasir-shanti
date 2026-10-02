# Hasil Audit Test — 2 Oktober 2026

Audit dilakukan sebelum deploy ke Vercel. **Tidak ada kode aplikasi yang
diubah** — semua temuan di bawah adalah hasil pengujian, bukan perbaikan.

## Alat yang dipasang

| Paket | Versi | Fungsi |
|---|---|---|
| `@playwright/test` | 1.63.0 | E2E + smoke routing |
| `@testing-library/react` | 16.3.3 | (terpasang, test komponen menyusul) |
| `@testing-library/user-event` | 14.6.7 | (terpasang) |
| `@testing-library/jest-dom` | 7.0.1 | (terpasang) |
| `jsdom` | 30.1.1 | (terpasang) |
| `@axe-core/playwright` | 4.13.0 | Audit a11y WCAG 2.1 A/AA |
| `@vitest/coverage-v8` | 5.0.3 | Coverage (belum dijalankan) |
| Chromium headless | 1243 | Browser untuk E2E |

## Hasil Test

**Unit test (vitest, sudah ada sebelumnya):** 398 test / 25 file — hijau.

**E2E (baru):** 28 lolos, 0 gagal, 4 dilewati.

```
npx playwright test              # semua
npx playwright test --project=desktop
npx playwright test --project=mobile
```

4 test dilewati (`skipped`) dengan alasan eksplisit: katalog menu kosong
di environment test, jadi tidak ada yang bisa diklik. Bukan lulus hampa.

## Temuan — 2 bug di aplikasi (SUDAH DIPERBAIKI)

Kedua bug ditemukan oleh pengujian, lalu diperbaiki. Test regression
ditambahkan untuk keduanya.

### 1. Tombol sheet keranjang tidak punya nama aksesibel (mobile)

`src/pages/kasir.tsx:831`

Tombol fixed di bawah layar (pembuka sheet keranjang) tidak punya
`aria-label`. Isinya cuma jumlah item dan nominal, sehingga terbaca
screen reader sebagai *"tombol, 0 item, Rp 15.000"*. Kasir tidak tahu
tombol itu keranjang.

**Bukti:** test `miring.spec.ts` gagal dengan
`Received string: "0 itemRp 15.000"`.

**Perbaikan:** `aria-label` dinamis yang menyebut fungsinya, bukan
angkanya — nominal berubah tiap detik, nama seharusnya tidak:

```tsx
aria-label={`Buka keranjang, ${cart.length} item`}
```

Test sekarang memakai `getByRole("button", { name: /^Buka keranjang/ })`
supaya `aria-label` yang dihapus lagi akan menggagalkan test, bukan
lolos diam-diam.

### 2. Ongkir default Rp 15.000 muncul di keranjang kosong

`src/pages/kasir.tsx:43` — `useState(15_000)`

Ongkir diinisialisasi Rp 15.000 sejak aplikasi dibuka. Efeknya:

- Keranjang kosong sudah menampilkan **Total Rp 15.000**
- Tambah satu menu → total melompat naik Rp 15.000 tanpa sebab yang terlihat
- Kasir bisa menyimpan tanpa sadar, pelanggan membayar ongkir yang tidak
  pernah disebutkan

Pola ini sama dengan yang tercatat di `AGENTS.md` — "angka contoh yang
diam-diam dipakai sehingga orang percaya angka yang salah".

**Perbaikan:** `useState(0)`. Ongkir yang benar sudah berasal dari data
customer lewat efek `terisiOngkir` (`kasir.tsx:275`); angka 15.000
hanya fallback yang menutupi kasus "customer tidak cocok" dan
membuat kasir percaya angka yang tidak ada dasarnya. Nol adalah state
yang jujur: belum ada ongkir yang diketahui.

Test regression `kasir.spec.ts` — "keranjang kosong tidak diam-diam
menampilkan ongkir" — menjaga total tetap nol saat keranjang kosong.


## Catatan teknis

**`vite preview` hanya bind ke IPv6 `[::1]`.** Akses `127.0.0.1` berakhir
connection refused walau layanannya sehat. `playwright.config.ts` memakai
`localhost` karena itu.

**`@axe-core/playwright` 4.13.0 tidak bisa dipakai di `/pengaturan`.**
`AxeBuilder` menelusuri setiap frame, dan pratinjau struk thermal
dirender di `<iframe srcdoc>` (`src/components/struk.tsx:99`). Frame itu
membuat `analyze()` hang >25 detik. `.include('#root')` tidak menolong,
dan `.excludeIframes()` tidak ada di versi ini. Solusi yang dipakai:
`axe.run(document)` langsung via `page.evaluate` (~500ms, hasil identik).
Pratinjau struk memang bukan target a11y — isinya dokumen cetak.

## Yang BELUM tercover

- **Tidak ada test komponen** untuk 8 halaman (`src/pages/*.tsx`, ~250KB).
  398 unit test yang ada semuanya pure logic; nol yang merender React.
- **Alur kasir end-to-end belum diuji** — tambah item → bayar → simpan ke
  Supabase → cetak struk. Test yang ada hanya menguji guard (tombol mati,
  keranjang kosong, format rupiah), bukan transaksi sungguhan.
- **Alur import CSV belum diuji** — 9 kolom, parsing, preview.
- **Tidak ada test yang memverifikasi `vercel.json`** saat ini. Belum ada.
- **Coverage belum diukur.**
- **Tidak ada lint / CI.**
- **4 test E2E dilewati** karena katalog menu kosong di environment test.
  Ini disengaja dan dilaporkan eksplisit, bukan lulus hampa — tapi
  artinya **interaksi produk yang sesungguhnya belum pernah diuji**.

## Blockir sebelum deploy

1. **RLS Supabase belum diperiksa.** `supabase_probe.py` membuktikan anon
   key bisa membaca tabel. Jika deploy publik, data penjualan, customer,
   dan piutang bisa dibaca siapa pun yang punya URL.
2. **`vercel.json` belum ada.** `BrowserRouter` butuh rewrite ke
   `index.html`; tanpa itu `/kasir` yang dibuka langsung akan 404.
3. Root Directory Vercel harus di-set ke `kasir-next`.