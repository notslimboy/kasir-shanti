// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MasukPage } from "./masuk";

/* Sign-in screen.

   The E2E suite builds with `VITE_E2E_AUTH_BYPASS=1`, so it never renders
   this page — which means the one screen every staff member sees first has
   no coverage at all unless it is tested here. That gap is the reason this
   file exists.

   The auth provider is mocked rather than wired to a real Supabase client:
   what matters is what the page does with the value `masuk()` returns, not
   that `signInWithPassword` exists. */

const masukMock = vi.fn<(email: string, password: string) => Promise<string | null>>();

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ masuk: masukMock }),
}));

afterEach(() => {
  cleanup();
  masukMock.mockReset();
});

describe("MasukPage", () => {
  beforeEach(() => {
    masukMock.mockResolvedValue(null);
  });

  it("tidak mengirim apa pun sebelum kedua field terisi", async () => {
    render(<MasukPage />);

    await userEvent.click(screen.getByRole("button", { name: "Masuk" }));

    expect(masukMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/wajib diisi/i);
  });

  it("menolak form kosong tanpa memanggil Supabase sama sekali", async () => {
    /* Submitting a blank form to Supabase burns one of the rate-limit
       attempts. Someone typing a password must not be charged for a
       half-finished form. */
    render(<MasukPage />);

    await userEvent.type(screen.getByLabelText(/email/i), "  ");
    await userEvent.click(screen.getByRole("button", { name: "Masuk" }));

    expect(masukMock).not.toHaveBeenCalled();
  });

  it("mengirim email dan password yang diketik", async () => {
    render(<MasukPage />);

    await userEvent.type(screen.getByLabelText(/email/i), "kasir@shanti.test");
    await userEvent.type(screen.getByLabelText(/password/i), "rahasia-kasir");
    await userEvent.click(screen.getByRole("button", { name: "Masuk" }));

    await waitFor(() => expect(masukMock).toHaveBeenCalledTimes(1));
    expect(masukMock).toHaveBeenCalledWith("kasir@shanti.test", "rahasia-kasir");
  });

  it("memangkas spasi di email sebelum mengirim", async () => {
    /* Pasting an email with a trailing space or newline is the single most
       common reason a correct password is rejected as wrong credentials. */
    render(<MasukPage />);

    const email = screen.getByLabelText(/email/i);
    await userEvent.type(email, "kasir@shanti.test ");
    await userEvent.type(screen.getByLabelText(/password/i), "rahasia-kasir");
    await userEvent.click(screen.getByRole("button", { name: "Masuk" }));

    await waitFor(() => expect(masukMock).toHaveBeenCalled());
    expect(masukMock.mock.calls[0][0]).toBe("kasir@shanti.test");
  });

  it("menampilkan pesan dari server apa adanya", async () => {
    masukMock.mockResolvedValue("Email atau password salah.");
    render(<MasukPage />);

    await userEvent.type(screen.getByLabelText(/email/i), "salah@shanti.test");
    await userEvent.type(screen.getByLabelText(/password/i), "apapun");
    await userEvent.click(screen.getByRole("button", { name: "Masuk" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/email atau password salah/i);
  });

  it("tidak mengirim ulang saat tombol sedang dipakai", async () => {
    /* Double-tap on a tablet is normal. Two `signInWithPassword` calls
       count as two rate-limit attempts and the second one locks a
       legitimate user out. */
    let selesai!: () => void;
    masukMock.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          selesai = () => resolve(null);
        }),
    );

    render(<MasukPage />);
    await userEvent.type(screen.getByLabelText(/email/i), "kasir@shanti.test");
    await userEvent.type(screen.getByLabelText(/password/i), "rahasia-kasir");

    const tombol = screen.getByRole("button", { name: "Masuk" });
    await userEvent.click(tombol);

    /* The label changes while in flight, so re-query by the new name. */
    const sibuk = await screen.findByRole("button", { name: /Memeriksa/ });
    expect(sibuk).toBeDisabled();

    await userEvent.click(sibuk);
    expect(masukMock).toHaveBeenCalledTimes(1);

    selesai();
  });

  it("label password memakai type password supaya tidak tampil polos", async () => {
    render(<MasukPage />);

    /* A shoulder-surfing detail that costs nothing to get right and is
       awkward to notice later. */
    expect(screen.getByLabelText(/password/i)).toHaveAttribute("type", "password");
    expect(screen.getByLabelText(/email/i)).toHaveAttribute("type", "email");
  });

  it("memakai autocomplete supaya password manager bisa bekerja", async () => {
    render(<MasukPage />);

    expect(screen.getByLabelText(/email/i)).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText(/password/i)).toHaveAttribute("autocomplete", "current-password");
  });

  it("tidak pernah menyimpan password di storage", async () => {
    render(<MasukPage />);

    await userEvent.type(screen.getByLabelText(/email/i), "kasir@shanti.test");
    await userEvent.type(screen.getByLabelText(/password/i), "rahasia-kasir");
    await userEvent.click(screen.getByRole("button", { name: "Masuk" }));
    await waitFor(() => expect(masukMock).toHaveBeenCalled());

    expect(JSON.stringify(localStorage)).not.toContain("rahasia-kasir");
    expect(JSON.stringify(sessionStorage)).not.toContain("rahasia-kasir");
  });
});