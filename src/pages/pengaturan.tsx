import { useRef } from "react";
import { motion } from "motion/react";

import { printerInfo } from "@/lib/page-data";
import { Card, Pill } from "@/components/ui/card";
import { Toast, useToast } from "@/components/ui/toast";
import { Struk, strukContoh, type StrukHandle } from "@/components/struk";
import { PageHeader, Field, StatTile, btnGhost, btnPrimary, inputClass } from "@/components/ui/kit";
import { PRINTER_DEFAULT, lebarCetakMm, logoStruk, type LebarStruk } from "@/lib/struk";
import { useSetelan } from "@/lib/setelan";
import { bacaFile, pulihkanBackup, unduhBackup, type HasilRestore } from "@/lib/backup";

/* ==========================================================================
   Pengaturan — fokus pada printer thermal, karena itu yang bikin kasir
   berhenti jalan.

   Dua kartu berdampingan: setup di kiri, pratinjau struk di kanan.
   Pratinjau sengaja memakai modul struk yang sama dengan hasil cetak, jadi
   apa yang terlihat di sini persis yang keluar dari printer.

   Nilai bawaan (58mm, "Shanti Catering", "BHASKARA III / 38") disalin dari
   aplikasi lama, bukan dikarang.
   ========================================================================== */

export function PengaturanPage() {
  /* Setelan disimpan di perangkat, bukan di state komponen: halaman Kasir
     juga membacanya, jadi nilai auto print harus kelihatan di kedua
     tempat. */
  const [setelan, ubahSetelan] = useSetelan();
  const strukRef = useRef<StrukHandle>(null);
  const [catatan, setCatatan] = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  /* Restore selalu diikuti muat ulang. Alasannya bukan sekadar "agar
     terpasang": setiap halaman menyimpan data sendiri di state React, jadi
     menulis IndexedDB di belakang layar tidak mengubah apa pun yang sudah
     tampil. Muat ulang adalah satu-satunya cara yang jujur. Dan begitu
     halaman terbuka, request ke Supabase langsung berjalan — jadi restore
     tidak pernah menjadi sumber kebenaran yang lebih basi dari server. */
  const restore = async (file: File) => {
    let hasil: HasilRestore;
    try {
      hasil = await pulihkanBackup(await bacaFile(file));
    } catch (e) {
      setCatatan({ tone: "warn", text: `Restore gagal: ${(e as Error).message}` });
      return;
    }
    if (!hasil.ok) {
      setCatatan({ tone: "warn", text: hasil.pesan });
      return;
    }
    setCatatan({ tone: "ok", text: "Backup dipulihkan. Muat ulang halaman…" });
    setTimeout(() => window.location.reload(), 900);
  };

  const ubah = <K extends keyof typeof setelan>(kunci: K, nilai: (typeof setelan)[K]) =>
    ubahSetelan({ [kunci]: nilai } as Partial<typeof setelan>);

  return (
    <div>
      <PageHeader
        title="Pengaturan"
        sub="Setup printer thermal, toko, dan database."
        action={<button className={btnPrimary}>Simpan Pengaturan</button>}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* ---------------- SETUP PRINTER ---------------- */}
        <Card
          title="Setup Printer Thermal"
          action={<Pill tone="success">Terhubung</Pill>}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Printer" value={printerInfo.nama} />
            <StatTile label="Kertas" value={`${setelan.receiptWidth} mm`} />
            <StatTile label="Area Cetak" value={`${lebarCetakMm(setelan.receiptWidth)} mm`} />
          </div>

          {/* Satu kolom. Kolom kedua dulu dipakai untuk "Checklist" langkah
              printer — daftar yang isinya cuma panduan pakai, bukan
              pengaturan: setiap langkahnya sudah punya tempatnya sendiri di
              form di atas (ukuran kertas, kop toko, test cetak). Yang
              tersisa tinggal kotak "Pengaturan printer", jadi memecah
              layout dua kolom hanya menyisakan ruang kosong. */}
          <div className="mt-4">
            <div className="space-y-3">
              <Field
                label="Ukuran Kertas"
                hint="Bawaan aplikasi lama 58mm. 80mm memakai area cetak 72mm."
              >
                <div className="grid grid-cols-2 gap-2">
                  {(["58", "80"] as LebarStruk[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => ubah("receiptWidth", k)}
                      className={
                        "h-11 rounded-xl border text-sm font-semibold transition-colors " +
                        (setelan.receiptWidth === k
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-card text-muted-foreground")
                      }
                    >
                      {k} mm
                    </button>
                  ))}
                </div>
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nama Toko" hint="Tercetak di atas struk.">
                  <input
                    value={setelan.storeName}
                    onChange={(e) => ubah("storeName", e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Alamat Toko" hint="Dicetak di bawah nama toko.">
                  <input
                    value={setelan.storeAddress}
                    onChange={(e) => ubah("storeAddress", e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Ukuran Huruf">
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["small", "medium", "large"] as const).map((k) => (
                      <button
                        key={k}
                        onClick={() => ubah("receiptFontSize", k)}
                        className={
                          "h-9 rounded-lg border text-xs font-semibold capitalize transition-colors " +
                          (setelan.receiptFontSize === k
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-card text-muted-foreground")
                        }
                      >
                        {k === "small" ? "Kecil" : k === "medium" ? "Sedang" : "Besar"}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Tampilan Struk">
                  <div className="grid grid-cols-2 gap-1.5">
                    {(["complete", "compact"] as const).map((k) => (
                      <button
                        key={k}
                        onClick={() => ubah("receiptMode", k)}
                        className={
                          "h-9 rounded-lg border text-xs font-semibold transition-colors " +
                          (setelan.receiptMode === k
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-card text-muted-foreground")
                        }
                      >
                        {k === "complete" ? "Lengkap" : "Ringkas"}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>

              <Field label="Footer Struk" hint="Dicetak paling bawah.">
                <input
                  value={setelan.footer}
                  onChange={(e) => ubah("footer", e.target.value)}
                  className={inputClass + " figure"}
                />
              </Field>

              <label className="flex items-center justify-between rounded-2xl border border-input bg-card p-4">
                <div>
                  <div className="text-sm font-semibold">Cetak otomatis setelah bayar</div>
                  <div className="text-xs text-muted-foreground">
                    Struk langsung keluar tanpa klik tambahan.
                  </div>
                </div>
                <button
                  onClick={() => ubahSetelan({ autoPrint: !setelan.autoPrint })}
                  className={
                    "relative h-6 w-11 shrink-0 rounded-full transition-colors " +
                    (setelan.autoPrint ? "bg-primary" : "bg-muted")
                  }
                  aria-pressed={setelan.autoPrint}
                >
                  <motion.span
                    layout
                    transition={{ type: "spring", stiffness: 500, damping: 32 }}
                    className={
                      "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow " +
                      (setelan.autoPrint ? "right-0.5" : "left-0.5")
                    }
                  />
                </button>
              </label>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={() => strukRef.current?.cetak()}
                  className={btnGhost}
                >
                  Cetak Struk Contoh
                </button>
                <button className={btnPrimary}>Test Cetak</button>
              </div>
              <p className="text-xs text-muted-foreground">
                Terakhir diuji: {printerInfo.statusTerakhir}
              </p>

              <div className="rounded-2xl bg-muted px-4 py-3 text-xs text-muted-foreground">
                <div className="font-semibold text-foreground">Pengaturan printer</div>
                <div className="mt-1 space-y-0.5">
                  <div>Bahasa instruksi: {PRINTER_DEFAULT.language}</div>
                  <div>
                    Potong kertas:{" "}
                    {PRINTER_DEFAULT.cut === "partial" ? "sebagian" : PRINTER_DEFAULT.cut}
                  </div>
                  <div>Feed setelah cetak: {PRINTER_DEFAULT.feedLines} baris</div>
                  <div>Transport: {PRINTER_DEFAULT.nativePrinterTransport}</div>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* ---------------- PRATINJAU STRUK ---------------- */}
        <Card
          title="Pratinjau Struk"
          action={<Pill>{setelan.receiptWidth}mm</Pill>}
        >
          <p className="mb-3 text-xs text-muted-foreground">
            Bentuk ini sama dengan hasil cetak. Logo, urutan baris, dan lebar
            kertas mengikuti aplikasi lama.
          </p>

          <div className="overflow-x-auto rounded-2xl bg-muted/60 p-3">
            {/* Pratinjau memakai satuan mm sungguhan, bukan diperkecil supaya
                muat. Kalau dikecilkan, baris harga terlihat rapi di layar
                padahal yang keluar dari printer sempit dan bertabrakan. */}
            <div
              className="mx-auto overflow-hidden rounded-lg bg-white shadow-card"
              style={{ width: `${lebarCetakMm(setelan.receiptWidth)}mm` }}
            >
              <Struk ref={strukRef} data={strukContoh()} setelan={setelan} />
            </div>
          </div>

          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <span>Logo</span>
              <span className="truncate font-mono text-[11px] text-foreground">
                {logoStruk(setelan.receiptWidth).split("/").pop()}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Area cetak</span>
              <span className="figure">{lebarCetakMm(setelan.receiptWidth)} mm</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Huruf</span>
              <span className="capitalize">{setelan.receiptFontSize}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* ---------------- DATABASE ---------------- */}
      <Card className="mt-4" title="Database & Backup">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex items-center justify-between rounded-2xl border border-input bg-card p-4">
            <div>
              <div className="text-sm font-semibold">Supabase</div>
              <div className="text-xs text-muted-foreground">Sumber data kasir dan laporan</div>
            </div>
            <Pill tone="success">Terhubung</Pill>
          </div>
          {/* Dua tombol, bukan empat.
              Empat tombol membagi lebar kartu menjadi ~70px per tombol, dan
              label seperti "Restore Semua" lalu wrap jadi dua baris di dalam
              tombol setinggi 44px — teksnya meluber keluar tombol dan
              keempatnya terlihat berbeda tinggi.

              "Backup DB" / "Restore DB" versi lama dihapus, bukan
              disembunyikan: isinya SQLite lokal, dan aplikasi ini tidak
              punya SQLite. Satu-satunya data yang benar-benar ada di
              perangkat adalah cache IndexedDB + setelan localStorage,
              jadi dua tombol itu sudah mencakup semuanya. */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={async () => {
                const hasil = await unduhBackup();
                setCatatan(
                  hasil.ok
                    ? { tone: "ok", text: `Backup tersimpan: ${hasil.namaFile}` }
                    : { tone: "warn", text: hasil.pesan },
                );
              }}
              className={btnPrimary + " whitespace-nowrap px-3"}
            >
              Backup Data
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className={btnGhost + " whitespace-nowrap px-3"}
            >
              Restore Data
            </button>
          </div>
          {/* Input file disembunyikan, dipicu dari tombol. `accept` membatasi
              ke .json supaya file lain tidak pilih lalu gagal dibaca. */}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Kosongkan `value` setelah dipakai: tanpa itu, memilih file
              // yang sama dua kali tidak memicu onChange karena browser
              // menganggap tidak ada perubahan.
              e.target.value = "";
              if (f) void restore(f);
            }}
          />
          {/* Yang disimpan bukan transaksi. Transaksi ada di Supabase dan
              bisa diunduh dari sana; yang hilang kalau perangkat rusak
              adalah setelan printer dan cache katalog. Menyamakan keduanya
              membuat orang mengira backup ini cadangan penuh. */}
          <p className="mt-2 text-xs text-muted-foreground">
            Menyimpan katalog, setelan printer, dan cache struk dari perangkat ini. Transaksi
            yang sudah tersimpan ada di Supabase — unduh dari Supabase, bukan dari sini.
          </p>
        </div>
      </Card>

      <Toast toast={catatan} />
    </div>
  );
}
