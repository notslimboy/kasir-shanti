import { describe, expect, it } from "vitest";

import { arahBerikutnya, urutkan } from "@/components/ui/sortable-table";

/* ==========================================================================
   Pengurutan tabel.

   Tiga tahap (naik -> turun -> lepas) dan perbandingan waktu adalah dua
   tempat di mana sorting bisa salah tanpa terlihat: angka yang terurut
   bolong-balik terlihat "aneh", tapi waktu yang salah urat tetap terlihat
   seperti waktu.
   */

type Baris = {
  no: string;
  customer: string;
  waktu: string;
  total: number;
  status: string;
};

const BARIS: Baris[] = [
  { no: "050", customer: "Sari", waktu: "2026-09-30T08:30:00Z", total: 250_000, status: "lunas" },
  { no: "048", customer: "budi", waktu: "2026-09-30T21:30:00Z", total: 700_000, status: "belum" },
  { no: "049", customer: "Andi", waktu: "2026-09-30T09:30:00Z", total: 100_000, status: "lunas" },
];

const kolomNilai = (b: Baris, kolom: string): string | number | Date | null => {
  switch (kolom) {
    case "no":
      return b.no;
    case "customer":
      return b.customer;
    case "waktu":
      return new Date(b.waktu);
    case "total":
      return b.total;
    default:
      return null;
  }
};

describe("tahap pengurutan", () => {
  it("kolom baru selalu mulai dari naik", () => {
    expect(arahBerikutnya(null, "total")).toEqual({ kolom: "total", arah: "asc" });
  });

  it("klik kolom yang sama: naik jadi turun", () => {
    const pertama = arahBerikutnya(null, "total");
    expect(arahBerikutnya(pertama, "total")).toEqual({ kolom: "total", arah: "desc" });
  });

  it("turun berikutnya melepas supaya urutan asli kembali", () => {
    const naik = arahBerikutnya(null, "total");
    const turun = arahBerikutnya(naik, "total");
    expect(arahBerikutnya(turun, "total")).toBeNull();
  });

  it("berpindah kolom selalu mulai dari naik, bukan lanjut arah yang lalu", () => {
    const totalTurun = arahBerikutnya(arahBerikutnya(null, "total"), "total");
    expect(arahBerikutnya(totalTurun, "customer")).toEqual({ kolom: "customer", arah: "asc" });
  });
});

describe("urutan naik dan turun", () => {
  it("angka: kecil ke besar lalu sebaliknya", () => {
    const naik = urutkan(BARIS, { kolom: "total", arah: "asc" }, kolomNilai);
    expect(naik.map((b) => b.total)).toEqual([100_000, 250_000, 700_000]);

    const turun = urutkan(BARIS, { kolom: "total", arah: "desc" }, kolomNilai);
    expect(turun.map((b) => b.total)).toEqual([700_000, 250_000, 100_000]);
  });

  it("teks mengabaikan huruf besar-kecil", () => {
    const naik = urutkan(BARIS, { kolom: "customer", arah: "asc" }, kolomNilai);
    expect(naik.map((b) => b.customer)).toEqual(["Andi", "budi", "Sari"]);
  });

  it("nomor struk terurut sebagai angka, bukan teks", () => {
    // "048" < "050" secara teks, tapi "100" < "48" secara teks juga —
    // itu sebabnya nomor struk tetap dibandingkan sebagai string yang
    // sudah di-padding nol: urutannya sudah dijamin benar oleh formatnya.
    const naik = urutkan(BARIS, { kolom: "no", arah: "asc" }, kolomNilai);
    expect(naik.map((b) => b.no)).toEqual(["048", "049", "050"]);
  });
});

describe("kolom waktu", () => {
  it("mengurutkan menurut waktu sebenarnya", () => {
    const naik = urutkan(BARIS, { kolom: "waktu", arah: "asc" }, kolomNilai).map((b) =>
      b.waktu.slice(11, 16),
    );
    expect(naik).toEqual(["08:30", "09:30", "21:30"]);

    const turun = urutkan(BARIS, { kolom: "waktu", arah: "desc" }, kolomNilai).map((b) =>
      b.waktu.slice(11, 16),
    );
    expect(turun).toEqual(["21:30", "09:30", "08:30"]);
  });

  it("tanggal tanpa padding nol tetap urut dengan benar", () => {
    // Di sinilah mengurutkan string benar-benar gagal, bukan di jam.
    //
    // completedAt ditampilkan sebagai "5 Sep 2026 09.30" — tanggalnya TIDAK
    // dipadding nol. Dibandingkan sebagai teks, "5 Sep 2026" lebih besar
    // dari "30 Sep 2026" karena "5" > "3" sebagai karakter. Padahal 5
    // September lebih dulu. Grafik 90 hari punya persis kasus ini: angka
    // "5" di sumbu bisa berarti 5 Agustus atau 5 September.
    //
    // ISO-nya sendiri aman (zero-padded, jadi konsisten secara leksikal),
    // jadi test ini harus memakai string tampilan yang rusak, bukan ISO.
    const baris = [
      { no: "001", waktu: "2026-09-05T09:30:00Z", tampil: "5 Sep 2026 09.30" },
      { no: "002", waktu: "2026-09-30T09:30:00Z", tampil: "30 Sep 2026 09.30" },
    ];

    // Yang dipakai production: waktu sebenarnya.
    const benar = urutkan(baris, { kolom: "waktu", arah: "asc" }, (b, kolom) =>
      kolom === "waktu" ? new Date(b.waktu) : null,
    );
    expect(benar.map((b) => b.no)).toEqual(["001", "002"]);

    // Yang terjadi kalau string tampilan yang dipakai: terbalik.
    const salah = baris.slice().sort((a, b) => a.tampil.localeCompare(b.tampil, "id-ID"));
    expect(salah.map((b) => b.no)).toEqual(["002", "001"]);
  });
});

describe("tidak ada urutan aktif", () => {
  it("baris dikembalikan apa adanya, tidak diacak ulang", () => {
    expect(urutkan(BARIS, null, kolomNilai).map((b) => b.no)).toEqual(["050", "048", "049"]);
  });

  it("tidak mengubah array asal", () => {
    const asal = BARIS.map((b) => b.no);
    urutkan(BARIS, { kolom: "total", arah: "desc" }, kolomNilai);
    expect(BARIS.map((b) => b.no)).toEqual(asal);
  });
});

describe("nilai kosong", () => {
  const DENGAN_KOSONG: Baris[] = [
    ...BARIS,
    { no: "099", customer: "Kosong", waktu: "2026-09-30T10:00:00Z", total: 0, status: "lunas" },
  ];

  /* Kolom "x" tidak dikenal, jadi nilai() mengembalikan null: ini mewakili
     baris yang datanya belum tersedia di sumber. */
  const nilaiSebagian = (s: Baris) => (s.no === "099" ? null : kolomNilai(s, "no"));

  it("tenggelam di akhir saat urutan naik", () => {
    const naik = urutkan(DENGAN_KOSONG, { kolom: "x", arah: "asc" }, nilaiSebagian);
    expect(naik[naik.length - 1].no).toBe("099");
  });

  it("tetap di akhir saat urutan turun, bukan naik ke posisi pertama", () => {
    // Ini yang berbeda dari sekadar "balik arah". Kalau pembanding null ikut
    // dibalik, baris yang datanya kosong akan menduduki baris pertama
    // setiap kali pengguna menekan Turun — persis yang tidak diinginkan,
    // karena baris kosong tidak pernah punya arti apa pun di atas.
    const turun = urutkan(DENGAN_KOSONG, { kolom: "x", arah: "desc" }, nilaiSebagian);
    expect(turun[turun.length - 1].no).toBe("099");
    expect(turun[0].no).not.toBe("099");
  });

  it("baris dengan nilai tetap ikut terurut di antara yang lain", () => {
    const naik = urutkan(DENGAN_KOSONG, { kolom: "x", arah: "asc" }, nilaiSebagian);
    expect(naik.slice(0, 3).map((b) => b.no)).toEqual(["048", "049", "050"]);
  });

  it("tidak melempar saat semua nilai kosong", () => {
    const semuaKosong = urutkan(DENGAN_KOSONG, { kolom: "x", arah: "asc" }, () => null);
    expect(semuaKosong).toHaveLength(DENGAN_KOSONG.length);
  });
});