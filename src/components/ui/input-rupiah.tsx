import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { formatRibuan, parseRibuan } from "@/lib/format";

/* ==========================================================================
   Input angka dengan pemisah ribuan.

   Dipakai untuk ongkir, diskon, dan harga custom. Angka rupiah yang diketik
   kasir punya lima sampai enam digit, dan "250000" tanpa pemisah tidak bisa
   dibaca cepat — salah baca satu nol berarti ongkir 10x lipat.

   Dua jebakan yang harus dijaga di sini:

   1. Kursor melompat ke ujung setiap kali titik pemisah ditambahkan. Kalau
      kasir mau mengganti digit di tengah "1.250.000", posisi kursor harus
      tetap sama. Posisi disimpan dalam hitungan DIGIT (bukan indeks
      karakter): satu titik tidak menambah digit, jadi indeks karakter
      bergeser.
   2. Nilai dari luar yang berubah (mis. pilih customer dengan ongkir
      15.000) tidak boleh ditimpa format ulang saat kasir masih mengetik di
      kotak yang sama. `sedangNgetik` jadi penandanya.
   ========================================================================== */

export type InputRupiahProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  value: number;
  onChange: (n: number) => void;
  /** Tampilkan "Rp" di dalam kotak. Default tidak — labelnya sudah menyebut
      nominal, jadi "Rp" hanya makan ruang. */
  prefix?: string;
};

/** Jumlah karakter non-digit sebelum posisi kursor. Dipakai sebagai "nomor
    urut digit" — format ulang hanya menambah titik, jadi hitungan ini
    stabil melewati akhir setiap titik. */
function digitSebelum(s: string, pos: number): number {
  return (s.slice(0, pos).match(/\d/g) ?? []).length;
}

/** Kebalikan dari `digitSebelum`: indeks karakter setelah digit ke-n. */
function posisiDariDigit(s: string, n: number): number {
  let seen = 0;
  for (let i = 0; i < s.length; i++) {
    if (/\d/.test(s[i]) && ++seen === n) return i + 1;
  }
  return s.length;
}

export function InputRupiah({ value, onChange, prefix = "", className = "", ...rest }: InputRupiahProps) {
  const [teks, setTeks] = useState(() => formatRibuan(value));
  const el = useRef<HTMLInputElement>(null);
  /* Digit ke- berapa kursor berada, atau null kalau tidak sedang mengetik. */
  const caret = useRef<number | null>(null);
  const sedangNgetik = useRef(false);

  useEffect(() => {
    if (sedangNgetik.current) {
      sedangNgetik.current = false;
      return;
    }
    setTeks(formatRibuan(value));
  }, [value]);

  /* Kursor dikembalikan setelah DOM menulis teks baru. useLayoutEffect,
     bukan requestAnimationFrame: gambar ulang dengan posisi kursor yang
     benar harus terjadi sebelum browser paint berikutnya, kalau tidak
     terlihat lompatan lebih dulu lalu lompat balik. */
  useLayoutEffect(() => {
    if (caret.current === null) return;
    const n = caret.current;
    caret.current = null;
    const pos = posisiDariDigit(teks, n);
    el.current?.setSelectionRange(pos, pos);
  }, [teks]);

  return (
    <span className="relative block">
      {prefix ? (
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground figure">
          {prefix}
        </span>
      ) : null}
      <input
        {...rest}
        ref={el}
        /* type="text" + inputMode="numeric": keyboard angka tetap muncul di
           HP, tapi browser tidak memaksa huruf "e" atau spinner panah yang
           tidak berguna untuk rupiah. */
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={teks}
        onChange={(e) => {
          const baru = e.target.value;
          caret.current = digitSebelum(baru, e.target.selectionStart ?? baru.length);
          const angka = parseRibuan(baru);
          sedangNgetik.current = true;
          setTeks(formatRibuan(angka));
          onChange(angka);
        }}
        className={
          "w-full rounded-xl border border-input bg-card text-right text-sm figure outline-none focus:border-ring " +
          (prefix ? "pl-8 " : "") +
          className
        }
      />
    </span>
  );
}