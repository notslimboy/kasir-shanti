import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/* ==========================================================================
   State yang bertahan saat pindah halaman.

   Halaman Import Pesanan punya prosesnya sendiri: tempel CSV → periksa satu
   per satu → isi harga yang bolong → proses. Kalau kasir perlu buka
   Dashboard Penjualan untuk melihat struk yang baru saja dibuat, lalu
   kembali, draft yang sudah setengah jadi HARUS masih ada di sana.

   Kenapa sessionStorage, bukan modul-level state:
   - modul-level hilang begitu halaman di-refresh, dan draft yang sudah
     cape-cape diketik harga tidak boleh hilang karena F5
   - sessionStorage ikut hilang saat tab ditutup, jadi sesi berikutnya mulai
     dari nol — persis yang diinginkan: impor yang belum selesai bukan sisa
     pekerjaan shift kemarin
   - isinya bukan data baru: CSV-nya sudah ada di textarea halaman itu,
     dan draftnya juga sudah ada di memori selama halaman tidak ditutup

   Penulisan ditunda 300 ms: mengetik di textarea memunculkan satu state
   baru per ketikan, dan sessionStorage adalah penyimpanan sinkron yang
   ditulis ke disk. Tanpa penundaan, mengetik satu baris CSV cukup untuk
   membuat halaman terasa berat.
   ========================================================================== */

const KUNCI = "kasir.simpan.";
const TUNDA_MS = 300;

function baca<T>(kunci: string, awal: T, pulih?: (v: unknown) => T): T {
  if (typeof sessionStorage === "undefined") return awal;
  try {
    const mentah = sessionStorage.getItem(KUNCI + kunci);
    if (mentah === null) return awal;
    const nilai: unknown = JSON.parse(mentah);
    return pulih ? pulih(nilai) : (nilai as T);
  } catch {
    /* Data rusak atau tidak bisa dibaca — mulai dari awal lebih aman
       daripada menampilkan draft setengah jadi tanpa jejak. */
    return awal;
  }
}

export function useStatePersisten<T>(
  kunci: string,
  awal: T,
  pulih?: (v: unknown) => T,
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const [nilai, setNilai] = useState<T>(() => baca(kunci, awal, pulih));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nilaiTerakhir = useRef(nilai);
  nilaiTerakhir.current = nilai;

  /* Timer ditulis ulang tiap perubahan; `timer` yang sudah ada dibatalkan
     supaya hanya penulisan terakhir yang sampai ke storage. */
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        sessionStorage.setItem(KUNCI + kunci, JSON.stringify(nilaiTerakhir.current));
      } catch {
        /* Kuota penuh atau storage dinonaktifkan: state tetap jalan di
           memori, draft hanya tidak bertahan saat pindah halaman. */
      }
    }, TUNDA_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [kunci, nilai]);

  const hapus = useCallback(() => {
    try {
      sessionStorage.removeItem(KUNCI + kunci);
    } catch {
      // diam-diam: tidak ada yang bisa dilakukan kalau storage tidak bisa ditulis
    }
    setNilai(awal);
  }, [kunci, awal]);

  return [nilai, setNilai, hapus];
}