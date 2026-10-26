/* Indikator proses di dalam dialog/drawer.
   Spinner + kalimat yang menyebut APA yang sedang dimuat — "Memuat…" polos
   tidak memberi tahu apa pun. `aria-busy` + role=status membuat pembaca
   layar ikut tahu. */
export function Memuat({ teks }: { teks: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-col items-center justify-center gap-2.5 py-8 text-center"
    >
      <span
        aria-hidden="true"
        className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary"
      />
      <span className="text-sm text-muted-foreground">{teks}</span>
    </div>
  );
}
