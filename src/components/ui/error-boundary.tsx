import { Component, type ErrorInfo, type ReactNode } from "react";

/* ==========================================================================
   ErrorBoundary — jaring pengaman per halaman.

   Sebelum ini, satu exception saat render membuat React melepas seluruh
   isi halaman: layar jadi kosong tanpa pesan dan user hanya bisa refresh
   manual. Sekarang kegagalan tampil sebagai kartu yang menyebut halamannya
   + tombol coba lagi, dan sidebar/topbar tetap hidup.
   ========================================================================== */

export class ErrorBoundary extends Component<
  { children: ReactNode; nama: string },
  { galat: Error | null }
> {
  state = { galat: null as Error | null };

  static getDerivedStateFromError(galat: Error) {
    return { galat };
  }

  componentDidCatch(galat: Error, info: ErrorInfo) {
    console.error(`[${this.props.nama}] render gagal`, galat, info.componentStack);
  }

  render() {
    if (!this.state.galat) return this.props.children;
    return (
      <div className="rounded-3xl bg-card p-6 shadow-card">
        <h2 className="text-base font-semibold">Halaman {this.props.nama} gagal dimuat</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Terjadi kesalahan saat menampilkan data. Coba muat ulang halaman ini —
          data yang sudah tersimpan di portal tidak terpengaruh.
        </p>
        <pre className="mt-3 max-h-32 overflow-auto rounded-xl bg-background p-3 text-xs text-muted-foreground">
          {this.state.galat.message}
        </pre>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => this.setState({ galat: null })}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Coba lagi
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            Muat ulang halaman
          </button>
        </div>
      </div>
    );
  }
}
