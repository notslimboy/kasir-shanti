import { cn } from "@/lib/utils";

/* ==========================================================================
   BadgeBank — chip nama bank dengan warna mereknya.

   Warna bukan hiasan: di daftar pembayaran, bank adalah fakta yang sering
   dipindai ("transfer dari mana saja bulan ini?") — samakan tampilannya
   dengan identitas banknya, jadi pemindaian mata tidak perlu membaca.
   ========================================================================== */

const WARNA_BANK: Record<string, string> = {
  mandiri:
    "bg-[#1D4ED8]/15 text-[#1E40AF] dark:bg-[#3B82F6]/25 dark:text-[#93C5FD]",
  bca: "bg-[#0284C7]/15 text-[#0369A1] dark:bg-[#0EA5E9]/25 dark:text-[#7DD3FC]",
  bni: "bg-[#F59E0B]/20 text-[#B45309] dark:bg-[#F59E0B]/20 dark:text-[#FCD34D]",
  bri: "bg-[#0284C7]/15 text-[#0369A1] dark:bg-[#0EA5E9]/25 dark:text-[#7DD3FC]",
};

/* Ejaan resmi merek — `capitalize` menghasilkan "Bni"/"Bca" yang salah. */
const NAMA_BANK: Record<string, string> = {
  mandiri: "Mandiri",
  bca: "BCA",
  bni: "BNI",
  bri: "BRI",
  bsi: "BSI",
  cimb: "CIMB",
};

export function BadgeBank({ bank, className }: { bank: string; className?: string }) {
  const kunci = bank.toLowerCase().trim();
  const warna = WARNA_BANK[kunci] ?? "bg-muted text-muted-foreground";
  const tampil = NAMA_BANK[kunci] ?? bank;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-bold",
        warna,
        className,
      )}
    >
      {tampil}
    </span>
  );
}
