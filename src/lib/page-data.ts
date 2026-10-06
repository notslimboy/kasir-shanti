/* ==========================================================================
   Tipe & data tetap.

   File ini SENGAJA tidak lagi berisi daftar dummy. Semua isi halaman
   diambil dari Supabase lewat lib/live.ts; kalau database tidak terbaca,
   halaman menampilkan keadaan kosong yang jujur — bukan angka contoh.

   Yang masih ada di sini hanya bentuk data dan dua daftar konfigurasi
   printer yang memang pengaturan, bukan hasil transaksi.
   ========================================================================== */

/* ============ PELANGGAN ============ */

export type Customer = {
  /** Dibentuk dari kolom id numerik: "c1902". */
  id: string;
  name: string;
  /** Tabel customers tidak punya kolom alamat; string kosong berarti tidak
      ada, bukan belum diisi. */
  address: string;
  /** Area atau franchise (ITS, GOJEK, Sutorejo) — bukan kategori. */
  tag: string | null;
  orderCount: number;
  total: number;
  lastOrder: string;
  deposit: number;
  /** Ongkir default — terisi otomatis di layar Kasir. */
  ongkir: number;
  note: string;
};

/* ============ PIUTANG ============
   Bentuk baris piutang beserta aturan hitungnya ada di lib/piutang.ts,
   bukan di sini: file ini untuk bentuk data perhalaman, sedangkan piutang
   dipakai halaman Piutang, KPI Beranda, dan penulisan pembayarannya. */

/* ============ KERANJANG & HOLD ============ */

/** "c1902" -> 1902. Id customer di UI sengaja diberi awalan "c" supaya
 *  tidak pernah sama dengan id struk atau id produk di daftar yang sama.
 *  Menulis ke server butuh id numerik aslinya, jadi konversi ini dijalankan
 *  di satu tempat — bukan `parseInt` yang disebar di tiap pemanggil.
 *
 *  Mengembalikan null kalau bukan bentuk "c<angka>". customer contoh dari
 *  `contoh-impor.ts` dan fixture E2E memakai id bebas, dan menuliskan id itu
 *  ke server akan menimpa baris yang salah. */
export function idNumerikCustomer(id: string): number | null {
  const cocok = /^c(\d+)$/.exec(String(id ?? ""));
  if (!cocok) return null;
  const angka = Number(cocok[1]);
  return Number.isSafeInteger(angka) ? angka : null;
}

export type CartItem = {
  id: string;
  name: string;
  variant: string;
  price: number;
  /** Varian priced "custom": kasir yang mengetik harganya. Selama price 0,
      harga belum diisi dan transaksi tidak boleh diselesaikan. */
  custom?: boolean;
  qty: number;
  /** null = tanpa batas stok. */
  stock: number | null;
  /** Permintaan pelanggan untuk baris ini saja — "tanpa sambel",
      "tanpa lontong". Satu catatan berlaku untuk seluruh qty baris ini.
      undefined = belum ada catatan; jangan diisi string kosong, karena
      kolom `note` di database dan cetakan struk membacanya sebagai
      "tidak ada". Lihat lib/catatan-item.ts. */
  note?: string;
};

export type HeldOrder = {
  id: string;
  label: string;
  customer: string;
  savedAt: string;
  items: CartItem[];
};

/* ============ KONFIGURASI PRINTER ============
   Ini pengaturan alat, bukan hasil transaksi, jadi tetap ada di sini. */

export const printerInfo = {
  nama: "EPSON TM-T82",
  koneksi: "Bluetooth",
  statusTerakhir: "29 Sep 2026, 14:20",
};

export const printerSteps = [
  {
    id: 1,
    title: "Hidupkan printer",
    body: "Pastikan lampu indikator menyala dan kertas sudah terpasang.",
  },
  {
    id: 2,
    title: "Pilih ukuran kertas",
    body: "58mm atau 80mm. Ukuran menentukan layout struk.",
  },
  {
    id: 3,
    title: "Uji koneksi",
    body: "Kirim struk uji untuk memastikan printer terhubung.",
  },
  {
    id: 4,
    title: "Atur kop toko",
    body: "Nama toko, alamat, dan nomor telepon akan tercetak di struk.",
  },
];
