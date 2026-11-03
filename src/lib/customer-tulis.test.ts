import { afterEach, describe, expect, it, vi } from "vitest";

import { idNumerikCustomer } from "@/lib/page-data";
import { tagCustomer, ubahCustomer } from "@/lib/supabase-tulis";

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

/* ==========================================================================
   tagCustomer
   ========================================================================== */

/* Helper: daftar customer palsu. */
const CUSTOMER_LIST = [
  { id: 42, name: "Anis BTH", tag: null },
  { id: 99, name: "Bambang", tag: "Sutorejo" },
];

/* Helper: build mock fetch that handles GET /customers (list), PATCH, POST. */
function mockCustomerFetch(options: {
  /** Daftar customer yang dikembalikan GET /rest/v1/customers?select=id,name,tag */
  daftar?: { id: number; name: string; tag: string | null }[];
  /** Apakah POST berhasil (201) atau gagal (409) */
  postConflict?: boolean;
}) {
  const panggilan: { method: string; url: string; body?: unknown }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const bodyStr = typeof init?.body === "string" ? init.body : "{}";
    panggilan.push({ method, url, body: bodyStr ? JSON.parse(bodyStr) : undefined });
    if (method === "GET" && url.includes("select=id,name,tag")) {
      return {
        ok: true,
        status: 200,
        json: async () => (options.daftar ?? CUSTOMER_LIST),
      };
    }
    if (method === "PATCH" && url.includes("/rest/v1/customers?id=eq.")) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: 1 }],
      };
    }
    if (method === "POST") {
      if (options.postConflict) {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            code: "23505",
            message: 'duplicate key value violates unique constraint "customers_name_key"',
          }),
        };
      }
      return {
        ok: true,
        status: 201,
        json: async () => [{ id: 999 }],
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return panggilan;
}

describe("tagCustomer", () => {
  afterEach(() => {
    globalThis.fetch = ASLI_FETCH;
    vi.restoreAllMocks();
  });

  it("customer ada → PATCH tag", async () => {
    const panggilan = mockCustomerFetch({});
    const hasil = await tagCustomer("Anis BTH", "Pakuwon");

    expect(hasil.ok).toBe(true);
    /* GET daftar dulu, lalu PATCH. */
    const patch = panggilan.find((p) => p.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(patch!.url).toContain("/rest/v1/customers?id=eq.42");
    expect((patch!.body as Record<string, unknown>).tag).toBe("Pakuwon");
  });

  it("customer tidak ada → POST dibuat dengan tag", async () => {
    const panggilan = mockCustomerFetch({ daftar: [] });
    const hasil = await tagCustomer("Baru Coba", "GOJEK");

    expect(hasil.ok).toBe(true);
    const post = panggilan.find((p) => p.method === "POST");
    expect(post).toBeTruthy();
    const body = post!.body as Record<string, unknown>;
    expect(body.name).toBe("Baru Coba");
    expect(body.tag).toBe("GOJEK");
    expect(body.deposit_balance).toBe(0);
    expect(body.default_shipping).toBe(0);
  });

  it("POST 409 → cari ulang + PATCH tag", async () => {
    /* Skenario: GET pertama tidak menemukan "Anis BTH" (belum ada),
       POST gagal 409 karena request lain mendaftarkannya duluan,
       GET kedua menemukan barisnya lalu PATCH tag-nya. */
    const panggilan: { method: string; url: string; body?: unknown }[] = [];
    let getKe = 0;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const bodyStr = typeof init?.body === "string" ? init.body : "{}";
      panggilan.push({ method, url, body: bodyStr ? JSON.parse(bodyStr) : undefined });
      if (method === "GET" && url.includes("select=id,name,tag")) {
        getKe++;
        /* Pertama: daftar kosong (customer belum ada). Kedua: sudah ada. */
        const daftar = getKe === 1 ? [] : CUSTOMER_LIST;
        return {
          ok: true, status: 200,
          json: async () => daftar,
        };
      }
      if (method === "PATCH") {
        return { ok: true, status: 200, json: async () => [{ id: 1 }] };
      }
      if (method === "POST") {
        return {
          ok: false, status: 409,
          json: async () => ({
            code: "23505",
            message: 'duplicate key value violates unique constraint "customers_name_key"',
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const hasil = await tagCustomer("Anis BTH", "ITS");

    expect(hasil.ok).toBe(true);
    const getDaftar = panggilan.filter((p) => p.method === "GET" && p.url.includes("select=id,name,tag"));
    expect(getDaftar.length).toBe(2);
    const patch = panggilan.find((p) => p.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(patch!.url).toContain("/rest/v1/customers?id=eq.42");
    expect((patch!.body as Record<string, unknown>).tag).toBe("ITS");
  });

  it("nama kosong → tidak ada request", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    const hasil = await tagCustomer("  ", "Sutorejo");

    expect(hasil.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});