// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";


import type { Sale } from "@/lib/sale";
import type { Product } from "@/lib/menu-seed";
import type { HasilUbah, UbahStrukInput } from "@/lib/supabase-tulis";
import type { HasilPiutang } from "@/lib/piutang-tulis";

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

  it("Ongkir bisa diedit dan dikirim ke server", async () => {
    await bukaEdit();
    /* Cari input ongkir — aria-label-nya "Ongkir". */
    const ongkirInput = screen.getByLabelText("Ongkir");
    expect(ongkirInput).toBeInTheDocument();
    /* Sale_BERNOTE punya ongkir 0, jadi mulainya 0 (InputRupiah format: ""). */
    expect(ongkirInput).toHaveValue("");

    await userEvent.clear(ongkirInput);
    await userEvent.type(ongkirInput, "15000");

    await userEvent.click(screen.getByRole("button", { name: /^Simpan$/i }));
    await waitFor(() => expect(simpanMock).toHaveBeenCalled());
    expect(simpanMock.mock.calls[0]![0].ongkir).toBe(15_000);
  });

  it("pratinjau Cetak Ulang memakai nomor antrean asli (queueNo)", async () => {
    const SALE_DENGAN_ANTRE: Sale = { ...SALE_BERNOTE, queueNo: 30 };
    render(<Drawer sale={SALE_DENGAN_ANTRE} onClose={() => {}} onSimpan={simpanMock} />);
    await masukModeCetak();

    const data = JSON.parse((await screen.findByTestId("struk-data")).textContent ?? "{}");
    expect(data.queueNo).toBe(30);
  });

  it("pratinjau Cetak Ulang null untuk queueNo jika tidak ada", async () => {
    render(<Drawer sale={SALE_BERNOTE} onClose={() => {}} onSimpan={simpanMock} />);
    await masukModeCetak();

    const data = JSON.parse((await screen.findByTestId("struk-data")).textContent ?? "{}");
    expect(data.queueNo).toBeNull();
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

/* -------------------------------------------------------------------------
   Tag Alamat — tampil di rincian, bisa diedit, kurir otomatis.
   -------------------------------------------------------------------------- */

describe("Tag Alamat di drawer struk", () => {
  beforeAll(() => {
    /* jsdom tidak punya scrollIntoView; Select memanggilnya saat dropdown
       dibuka. Stub supaya tes dropdown Tag Alamat tidak crash. */
    Element.prototype.scrollIntoView ??= () => {};
  });

  const ubahTagMock = vi.fn<(nama: string, tag: string) => Promise<{ ok: boolean; pesan?: string }>>();
  const SALE_TAG: Sale = {
    ...SALE,
    tag: "ITS",
    customer: "Anis BTH",
    lines: [{ name: "Nasi", variant: "Normal", qty: 1, price: 10_000 }],
  };

  beforeEach(() => {
    ubahTagMock.mockReset();
    ubahTagMock.mockResolvedValue({ ok: true });
  });

  it("menampilkan Tag Alamat di rincian Pengiriman", () => {
    render(<Drawer sale={SALE_TAG} onClose={() => {}} />);
    expect(screen.getByText(/Tag Alamat/)).toBeInTheDocument();
    expect(screen.getByText(/ITS/)).toBeInTheDocument();
  });

  it("menampilkan tanda hubung untuk tag kosong", () => {
    render(<Drawer sale={SALE} onClose={() => {}} />);
    /* Ada dua —: Alamat dan Tag Alamat. Cari saja Tag Alamat-nya. */
    const baris = screen.getByText(/Tag Alamat/);
    expect(baris).toBeInTheDocument();
    /* Dd dengan Tag Alamat tepat di samping dt-nya. */
    const dl = baris.closest("dl")!;
    const dds = Array.from(dl.querySelectorAll("dd"));
    const tagAlamat = dds.find((_, i) => {
      const dts = Array.from(dl.querySelectorAll("dt"));
      return i > 0 && dts[i]?.textContent === "Tag Alamat";
    }) ?? dds[2]; /* urutan: Customer, Alamat, Tag Alamat, Kurir */
    expect(tagAlamat?.textContent?.trim()).toBe("—");
  });

  it("Kurir terisi dari tag (ITS → Raka/Vendi)", () => {
    render(<Drawer sale={SALE_TAG} onClose={() => {}} />);
    expect(screen.getByText(/Kurir/)).toBeInTheDocument();
    expect(screen.getByText(/Raka.Vendi/)).toBeInTheDocument();
  });

  it("Kurir 'Ambil sendiri' untuk tag kosong", () => {
    render(<Drawer sale={SALE} onClose={() => {}} />);
    expect(screen.getByText(/Ambil sendiri/)).toBeInTheDocument();
  });

  it("input Tag Alamat muncul di mode edit kalau ada onUbahTag", async () => {
    render(<Drawer sale={SALE_TAG} onClose={() => {}} onSimpan={simpanMock} onUbahTag={ubahTagMock} />);
    await masukModeEdit();
    expect(screen.getByLabelText(/Tag alamat/i)).toBeInTheDocument();
  });

  it("input Tag Alamat tidak muncul tanpa onUbahTag", async () => {
    render(<Drawer sale={SALE_TAG} onClose={() => {}} onSimpan={simpanMock} />);
    await masukModeEdit();
    expect(screen.queryByLabelText(/Tag alamat/i)).toBeNull();
  });

  it("onUbahTag dipanggil saat tag berubah dan Simpan ditekan", async () => {
    render(
      <Drawer
        sale={SALE_TAG}
        onClose={() => {}}
        onSimpan={simpanMock}
        onUbahTag={ubahTagMock}
        opsiTag={["Sutorejo"]}
      />,
    );
    await masukModeEdit();

    /* Buka dropdown Tag Alamat lalu pilih "Sutorejo" */
    const tagSelect = screen.getByLabelText(/Tag alamat/i);
    await userEvent.click(tagSelect);
    await userEvent.click(screen.getByRole("option", { name: "Sutorejo" }));

    await userEvent.click(screen.getByRole("button", { name: /^Simpan$/i }));
    await waitFor(() => expect(ubahTagMock).toHaveBeenCalledWith("Anis BTH", "Sutorejo"));
  });

  it("onUbahTag tidak dipanggil kalau tag tidak berubah", async () => {
    render(<Drawer sale={SALE_TAG} onClose={() => {}} onSimpan={simpanMock} onUbahTag={ubahTagMock} />);
    await masukModeEdit();

    /* Simpan tanpa mengubah tag */
    await userEvent.click(screen.getByRole("button", { name: /^Simpan$/i }));
    await waitFor(() => expect(simpanMock).toHaveBeenCalled());
    expect(ubahTagMock).not.toHaveBeenCalled();
  });

  it("pesan gagal onUbahTag ditampilkan", async () => {
    ubahTagMock.mockResolvedValue({ ok: false, pesan: "Customer tidak ditemukan." });

    render(
      <Drawer
        sale={SALE_TAG}
        onClose={() => {}}
        onSimpan={simpanMock}
        onUbahTag={ubahTagMock}
        opsiTag={["GOJEK"]}
      />,
    );
    await masukModeEdit();

    const tagSelect = screen.getByLabelText(/Tag alamat/i);
    await userEvent.click(tagSelect);
    await userEvent.click(screen.getByRole("option", { name: "GOJEK" }));

    await userEvent.click(screen.getByRole("button", { name: /^Simpan$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Customer tidak ditemukan/i);
  });

  it("nilai tag lama yang tidak ada di opsiTag tetap muncul sebagai opsi terpilih", async () => {
    /* SALE_TAG punya tag "ITS". opsiTag default [], tapi "ITS" harus tetap
       terlihat sebagai opsi yang terpilih di dropdown karena kode tambahan
       menambahkannya ke opsiTagOptions. */
    render(
      <Drawer
        sale={SALE_TAG}
        onClose={() => {}}
        onSimpan={simpanMock}
        onUbahTag={ubahTagMock}
      />,
    );
    await masukModeEdit();

    const tagSelect = screen.getByLabelText(/Tag alamat/i);
    /* Trigger button harus menampilkan "ITS" sebagai nilai terpilih. */
    expect(tagSelect).toHaveTextContent("ITS");
  });

  it("pratinjau Cetak Ulang memuat kurir dari tagForm", async () => {
    render(
      <Drawer
        sale={SALE_TAG}
        onClose={() => {}}
        onSimpan={simpanMock}
        onUbahTag={ubahTagMock}
        opsiTag={["Sutorejo"]}
      />,
    );
    await masukModeEdit();

    const tagSelect = screen.getByLabelText(/Tag alamat/i);
    await userEvent.click(tagSelect);
    await userEvent.click(screen.getByRole("option", { name: "Sutorejo" }));

    /* Kembali ke lihat, lalu buka cetak. */
    await userEvent.click(screen.getByRole("button", { name: /^Kembali$/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Cetak Ulang/i })).toBeInTheDocument());
    await masukModeCetak();

    const data = JSON.parse((await screen.findByTestId("struk-data")).textContent ?? "{}");
    expect(data.kurir).toBe("Yanto");
  });
});

/* -------------------------------------------------------------------------
   Deposit Terpakai & Pembayaran dengan Uang Diterima
   -------------------------------------------------------------------------- */

const lunasDiterimaMock = vi.fn<(s: Sale, u: number, k: boolean) => Promise<HasilPiutang>>();

const SALE_DEPOSIT: Sale = {
  ...SALE,
  total: 75_000,
  usedDeposit: 15_000,
  status: "belum",
  lines: [{ name: "Nasi Goreng", variant: "Normal", qty: 1, price: 25_000, note: "" }],
};

describe("Deposit terpakai di drawer struk", () => {
  it("baris Deposit terpakai muncul kalau usedDeposit > 0", () => {
    render(<Drawer sale={SALE_DEPOSIT} onClose={() => {}} />);
    expect(screen.getByText(/Deposit terpakai/)).toBeInTheDocument();
    expect(screen.getByText(/15\.000/)).toBeInTheDocument();
  });

  it("baris Deposit terpakai tidak muncul kalau usedDeposit 0", () => {
    render(<Drawer sale={SALE} onClose={() => {}} />);
    expect(screen.queryByText(/Deposit terpakai/)).toBeNull();
  });

  it("baris Deposit terpakai tidak muncul kalau usedDeposit undefined", () => {
    const tanpaDeposit: Sale = { ...SALE, usedDeposit: undefined };
    render(<Drawer sale={tanpaDeposit} onClose={() => {}} />);
    expect(screen.queryByText(/Deposit terpakai/)).toBeNull();
  });

  it("Total dikurangi deposit", () => {
    render(<Drawer sale={SALE_DEPOSIT} onClose={() => {}} />);
    /* Total = 75.000 - 15.000 = 60.000. SALE punya total 1000, jadi kalau
       SALE_DEPOSIT tidak dipakai, 1000 masih muncul: pastikan ini benar. */
    const totalRow = screen.getByText("Total").closest("div")!;
    expect(totalRow).toHaveTextContent(/60\.000/);
    expect(screen.queryByText(/Rp75\.000/)).toBeNull();
  });

  it("pratinjau Cetak Ulang memuat usedDeposit", async () => {
    render(<Drawer sale={SALE_DEPOSIT} onClose={() => {}} />);
    await masukModeCetak();
    const data = JSON.parse((await screen.findByTestId("struk-data")).textContent ?? "{}");
    expect(data.usedDeposit).toBe(15_000);
  });
});

describe("Pembayaran dengan uang diterima", () => {
  beforeEach(() => {
    lunasDiterimaMock.mockReset();
    lunasDiterimaMock.mockResolvedValue({ ok: true, sisa: 0, deposit: 0 });
  });

  async function bukaPopupPembayaran() {
    await userEvent.click(screen.getByRole("button", { name: /^Tandai Lunas$/i }));
    await screen.findByText("Tagihan");
    return screen.getAllByRole("dialog")[1]!;
  }

  it("popup pembayaran terbuka saat Tandai Lunas ditekan", async () => {
    render(<Drawer sale={SALE_DEPOSIT} onClose={() => {}} onLunasDiterima={lunasDiterimaMock} />);
    expect(screen.queryByLabelText("Uang diterima")).toBeNull();
    const dialog = await bukaPopupPembayaran();
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Tagihan")).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/Rp\s*60\.000/);
  });

  it("input Uang diterima tidak muncul tanpa onLunasDiterima", () => {
    render(<Drawer sale={SALE_DEPOSIT} onClose={() => {}} />);
    expect(screen.queryByLabelText("Uang diterima")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Tandai Lunas$/i })).toBeNull();
  });

  it("chip Uang pas mengisi tagihan efektif", async () => {
    render(<Drawer sale={SALE_DEPOSIT} onClose={() => {}} onLunasDiterima={lunasDiterimaMock} />);
    await bukaPopupPembayaran();
    await userEvent.click(screen.getByRole("button", { name: "Uang pas" }));
    expect(screen.getByLabelText("Uang diterima")).toHaveValue("60.000");
    expect(lunasDiterimaMock).not.toHaveBeenCalled();
  });

  it("menampilkan kembalian sesuai uang diterima", async () => {
    render(<Drawer sale={SALE_DEPOSIT} onClose={() => {}} onLunasDiterima={lunasDiterimaMock} />);
    await bukaPopupPembayaran();
    const input = screen.getByLabelText("Uang diterima");
    /* Tagihan efektif 60.000; 100.000 → kembalian 40.000. */
    await userEvent.clear(input);
    await userEvent.type(input, "100000");
    const labelEl = screen.getByText("Kembalian");
    expect(labelEl.parentElement).toHaveTextContent(/Rp 40\.000/);
  });

  it("tombol Kembalian ke deposit memanggil handler dengan keDeposit=true", async () => {
    render(<Drawer sale={SALE_DEPOSIT} onClose={() => {}} onLunasDiterima={lunasDiterimaMock} />);
    await bukaPopupPembayaran();
    const input = screen.getByLabelText("Uang diterima");
    await userEvent.clear(input);
    await userEvent.type(input, "75000");
    await userEvent.click(screen.getByRole("button", { name: /Kembalian ke deposit/i }));
    await waitFor(() => expect(lunasDiterimaMock).toHaveBeenCalledWith(SALE_DEPOSIT, 75_000, true));
    await waitFor(() => expect(screen.queryByText("Tagihan")).toBeNull());
  });

  it("tombol Kembalikan tunai memanggil handler dengan keDeposit=false", async () => {
    render(<Drawer sale={SALE_DEPOSIT} onClose={() => {}} onLunasDiterima={lunasDiterimaMock} />);
    await bukaPopupPembayaran();
    const input = screen.getByLabelText("Uang diterima");
    await userEvent.clear(input);
    await userEvent.type(input, "75000");
    await userEvent.click(screen.getByRole("button", { name: /Kembalikan tunai/i }));
    await waitFor(() => expect(lunasDiterimaMock).toHaveBeenCalledWith(SALE_DEPOSIT, 75_000, false));
  });

  it("memuat usedDeposit di pratinjau Cetak Ulang bersama onLunasDiterima", async () => {
    render(
      <Drawer
        sale={SALE_DEPOSIT}
        onClose={() => {}}
        onSimpan={simpanMock}
        onLunasDiterima={lunasDiterimaMock}
      />,
    );
    await masukModeCetak();
    const data = JSON.parse((await screen.findByTestId("struk-data")).textContent ?? "{}");
    expect(data.usedDeposit).toBe(15_000);
  });

  it("popup mulai dengan nominal pas dan aksi aktif", async () => {
    render(<Drawer sale={SALE_DEPOSIT} onClose={() => {}} onLunasDiterima={lunasDiterimaMock} />);
    await bukaPopupPembayaran();
    expect(screen.getByLabelText("Uang diterima")).toHaveValue("60.000");
    expect(screen.getByRole("button", { name: /Kembalian ke deposit/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Kembalikan tunai/i })).toBeEnabled();
  });

  it("aksi pembayaran nonaktif saat uang diterima kurang dari tagihan", async () => {
    render(<Drawer sale={SALE_DEPOSIT} onClose={() => {}} onLunasDiterima={lunasDiterimaMock} />);
    await bukaPopupPembayaran();
    const input = screen.getByLabelText("Uang diterima");
    await userEvent.clear(input);
    await userEvent.type(input, "50000");
    expect(screen.getByRole("button", { name: /Kembalian ke deposit/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Kembalikan tunai/i })).toBeDisabled();
  });

  it("error tampil di popup dan popup tetap terbuka", async () => {
    lunasDiterimaMock.mockResolvedValue({ ok: false, pesan: "Pembayaran gagal dicatat." });
    render(<Drawer sale={SALE_DEPOSIT} onClose={() => {}} onLunasDiterima={lunasDiterimaMock} />);
    const dialog = await bukaPopupPembayaran();
    await userEvent.click(screen.getByRole("button", { name: /Kembalian ke deposit/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pembayaran gagal dicatat.");
    expect(dialog).toBeInTheDocument();
  });

  it("pesan sukses muncul di drawer setelah popup ditutup", async () => {
    render(<Drawer sale={SALE_DEPOSIT} onClose={() => {}} onLunasDiterima={lunasDiterimaMock} />);
    await bukaPopupPembayaran();
    await userEvent.click(screen.getByRole("button", { name: /Kembalian ke deposit/i }));
    expect(await screen.findByText(/Pembayaran dicatat — struk ini sekarang Lunas/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Tagihan")).toBeNull());
  });

  it("Tandai Lunas lama tetap muncul kalau hanya onLunas disediakan", () => {
    render(<Drawer sale={SALE_DEPOSIT} onClose={() => {}} onLunas={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Tandai Lunas/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Uang diterima")).toBeNull();
  });
});

/* -------------------------------------------------------------------------
   Batalkan Lunas
   -------------------------------------------------------------------------- */

const SALE_LUNAS: Sale = {
  ...SALE,
  status: "lunas",
  total: 100_000,
  usedDeposit: 25_000,
  lines: [{ name: "Nasi Goreng", variant: "Normal", qty: 2, price: 25_000 }],
};

const batalLunasMock = vi.fn<(s: Sale) => void>();

describe("Batalkan Lunas di drawer struk", () => {
  beforeEach(() => {
    batalLunasMock.mockReset();
  });

  it("tombol muncul kalau status lunas dan onBatalLunas disediakan", () => {
    render(<Drawer sale={SALE_LUNAS} onClose={() => {}} onBatalLunas={batalLunasMock} />);
    expect(screen.getByRole("button", { name: /Batalkan Lunas/i })).toBeInTheDocument();
  });

  it("tombol tidak muncul kalau status belum", () => {
    render(<Drawer sale={SALE_DEPOSIT} onClose={() => {}} onBatalLunas={batalLunasMock} />);
    expect(screen.queryByRole("button", { name: /Batalkan Lunas/i })).toBeNull();
  });

  it("tombol tidak muncul kalau status terhapus", () => {
    const terhapus: Sale = { ...SALE_LUNAS, status: "terhapus" };
    render(<Drawer sale={terhapus} onClose={() => {}} onBatalLunas={batalLunasMock} />);
    expect(screen.queryByRole("button", { name: /Batalkan Lunas/i })).toBeNull();
  });

  it("tombol tidak muncul tanpa onBatalLunas", () => {
    render(<Drawer sale={SALE_LUNAS} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /Batalkan Lunas/i })).toBeNull();
  });

  it("teks bantuan menjelaskan akibatnya", () => {
    render(<Drawer sale={SALE_LUNAS} onClose={() => {}} onBatalLunas={batalLunasMock} />);
    expect(screen.getByText(/menghapus riwayat pembayaran/i)).toBeInTheDocument();
    expect(screen.getByText(/mengembalikan deposit/i)).toBeInTheDocument();
  });

  it("memanggil handler dengan sale yang benar", async () => {
    render(<Drawer sale={SALE_LUNAS} onClose={() => {}} onBatalLunas={batalLunasMock} />);
    await userEvent.click(screen.getByRole("button", { name: /Batalkan Lunas/i }));
    expect(batalLunasMock).toHaveBeenCalledWith(SALE_LUNAS);
  });
});
