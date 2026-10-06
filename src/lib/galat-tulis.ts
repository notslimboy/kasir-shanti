/* ==========================================================================
   Error server -> kalimat yang bisa ditindaklanjuti kasir.

   PostgREST menjawab kegagalan dengan jargon Postgres yang tidak berguna
   bagi orang yang mengetik di kasir:

     409 · 23505 · duplicate key value violates unique constraint
           "customers_name_key"

   Kasir tidak bisa melakukan apa-apa dari kalimat itu. Yang dibutuhkan
   justru dua hal: apa yang terjadi, dan apa yang harus diketik berikutnya.
   Jadi setiap error dipetakan jadi tiga bagian — judul, penjelasan,
   langkah — dan detail teknisnya disimpan terpisah supaya tetap ada untuk
   whoever-reader developer tanpa ikut mengganggu layar kasir.

   Aturan penulisan di sini:
     - Bahasa Indonesia, tanpa singkatan funky, tanpa "RLS", "policy",
       "constraint", atau "row-level security".
     - Tidak pernah menyalahkan kasir ("input salah"). sometimes ada yang
       perlu diperbaiki dari sisi server, dan itu bukan salah kasir.
     - Selalu menyebut tindakan berikutnya. Error tanpa langkah hanya
       membuat orang menebak.
     - Panjang satu-dua kalimat. Di footer drawer yang sempit, paragraf
       ketiga akan terpotong.

   Pelajaran yang pertama cocok menang, jadi urutan entri di bawah
   adalah urutan prioritas, bukan urutan kebetulan.
   ========================================================================== */

export type GalatTulis = {
  /** Satu frasa yang menunjuk masalahnya. */
  judul: string;
  /** Kenapa itu terjadi, dalam bahasa orang biasa. */
  penjelasan: string;
  /** Apa yang harus diketik atau hive langkah berikutnya. */
  langkah: string;
  /** Kode dan pesan asli dari server. Untuk developer, bukan untuk kasir. */
  teknis?: string;
};

type Pelajaran = {
  cocok: (status: number, body: unknown) => boolean;
  buat: (nama: string) => Omit<GalatTulis, "teknis">;
};

/** Nama yang bentrok, dipotong supaya pesan tidak jadi paragraf. */
function namaPendek(nama: string): string {
  const s = String(nama ?? "").trim();
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

const PELAJARAN: Pelajaran[] = [
  {
    /* 23505 paling sering di aplikasi ini: kolom `customers.name` punya
       constraint UNIQUE, jadi dua customer tidak boleh bernama sama. Ini
       yang terjadi saat nama hasil diperbaiki sudah dipakai customer
       lain — bukan salah ketik. */
    cocok: (status, body) =>
      status === 409 ||
      (typeof body === "object" && body !== null && (body as { code?: string }).code === "23505"),
    buat: (nama) => ({
      judul: "Nama itu sudah dipakai",
      penjelasan: `Sudah ada customer lain bernama "${namaPendek(nama)}". Di sistem ini dua customer tidak boleh punya nama yang sama.`,
      langkah: "Coba nama lain, atau buka customer yang sudah ada itu lalu ubah datanya di sana.",
    }),
  },
  {
    /* 42501: RLS belum di pasang */
    cocok: (status, body) =>
      status === 403 ||
      (typeof body === "object" && body !== null && (body as { code?: string }).code === "42501"),
    buat: () => ({
      judul: "Akun ini belum boleh mengubah data",
      penjelasan:
        "Server menolak karena aturan izin untuk data customer belum dijalankan di database.",
      langkah: "Hubungi pemilik aplikasi supaya izinnya dibetulkan. Data lu belum tersimpan.",
    }),
  },
  {
    cocok: (status) => status === 401,
    buat: () => ({
      judul: "Sesi login sudah habis",
      penjelasan: "Kamu perlu masuk ulang sebelum bisa menyimpan.",
      langkah: "Tutup jendela ini, masuk lagi, lalu tekan Simpan sekali lagi.",
    }),
  },
  {
    cocok: (status) => status === 404,
    buat: () => ({
      judul: "Customer tidak ditemukan",
      penjelasan:
        "Baris ini sudah tidak ada di server — mungkin sudah dihapus atau diganti dari tab lain.",
      langkah: "Muat ulang halaman, lalu buka lagi customer-nya.",
    }),
  },
  {
    /* 400 / 42xxx: bentuk datanya tidak dibaca. 42703 artinya kolom yang
       dikirim tidak ada di database. */
    cocok: (status, body) =>
      status === 400 ||
      (typeof body === "object" &&
        body !== null &&
        ["42703", "PGRST204"].includes((body as { code?: string }).code ?? "")),
    buat: () => ({
      judul: "Server tidak membaca data ini",
      penjelasan: "Ada bagian dari data customer yang tidak dikenali oleh server.",
      langkah: "Hubungi pemilik aplikasi. Data lu belum tersimpan.",
    }),
  },
  {
    cocok: (status) => status >= 500,
    buat: () => ({
      judul: "Server sedang bermasalah",
      penjelasan: "Server tidak bisa menjawab permintaan ini. Data lu belum tersimpan.",
      langkah: "Coba beberapa saat lagi. Kalau tetap gagal, hubungi pemilik aplikasi.",
    }),
  },
];

const CADANGAN: GalatTulis = {
  judul: "Gagal menyimpan",
  penjelasan: "Server menolak menyimpan perubahan ini. Data lu belum tersimpan.",
  langkah: "Coba lagi. Kalau tetap gagal, hubungi pemilik aplikasi.",
};

/** Ringkas kode + pesan + hint dari server jadi satu baris. */
export function ringkasTeknis(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const b = body as { code?: string; message?: string; hint?: string; details?: string };
  const bagian = [b.code, b.message, b.hint ?? b.details].filter(Boolean);
  return bagian.length ? bagian.join(" · ") : undefined;
}

/**
 * Ubah response PostgREST yang gagal menjadi kalimat yang bisa dibaca.
 *
 * `nama` dipakai untuk menyebut nama yang bentrok — tanpa itu, kasir hanya
 * tahu "nama itu sudah dipakai" tanpa tahu yang mana.
 */
export function jelaskanGalatTulis(
  status: number,
  body: unknown,
  nama: string,
): GalatTulis {
  const pelajaran = PELAJARAN.find((p) => p.cocok(status, body));
  const dasar = pelajaran ? pelajaran.buat(nama) : CADANGAN;
  const teknis = ringkasTeknis(body);
  return { ...dasar, ...(teknis ? { teknis: `${status} · ${teknis}` } : {}) };
}

/** Galat yang bentuknya sudah diketahui — misal validasi lokal, sebelum
 *  request dikirim. Tidak ada `teknis` karena tidak ada server yang bicara. */
export function galatValidasi(pesan: string): GalatTulis {
  return { judul: "Belum bisa disimpan", penjelasan: pesan, langkah: "Perbaiki dulu, lalu coba lagi." };
}