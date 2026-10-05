// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";

import type { Sale } from "@/lib/sale";

/* "Cetak Ulang" in the receipt drawer.
 *
 * The button used to read `onClick={() => setMode("cetak")}` while the element
 * containing it was already rendered under `mode === "cetak"`. That is a no-op
 * — the state is set to the value it already has — so the print dialog never
 * opened and the feature was dead. Nothing caught it: a click that changes
 * nothing still looks like a passing click.
 *
 * The receipt component is stubbed rather than rendered. Its real `cetak()`
 * builds a `srcdoc` iframe and calls `contentWindow.print()`, which jsdom does
 * not execute, so a real render could not assert anything. What is under test
 * here is the drawer's wiring — that the button reaches the receipt's print
 * path — and the stub is the seam for observing that. The receipt's own
 * printing is covered by `struk.test.ts` and the E2E suite. */

const cetakMock = vi.fn();

vi.mock("@/components/struk", () => {
  const Stub = forwardRef<{ cetak: () => void; html: () => string }, { data: unknown }>(
    function Stub(_props, ref) {
      useImperativeHandle(ref, () => ({ cetak: cetakMock, html: () => "" }));
      return <div title="Pratinjau struk" />;
    },
  );
  return { Struk: Stub };
});

const { StrukDrawer } = await import("@/components/struk-drawer");

const SALE: Sale = {
  id: 1,
  receiptNo: "SH-20261005-0001",
  customer: "Uji Cetak",
  completedOn: "2026-10-05",
  completedIso: "2026-10-05T12:00:00.000Z",
  completedAt: "05/10/2026 19.01",
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
