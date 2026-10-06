import { afterEach, describe, expect, it, vi } from "vitest";

import { idNumerikCustomer } from "@/lib/page-data";
import { ubahCustomer } from "@/lib/supabase-tulis";

/* Dua hal yang dikunci file ini:

   1. `idNumerikCustomer` mengubah "c1902" jadi 1902, dan menolak id yang
      bukan bentuk itu. Id customer UI diberi awalan "c" supaya tidak pernah
      sama dengan id struk atau produk; menulis id itu mentah ke server akan
      menimpa baris yang salah.

   2. `ubahCustomer` benar-benar memanggil server, dan body-nya hanya berisi
      kolom yang ADA di tabel `customers`. Bug aslinya: form Ubah Data
      Customer cuma mengubah state lokal, jadi setelah reload semua ketikan
      hilang — dan tidak ada satu pun request yang pernah terkirim. Test ini
      yang mengunci that'll tidak bisa balik lagi. */

const ASLI_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ASLI_FETCH;
  vi.restoreAllMocks();
});

/* PATCH yang membalas `Prefer: return=representation` dengan satu baris, supaya
   `ubahCustomer` anggap berhasil. */
function tangkapPATCH(baris: unknown[] = [{ id: 1 }]) {
  const spy = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => baris,
  }));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

/* Argumen PATCH yang benar-benar dikirim. Type-nya dibaca dari mock, bukan
   ditebak, supaya test ini gagal kalau pemanggil berubah bentuk. */
function argumenPATCH(spy: ReturnType<typeof tangkapPATCH>, ke = 0) {
  const call = spy.mock.calls[ke] as unknown as [string, RequestInit];
  return { url: call[0], opsi: call[1], body: JSON.parse(call[1].body as string) };
}

describe("idNumerikCustomer", () => {
  it("mengubah id berawalan c jadi angka", () => {
    expect(idNumerikCustomer("c1902")).toBe(1902);
    expect(idNumerikCustomer("c3")).toBe(3);
  });

  it("menolak id yang bukan bentuk c<angka>", () => {
    expect(idNumerikCustomer("1902")).toBeNull();
    expect(idNumerikCustomer("cus-1")).toBeNull();
    expect(idNumerikCustomer("c")).toBeNull();
    expect(idNumerikCustomer("c12x")).toBeNull();
    expect(idNumerikCustomer("")).toBeNull();
    expect(idNumerikCustomer(undefined as unknown as string)).toBeNull();
  });
});

describe("ubahCustomer", () => {
  const input = {
    id: 1902,
    name: "  Laguna P5/11  ",
    tag: "Pakuwon" as string | null,
    deposit: 5000,
    ongkir: 5000,
  };

  it("menulis ke baris customer yang benar", async () => {
    const spy = tangkapPATCH();
    const hasil = await ubahCustomer(input);

    expect(hasil.ok).toBe(true);
    const { url, opsi } = argumenPATCH(spy);
    expect(url).toContain("/rest/v1/customers?id=eq.1902");
    expect(opsi.method).toBe("PATCH");
  });

  it("hanya mengirim kolom yang ada di tabel customers", async () => {
    const spy = tangkapPATCH();
    await ubahCustomer(input);

    const { body } = argumenPATCH(spy);
    expect(Object.keys(body).sort()).toEqual(
      ["default_shipping", "deposit_balance", "name", "tag", "updated_at"].sort(),
    );
    /* Alias dan alamat tidak boleh ikut: customers tidak punya kolomnya, dan
       mengirim key yang tidak ada membuat PostgREST menolak seluruh PATCH. */
    expect(body).not.toHaveProperty("address");
    expect(body).not.toHaveProperty("note");
    expect(body).not.toHaveProperty("alias");
  });

  it("memangkas nama dan menyimpan tag kosong sebagai null", async () => {
    const spy = tangkapPATCH();
    await ubahCustomer({ ...input, name: "  Spa ti  ", tag: "   " });

    const { body } = argumenPATCH(spy);
    expect(body.name).toBe("Spa ti");
    expect(body.tag).toBeNull();
  });

  it("menolak nama kosong tanpa menyentuh server", async () => {
    const spy = tangkapPATCH();
    const hasil = await ubahCustomer({ ...input, name: "   " });

    expect(hasil.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("melaporkan PATCH yang tidak mengubah baris apa pun sebagai gagal", async () => {
    tangkapPATCH([]);
    const hasil = await ubahCustomer(input);

    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.judul ?? "").toMatch(/tidak ditemukan/i);
  });

  it("melaporkan error server sebagai gagal", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const hasil = await ubahCustomer(input);
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.judul).toContain("login");
  });

  /* PostgREST menjawab penolakan RLS dengan JSON berisi code/message/hint.
     Detail itu harus tetap ada — tapi di field `teknis`, bukan di `pesan`
     yang dibaca kasir. Kalau hilang, "izin belum dijalankan" vs "kolom tidak
     ada" jadi mustahil dibedakan. */
  it("menaruh code dan message PostgREST di field teknis", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        code: "42501",
        message: "new row violates row-level security policy for table customers",
      }),
    })) as unknown as typeof fetch;

    const hasil = await ubahCustomer(input);
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) {
      expect(hasil.teknis).toContain("403");
      expect(hasil.teknis).toContain("42501");
      expect(hasil.teknis).toContain("row-level security policy");
      /* Jargon tidak boleh masuk ke bagian yang dibaca kasir. */
      expect(hasil.pesan).not.toMatch(/row-level security/i);
      expect(hasil.judul ?? "").toContain("belum boleh");
    }
  });

  /* 23505 di aplikasi ini berarti `customers.name` bentrok — bukan error
     acak. Kasir diberi tahu nama yang bentrok dan apa yang harus
     dilakukan, bukan Postgres jargon. */
  it("409: menjelaskan nama yang sudah dipakai", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        code: "23505",
        message: 'duplicate key value violates unique constraint "customers_name_key"',
      }),
    })) as unknown as typeof fetch;

    const hasil = await ubahCustomer({ ...input, name: "Memet 22" });
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) {
      expect(hasil.judul).toBe("Nama itu sudah dipakai");
      expect(hasil.penjelasan).toContain("Memet 22");
      expect(hasil.teknis).toContain("23505");
    }
  });

  /* Tanpa catch, `fetch` yang gagal melempar jadi unhandled rejection:
     tidak ada pesan di layar, dan kasir hanya melihat reload mengembalikan
     data lamanya tanpa tahu kenapa. */
  it("menangani kegagalan jaringan tanpa melempar keluar", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    const hasil = await ubahCustomer(input);
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) {
      expect(hasil.judul ?? "").toContain("koneksi");
      expect((hasil.langkah ?? "").length).toBeGreaterThan(0);
    }
  });

  /* Body error dari proxy sering bukan JSON. Kalau `r.json()` lempar,
     pesan harus tetap terbaca — jangan jadi crash atau pesan kosong. */
  it("tetap memberi pesan saat body error bukan JSON", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("Unexpected token < in JSON");
      },
    })) as unknown as typeof fetch;

    const hasil = await ubahCustomer(input);
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect((hasil.judul ?? "").length).toBeGreaterThan(0);
  });
});