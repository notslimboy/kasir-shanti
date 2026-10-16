// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";


import type { Sale } from "@/lib/sale";
import type { Product } from "@/lib/menu-seed";
import type { HasilUbah, UbahStrukInput } from "@/lib/supabase-tulis";

/* "Cetak Ulang" and "Ubah Data" in the receipt drawer.
 *
 * The print button used to read `onClick={() => setMode("cetak")}` while the
 * element containing it was already rendered under `mode === "cetak"`. That is
 * a no-op — the state is set to the value it already has — so the print dialog
 * never opened. "Simpan" was worse: it mutated local state and flashed
 * "✓ Tersimpan" without writing anything, so every keystroke was lost when the
 * drawer closed. Neither was caught, because a click that changes nothing looks
 * exactly like a passing click.
 *
 * The receipt component is stubbed rather than rendered. Its real `cetak()`
 * builds a `srcdoc` iframe and calls `contentWindow.print()`, which jsdom does
 * not execute, so a real render could not assert anything. The stub is the seam
 * for observing both the print call and the data the preview is built from.
 * The receipt's own printing is covered by `struk.test.ts` and the E2E suite. */

/* `vi.mock` is hoisted above imports, so the factory cannot close over
   imported values either — hence the async factory with a dynamic import of
   react inside it. `cetakMock` is the one thing the factory needs from this
   file's scope, and it comes from `vi.hoisted`. */
const { cetakMock } = vi.hoisted(() => ({ cetakMock: vi.fn() }));

vi.mock("@/components/struk", async () => {
  const React = await import("react");
  /* `data` is serialised into the DOM so the specs can assert what the print
     preview was built from — that is how the dropped per-item `note` and the
     hardcoded empty `sendNote` were caught. */
  const Struk = React.forwardRef(function Struk(
    { data }: { data: unknown },
    ref: React.ForwardedRef<{ cetak: () => void; html: () => string }>,
  ) {
    React.useImperativeHandle(ref, () => ({ cetak: cetakMock, html: () => "" }));
    return React.createElement("div", {
      title: "Pratinjau struk",
      "data-testid": "struk-data",
      children: JSON.stringify(data),
    });
  });
  return { Struk };
});

const { StrukDrawer } = await import("@/components/struk-drawer");

const SALE: Sale = {
  id: 1,
  receiptNo: "SH-20261005-0001",
  customer: "Uji Cetak",
  completedOn: "2026-10-05",
  completedIso: "2026-10-05T12:00:00.000Z",
  completedAt: "05/10/2026 19.01",
  completedAtShort: "5 Okt 19:01",
  total: 1000,
  payment: "Tunai",
  itemCount: 1,
  status: "lunas",
  ongkir: 0,
  lines: [{ name: "Nasi Goreng", variant: "Normal", qty: 1, price: 1000 }],
};

afterEach(() => {
  cleanup();
  cetakMock.mockReset();
  localStorage.clear();
});

/** The footer button, in the detail view. */
const tombolCetakUlang = () => screen.getByRole("button", { name: /Cetak Ulang/i });

describe("Cetak Ulang di drawer struk", () => {
  beforeEach(() => {
    cetakMock.mockImplementation(() => {});
  });

  it("labelnya persis 'Cetak Ulang', bukan 'Cetak 58mm'", () => {
    /* The old label hardcoded the default paper width, which read as an
       instruction rather than an action, and was wrong whenever the shop was
       set to 80mm. */
    render(<StrukDrawer sale={SALE} onClose={() => {}} />);
    expect(tombolCetakUlang().textContent).toBe("Cetak Ulang");
    expect(screen.queryByRole("button", { name: /Cetak 58mm/ })).toBeNull();
  });

  it("tombolnya aktif", () => {
    render(<StrukDrawer sale={SALE} onClose={() => {}} />);
    expect(tombolCetakUlang()).toBeEnabled();
  });

  it("membuka pratinjau struk", async () => {
    render(<StrukDrawer sale={SALE} onClose={() => {}} />);
    await userEvent.click(tombolCetakUlang());
    /* The preview only exists in mode "cetak", so its presence is the proof
       that the mode actually changed. */
    await waitFor(() => expect(screen.getByTitle("Pratinjau struk")).toBeInTheDocument());
  });

  it("benar-benar memanggil jalur cetak, bukan hanya ganti tampilan", async () => {
    render(<StrukDrawer sale={SALE} onClose={() => {}} />);
    await userEvent.click(tombolCetakUlang());
    await waitFor(() => expect(screen.getByTitle("Pratinjau struk")).toBeInTheDocument());
    expect(cetakMock).not.toHaveBeenCalled();

    /* Second "Cetak Ulang" — the one inside the print preview. */
    const semua = screen.getAllByRole("button", { name: /Cetak Ulang/i });
    await userEvent.click(semua[semua.length - 1]!);

    /* This is the assertion that would have caught the original bug. */
    await waitFor(() => expect(cetakMock).toHaveBeenCalled());
  });

  it("tidak mencetak hanya karena drawer dibuka", () => {
    render(<StrukDrawer sale={SALE} onClose={() => {}} />);
    expect(cetakMock).not.toHaveBeenCalled();
  });

  it("tombol Kembali mengembalikan ke rincian tanpa mencetak", async () => {
    render(<StrukDrawer sale={SALE} onClose={() => {}} />);
    await userEvent.click(tombolCetakUlang());
    await waitFor(() => expect(screen.getByTitle("Pratinjau struk")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /^Kembali$/i }));

    await waitFor(() => expect(screen.queryByTitle("Pratinjau struk")).toBeNull());
    expect(cetakMock).not.toHaveBeenCalled();
  });

  it("subtitle memakai lebar dari setelan, bukan hardcoded 58mm", async () => {
    /* 58mm is only the default. Reporting 58mm in the header while the
       receipt prints at 80mm is a quiet lie about the paper. */
    localStorage.setItem(
      "kasir-setelan-struk",
      JSON.stringify({ receiptWidth: "80", storeName: "Shanti Catering" }),
    );
    vi.resetModules();
    const fresh = await import("@/components/struk-drawer");

    render(<fresh.StrukDrawer sale={SALE} onClose={() => {}} />);
    expect(screen.getByText(/80mm/)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------
   Ubah Data

   The drawer's "Simpan" used to only touch local state and flash
   "✓ Tersimpan" — nothing was written, and every keystroke was lost when the
   drawer closed. That is invisible to a click-based assertion, because the
   click "worked".

   The payload given to `onSimpan` is what these specs check: it is the only
   thing standing between the form and the database.
   -------------------------------------------------------------------------- */

const simpanMock = vi.fn<(p: UbahStrukInput) => Promise<HasilUbah>>();

const { StrukDrawer: Drawer } = await import("@/components/struk-drawer");

const SALE_BERNOTE: Sale = {
  ...SALE,
  /* Consistent with its lines: 35.000 + 10.000. A fixture whose stored total
     disagrees with its items makes every "total berubah" assertion fire on
     open, which hides the real one. */
  total: 45_000,
  sendNote: "titip antar siang",
  lines: [
    { id: 101, name: "Gule Daging", variant: "Normal", qty: 1, price: 35_000, note: "saos bnyakin" },
    { id: 102, name: "Es Kacang Ijo", variant: "Normal", qty: 1, price: 10_000 },
  ],
};

async function bukaEdit() {
  render(<Drawer sale={SALE_BERNOTE} onClose={() => {}} onSimpan={simpanMock} />);
  await masukModeEdit();
}

/* The footer swaps modes through `AnimatePresence mode="wait"`, so the new
   panel only mounts after the old one finishes animating out. That takes a
   frame, and `await userEvent.click` does not wait for one — without the
   `waitFor` every spec in the Ubah Data block fails with "unable to find
   label" even though the mode did change. */
async function masukModeEdit() {
  await userEvent.click(screen.getByRole("button", { name: /Ubah Data/i }));
  await waitFor(() => expect(screen.getByLabelText(/Catatan kirim/i)).toBeInTheDocument());
}

async function masukModeCetak() {
  await userEvent.click(screen.getByRole("button", { name: /Cetak Ulang/i }));
  await waitFor(() => expect(screen.getByTitle("Pratinjau struk")).toBeInTheDocument());
}

/* Back to the detail view. "Rincian Item" is a heading in BOTH modes, so it
   is useless as a marker — waiting on it passes while still in edit mode, and
   the next lookup for "Cetak Ulang" then fails. The per-item note field only
   exists in edit mode, so its absence is the honest signal. */
async function kembaliKeRincian() {
  await waitFor(() => expect(screen.queryByLabelText("Catatan item Gule Daging")).toBeNull());
}

describe("Ubah Data di drawer struk", () => {
  beforeEach(() => {
    simpanMock.mockReset();
    simpanMock.mockResolvedValue({ ok: true, subtotal: 45_000, total: 45_000, dibuang: 0 });
  });

  it("memakai kolom Catatan Kirim, bukan Alamat Kirim", async () => {
    render(<Drawer sale={SALE_BERNOTE} onClose={() => {}} onSimpan={simpanMock} />);
    await masukModeEdit();

    expect(screen.getByLabelText(/Catatan kirim/i)).toBeInTheDocument();
    /* Alamat customer tidak pernah masuk ke struk, jadi field yang dulu ada
       di sini hanya menghasilkan data yang tidak terlihat di mana pun. */
    expect(screen.queryByLabelText(/Alamat Kirim/i)).toBeNull();
  });

  it("Catatan Kirim terisi dari send_note yang tersimpan", async () => {
    await bukaEdit();
    expect(screen.getByLabelText(/Catatan kirim/i)).toHaveValue("titip antar siang");
  });

  it("ada input catatan per baris item", async () => {
    await bukaEdit();
    expect(screen.getByLabelText("Catatan item Gule Daging")).toBeInTheDocument();
    expect(screen.getByLabelText("Catatan item Es Kacang Ijo")).toBeInTheDocument();
  });

  it("catatan item yang sudah ada terisi, tidak dikosongkan", async () => {
    /* Ini yang hilang_total dulu: `mapItem` mengambil `note`, tapi form
       membangun baris tanpa `note`, jadi catatan "saos bnyakin" hilang begitu
       drawer dibuka. */
    await bukaEdit();
    expect(screen.getByLabelText("Catatan item Gule Daging")).toHaveValue("saos bnyakin");
    expect(screen.getByLabelText("Catatan item Es Kacang Ijo")).toHaveValue("");
  });

  it("Simpan mengirim catatan item ke server", async () => {
    await bukaEdit();

    await userEvent.clear(screen.getByLabelText("Catatan item Gule Daging"));
    await userEvent.type(screen.getByLabelText("Catatan item Gule Daging"), "tanpa lombok");
    await userEvent.click(screen.getByRole("button", { name: /^Simpan$/i }));

    await waitFor(() => expect(simpanMock).toHaveBeenCalled());
    const baris = simpanMock.mock.calls[0]![0].lines;
    expect(baris.find((l) => l.id === 101)?.note).toBe("tanpa lombok");
  });

  it("Simpan mengirim catatan kirim ke server", async () => {
    await bukaEdit();
    await userEvent.clear(screen.getByLabelText(/Catatan kirim/i));
    await userEvent.type(screen.getByLabelText(/Catatan kirim/i), "doorbell mati");
    await userEvent.click(screen.getByRole("button", { name: /^Simpan$/i }));

    await waitFor(() => expect(simpanMock).toHaveBeenCalled());
    expect(simpanMock.mock.calls[0]![0].sendNote).toBe("doorbell mati");
  });

  it("Simpan mengirim saleId dan id tiap baris", async () => {
    /* Tanpa id, PATCH akan menulis ke `id=eq.0`. */
    await bukaEdit();
    await userEvent.click(screen.getByRole("button", { name: /^Simpan$/i }));
    await waitFor(() => expect(simpanMock).toHaveBeenCalled());

    const p = simpanMock.mock.calls[0]![0];
    expect(p.saleId).toBe(SALE_BERNOTE.id);
    expect(p.lines.map((l) => l.id).sort()).toEqual([101, 102]);
  });

  it("tidak keluar dari mode edit kalau server menolak", async () => {
    /* Keluar dari mode edit padahal tidak ada yang tersimpan adalah cara
       paling cepat membuat kasir mengira perubahannya sudah masuk. */
    simpanMock.mockResolvedValue({ ok: false, pesan: "Struk tidak ditemukan di server." });

    await bukaEdit();
    await userEvent.click(screen.getByRole("button", { name: /^Simpan$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/tidak ditemukan di server/i);
    expect(screen.getByLabelText(/Catatan kirim/i)).toBeInTheDocument();
  });

  it("memberi tahu kalau total naik dan struk jadi belum lunas", async () => {
    simpanMock.mockResolvedValue({ ok: true, subtotal: 60_000, total: 60_000, statusBerubah: true });

    await bukaEdit();
    await userEvent.click(screen.getByRole("button", { name: /^Simpan$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/BELUM LUNAS/i);
  });

  it("memberi tahu baris mana yang akan hilang karena qty 0", async () => {
    await bukaEdit();
    const qty = screen.getByLabelText("Qty Es Kacang Ijo");
    await userEvent.clear(qty);
    await userEvent.type(qty, "0");

    expect(screen.getByText(/Es Kacang Ijo qty 0/)).toBeInTheDocument();
    expect(screen.getByText(/catatan yang ikut hilang/i)).toBeInTheDocument();
  });

  it("memperingatkan total akan berubah sebelum disimpan", async () => {
    await bukaEdit();
    expect(screen.queryByText(/Total berubah/)).toBeNull();

    const harga = screen.getByLabelText("Harga per porsi Gule Daging");
    await userEvent.clear(harga);
    await userEvent.type(harga, "99000");

    expect(screen.getByText(/Total berubah/)).toBeInTheDocument();
  });

  it("tombol Simpan disembunyikan kalau tidak ada penangan", async () => {
    /* Tanpa `onSimpan` tidak ada yang menulis. Menampilkan tombol "Simpan" di
       situation itu berarti berbohong dua kali: ia menampilkan "✓ Tersimpan" sambil
       menyimpan nol byte. */
    render(<Drawer sale={SALE_BERNOTE} onClose={() => {}} />);
    await masukModeEdit();
    expect(screen.queryByRole("button", { name: /^Simpan$/i })).toBeNull();
  });

  it("pratinjau Cetak Ulang memakai catatan dari form", async () => {
    /* Cetak ulang membangun struk dari `form`, yang tadinya tidak pernah
       menyertakan `note` dan sendNote-nya string kosong. Hasilnya: struk
       yang dicetak berbeda dari struk yang sudah keluar dari printer. */
    render(<Drawer sale={SALE_BERNOTE} onClose={() => {}} onSimpan={simpanMock} />);
    await masukModeEdit();
    await userEvent.clear(screen.getByLabelText(/Catatan kirim/i));
    await userEvent.type(screen.getByLabelText(/Catatan kirim/i), "titip POS");

    await userEvent.click(screen.getByRole("button", { name: /^Kembali$/i }));
    await kembaliKeRincian();
    await masukModeCetak();

    const pratinjau = await screen.findByTestId("struk-data");
    const data = JSON.parse(pratinjau.textContent ?? "{}");
    expect(data.sendNote).toBe("titip POS");
    expect(data.items[0].note).toBe("saos bnyakin");
  });

  it("pratinjau totalnya mengikuti form, bukan total lama", async () => {
    render(<Drawer sale={SALE_BERNOTE} onClose={() => {}} onSimpan={simpanMock} />);
    await masukModeEdit();
    const harga = screen.getByLabelText("Harga per porsi Gule Daging");
    await userEvent.clear(harga);
    await userEvent.type(harga, "99000");

    await userEvent.click(screen.getByRole("button", { name: /^Kembali$/i }));
    await kembaliKeRincian();
    await masukModeCetak();

    const data = JSON.parse((await screen.findByTestId("struk-data")).textContent ?? "{}");
    /* 99.000 + 10.000. The old total must not survive an edit. */
    expect(data.total).toBe(109_000);
  });
});

/* -------------------------------------------------------------------------
   Tambah Item

   Struk lama tidak bisa dilengkapi: satu item yang tidak tercatat berarti
   kasir harus membatalkan struk dan mengetik ulang seluruh orderan. Yang
   diperiksa di sini adalah dua hal yang menentukan apakah tombolnya benar:
   baris baru sungguh muncul di form, dan yang dikirim ke `onSimpan` ditandai
   `baru` — tanpa tanda itu `ubahStruk` menolaknya sebagai baris tanpa id.
   -------------------------------------------------------------------------- */

const PRODUK: Product[] = [
  {
    client_id: "p-asem",
    name: "Asem Asem Daging",
    sku: "",
    category: "Makanan",
    aliases: [],
    stock: 10,
    stock_unlimited: false,
    variants: [
      {
        client_id: "v-asem",
        name: "Normal",
        pricing_type: "fixed",
        price: 25_000,
        unit_name: "",
        package_quantity: 1,
        receipt_label: "",
        is_default: true,
        allow_quantity_override: true,
        allow_price_override: false,
        active: true,
      },
    ],
  },
];

describe("Tambah item di form Ubah Data", () => {
  beforeEach(() => {
    simpanMock.mockReset();
    simpanMock.mockResolvedValue({ ok: true, subtotal: 45_000, total: 45_000, dibuang: 0 });
  });

  it("membuka pemilih menu dan meminta katalognya", async () => {
    /* Katalog Penjualan dimuat saat diminta: 1.095 produk tidak diambil untuk
       struk yang cuma dilihat. */
    const minta = vi.fn();
    render(
      <Drawer
        sale={SALE_BERNOTE}
        onClose={() => {}}
        onSimpan={simpanMock}
        produk={PRODUK}
        onMintaProduk={minta}
      />,
    );
    await masukModeEdit();

    await userEvent.click(screen.getByRole("button", { name: /Tambah item/i }));
    expect(minta).toHaveBeenCalled();
    expect(screen.getByLabelText("Cari menu untuk ditambah")).toBeInTheDocument();
  });

  it("menambahkan baris ke form dan mengirimnya sebagai baris baru", async () => {
    render(
      <Drawer sale={SALE_BERNOTE} onClose={() => {}} onSimpan={simpanMock} produk={PRODUK} />,
    );
    await masukModeEdit();

    await userEvent.click(screen.getByRole("button", { name: /Tambah item/i }));
    await userEvent.click(screen.getByRole("button", { name: /Asem Asem Daging/ }));

    /* Barisnya langsung terlihat, dengan harga variannya — bukan harga 0 yang
       harus ditebak kasir. */
    expect(screen.getByLabelText("Harga per porsi Asem Asem Daging")).toHaveValue("25.000");

    await userEvent.click(screen.getByRole("button", { name: /^Simpan$/i }));
    await waitFor(() => expect(simpanMock).toHaveBeenCalled());

    const baru = simpanMock.mock.calls[0]![0].lines.filter((l) => l.baru);
    expect(baru).toHaveLength(1);
    expect(baru[0]).toMatchObject({
      id: 0,
      name: "Asem Asem Daging",
      variant: "Normal",
      price: 25_000,
      qty: 1,
      productClientId: "p-asem",
      variantClientId: "v-asem",
    });
  });

  it("baris lama tidak ikut ditandai baru", async () => {
    render(
      <Drawer sale={SALE_BERNOTE} onClose={() => {}} onSimpan={simpanMock} produk={PRODUK} />,
    );
    await masukModeEdit();
    await userEvent.click(screen.getByRole("button", { name: /Tambah item/i }));
    await userEvent.click(screen.getByRole("button", { name: /Asem Asem Daging/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Simpan$/i }));

    await waitFor(() => expect(simpanMock).toHaveBeenCalled());
    const lama = simpanMock.mock.calls[0]![0].lines.filter((l) => l.id === 101 || l.id === 102);
    expect(lama.map((l) => l.baru)).toEqual([undefined, undefined]);
  });

  it("total ikut menghitung item yang baru ditambah", async () => {
    render(
      <Drawer sale={SALE_BERNOTE} onClose={() => {}} onSimpan={simpanMock} produk={PRODUK} />,
    );
    await masukModeEdit();
    await userEvent.click(screen.getByRole("button", { name: /Tambah item/i }));
    await userEvent.click(screen.getByRole("button", { name: /Asem Asem Daging/ }));

    /* 45.000 + 25.000. Tanpa ini kasir bisa menambah item lalu menyimpan
       dengan total lama, dan struknya tidak cocok dengan isinya. */
    expect(screen.getByText(/Total berubah .*→ Rp 70\.000/)).toBeInTheDocument();
  });

  it("pencarian menyaring daftar menu", async () => {
    render(
      <Drawer sale={SALE_BERNOTE} onClose={() => {}} onSimpan={simpanMock} produk={PRODUK} />,
    );
    await masukModeEdit();
    await userEvent.click(screen.getByRole("button", { name: /Tambah item/i }));
    await userEvent.type(screen.getByLabelText("Cari menu untuk ditambah"), "soto");

    expect(screen.queryByRole("button", { name: /Asem Asem Daging/ })).toBeNull();
    expect(screen.getByText(/Tidak ada menu yang cocok/)).toBeInTheDocument();
  });

  it("menampilkan 'memuat' selama katalog belum datang, bukan 'tidak ada'", async () => {
    /* Katalog kosong berarti belum dimuat — bukan berarti menu tidak ada.
       Pesan yang salah membuat kasir mengira menunya sudah dihapus. */
    render(<Drawer sale={SALE_BERNOTE} onClose={() => {}} onSimpan={simpanMock} produk={[]} />);
    await masukModeEdit();
    await userEvent.click(screen.getByRole("button", { name: /Tambah item/i }));

    expect(screen.getByText(/Memuat daftar menu/)).toBeInTheDocument();
  });

  it("katalog yang sudah ditarik tapi kosong dilaporkan apa adanya", async () => {
    render(
      <Drawer
        sale={SALE_BERNOTE}
        onClose={() => {}}
        onSimpan={simpanMock}
        produk={[]}
        produkDimuat
      />,
    );
    await masukModeEdit();
    await userEvent.click(screen.getByRole("button", { name: /Tambah item/i }));

    expect(screen.queryByText(/Memuat daftar menu/)).toBeNull();
    expect(screen.getByText(/Daftar menu kosong/)).toBeInTheDocument();
  });
});
