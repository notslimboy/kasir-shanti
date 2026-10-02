import { useSyncExternalStore } from "react";

import { PRINTER_DEFAULT, STRUK_DEFAULT, type SetelanStruk } from "./struk";

/* ==========================================================================
   Pengaturan printer & toko, disimpan di perangkat.

   Kenapa perlu store sendiri: halaman Kasir harus tahu apakah struk
   langsung dicetak atau tidak, sementara Pengaturan yang menyimpan
   nilainya. Kalau nilainya hidup di state lokal komponen, Kasir tidak
   akan pernah tahu auto print sudah dimatikan — struk tetap keluar
   printer padahal kasir sudah memilih tidak mencetak.

   Isinya kecil (ratusan byte), jadi localStorage cukup. Cache data yang
   besar tetap di IndexedDB.
   ========================================================================== */

export type SetelanApp = SetelanStruk & {
  /** Struk langsung dicetak begitu pembayaran selesai. */
  autoPrint: boolean;
  /** "direct" = langsung cetak; "preview" = tampil struk dulu. */
  printFlow: "direct" | "preview";
};

export const SETELAN_AWAL: SetelanApp = {
  ...STRUK_DEFAULT,
  autoPrint: PRINTER_DEFAULT.autoPrint,
  printFlow: PRINTER_DEFAULT.printFlow as "direct" | "preview",
};

const KUNCI = "kasir-setelan-struk";

function baca(): SetelanApp {
  if (typeof localStorage === "undefined") return SETELAN_AWAL;
  try {
    const mentah = localStorage.getItem(KUNCI);
    if (!mentah) return SETELAN_AWAL;
    const simpan = JSON.parse(mentah) as Partial<SetelanApp>;
    /* Ditimpa default satu per satu: kalau ada field baru di SetelanApp,
       file lama tidak boleh membuat aplikasi crash atau diam-diam memakai
       setelan setengah jadi. */
    return { ...SETELAN_AWAL, ...simpan };
  } catch {
    return SETELAN_AWAL;
  }
}

let sekarang: SetelanApp = baca();
const pendengar = new Set<() => void>();

export function ambilSetelan(): SetelanApp {
  return sekarang;
}

export function simpanSetelan(ubah: Partial<SetelanApp>): SetelanApp {
  sekarang = { ...sekarang, ...ubah };
  try {
    localStorage.setItem(KUNCI, JSON.stringify(sekarang));
  } catch {
    /* Kuota penuh atau mode privat: setelan tetap berlaku di sesi ini. */
  }
  pendengar.forEach((p) => p());
  return sekarang;
}

function dengar(callback: () => void): () => void {
  pendengar.add(callback);
  return () => {
    pendengar.delete(callback);
  };
}

/** Setelan aplikasi + cara mengubahnya, untuk dipakai di mana saja. */
export function useSetelan(): [SetelanApp, (ubah: Partial<SetelanApp>) => void] {
  const nilai = useSyncExternalStore(dengar, ambilSetelan, ambilSetelan);
  return [nilai, simpanSetelan];
}