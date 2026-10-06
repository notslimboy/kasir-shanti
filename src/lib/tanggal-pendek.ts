/* ==========================================================================
   Tanggal pendek Indonesia -> Date.

   `labelTanggalPendek` di live-mappers.ts mengubah ISO jadi "4 Juli 2026".
   String itu enak dibaca tapi TIDAK bisa diurutkan: `Date.parse` di V8
   tidak mengenal nama bulan Indonesia, jadi hasilnya NaN, dan
   `localeCompare` akan membandingkan karakter — "4 Juli" selalu mendahului
   "30 September" karena "4" < "3" salah arah.

   Modul ini adalah kebalikannya: mengubah kembali "4 Juli 2026" jadi Date
   supaya kolom "Order Terakhir" bisa diurutkan dengan benar.

   Sengaja modul terpisah, bukan disisipkan ke live-mappers.ts: daftar bulan
   di sana hidup berdampingan dengan `labelTanggalPendek`, dan satu file
   tidak boleh punya dua arah konversi yang bisa sudah tidak sinkron.
   ========================================================================== */

/* Sama persis dengan BULAN di live-mappers.ts. Kalau satu daftar bulan
   berubah, yang ini harus ikut — keduanya harus menghasilkan output yang sama. */
const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** Tanda untuk "tidak ada order", bukan tanggal. */
const TANPA_TANGGAL = "—";

/**
 * "4 Juli 2026" -> Date. Juggal bentuk yang pakai jam — "4 Juli 2026, 14:01" —
 * tetap terbaca, jamnya diabaikan karena yang diurutkan adalah tanggalnya.
 *
 * Mengembalikan null untuk "—", string kosong, atau bentuk yang tidak
 * dikenali. null penting: `urutkan` di components/ui/sortable-table.tsx
 * melempar null ke ekor daftar secara terpisah dari arah, jadi baris tanpa
 * tanggal tidak pernah menduduki posisi pertama saat urutan naik.
 */
export function tanggalPendekKeWaktu(text: string | null | undefined): Date | null {
  const s = String(text ?? "").trim();
  if (!s || s === TANPA_TANGGAL) return null;

  const cocok = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(s);
  if (!cocok) return null;

  const bulan = BULAN.findIndex((b) => b.toLowerCase() === cocok[2].toLowerCase());
  if (bulan < 0) return null;

  const tanggal = new Date(Number(cocok[3]), bulan, Number(cocok[1]));
  return Number.isNaN(tanggal.getTime()) ? null : tanggal;
}