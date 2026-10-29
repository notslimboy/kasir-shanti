import { SUPABASE_URL, headerRest } from "@/supabase/client";
import type { SalePaymentRow, SaleRow } from "@/supabase/types";
import { penyesuaianDeposit, sisaPiutang } from "./piutang";
import { paidSetelahBatal, pilihCustomer, type CustomerDeposit } from "./customer-deposit";

/* ==========================================================================
   Menulis piutang ke Supabase.

   Dua operasi, sama seperti versi lama:

     catatPembayaranPiutang  → menambah `sale_payments` + menaikkan
                                `sales.paid_amount` sebesar sisa yang tertangani
     batalkanLunasPiutang    → menghapus `sale_payments` struk itu, mengembalikan
                                `paid_amount` ke 0, dan reversing efek deposit

   Dua aturan yang WAJIB dijaga, karena keduanya menentukan saldo deposit:

   1. Yang masuk `sale_payments` adalah nominal yang DIKETIK, bukan sisa.
      Kalau kasir bayar Rp 120.000 untuk sisa Rp 100.000, `paid_amount` naik
      hanya 100.000 dan Rp 20.000 dicatat sebagai deposit customer.
   2. `paid_amount` tidak pernah boleh melebihi `total`. Struk yang sudah
      lunas tidak boleh menambah pembayaran — supaya tidak ada "utang negatif"
      yang tersembunyi di Piutang.

   Tulis memakai fetch langsung ke PostgREST, sama seperti lib/supabase-tulis.ts,
   karena supabase-js di sini hanya dipakai untuk SELECT.
   ========================================================================== */

export type HasilPiutang =
  | { ok: true; /** Sisa tagihan setelah pembayaran ini. */ sisa: number; /** Uang yang masuk deposit. */ deposit: number }
  | { ok: false; pesan: string };

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

function headersTulis(): Record<string, string> {
  return { ...headerRest(), "Content-Type": "application/json", Prefer: "return=representation" };
}

async function ambilStruk(saleId: number): Promise<SaleRow> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/sales`);
  url.searchParams.set("select", "id,total,paid_amount,customer_name,receipt_no");
  url.searchParams.set("id", `eq.${saleId}`);
  const r = await fetch(url, { headers: headerRest() });
  if (!r.ok) throw new Error(`sales: HTTP ${r.status}`);
  const rows = (await r.json()) as SaleRow[];
  if (!rows[0]) throw new Error("Transaksi tidak ditemukan di server.");
  return rows[0];
}

/**
 * Tambah deposit customer.
 *
 * Customer dicari lewat `pilihCustomer`: nama persis, nama ternormalisasi,
 * lalu tabel alias. Versi lama hanya mencoba `name=eq.<nama>` persis, jadi
 * pembayaran atas nama yang ditulis berbeda — "Memet 22" untuk baris yang
 * tercatat "Jl. Memet S No 22" — tidak ketemu dan Instead membuat baris
 * customer baru. Itu memecah deposit orang yang sebenarnya sama dan menambah
 * satu duplikat lagi ke tabel customer.
 *
 * Kalau memang tidak ada, baris baru tetap dibuat: memblokirnya akan berarti
 * kasir tidak bisa mencatat pembayaran untuk orang yang belum pernah order,
 * dan itu lebih buruk.
 */
async function tambahDeposit(nama: string, jumlah: number): Promise<void> {
  if (!nama || jumlah <= 0) return;

  const customer = await cariCustomerUntukDeposit(nama);
  if (customer) {
    await patch(`customers?id=eq.${customer.id}`, {
      deposit_balance: n(customer.deposit_balance) + jumlah,
      updated_at: new Date().toISOString(),
    });
    return;
  }
  const buat = await fetch(`${SUPABASE_URL}/rest/v1/customers`, {
    method: "POST",
    headers: headersTulis(),
    body: JSON.stringify({ name: nama, deposit_balance: jumlah, last_order_at: "" }),
  });
  /* `customers.name` punya constraint UNIQUE. Kalau baris dengan nama itu
     sebenarnya ada tetapi tidak ketemu di langkah sebelumnya — misalnya
    kebijakan SELECT tidak berlaku sementara POST berlaku — POST-nya ditolak
     dengan 409. Itu bukan kegagalan: baris yang sama sudah ada, jadi deposit
     ditambahkan ke sana, persis seperti cabang di atas. */
  if (buat.ok) return;
  if (buat.status === 409) {
    const ulang = await cariCustomerUntukDeposit(nama);
    if (ulang) {
      await patch(`customers?id=eq.${ulang.id}`, {
        deposit_balance: n(ulang.deposit_balance) + jumlah,
        updated_at: new Date().toISOString(),
      });
      return;
    }
  }
  throw new Error(`customers: HTTP ${buat.status}`);
}

/** Data customer secukupnya untuk menulis deposit, dengan resolusi alias. */
async function cariCustomerUntukDeposit(nama: string): Promise<CustomerDeposit | null> {
  const params = new URLSearchParams({ select: "id,name,deposit_balance" });
  const r = await fetch(`${SUPABASE_URL}/rest/v1/customers?${params}`, { headers: headerRest() });
  if (!r.ok) throw new Error(`customers: HTTP ${r.status}`);
  const customers = (await r.json()) as CustomerDeposit[];

  /* Alias hanya perlu dibaca kalau nama persis tidak ditemukan. Satu
     request untuk seluruh tabel alias Typis kecil, dan tabelnya jarang
     berubah. */
  if (customers.some((c) => String(c.name ?? "").trim() === String(nama).trim())) {
    return pilihCustomer(nama, customers, []);
  }

  const paramsAlias = new URLSearchParams({ select: "customer_id,alias" });
  const ra = await fetch(`${SUPABASE_URL}/rest/v1/customer_aliases?${paramsAlias}`, {
    headers: headerRest(),
  });
  const aliases = ra.ok ? ((await ra.json()) as { customer_id: number; alias: string }[]) : [];
  return pilihCustomer(nama, customers, aliases);
}

async function patch(path: string, body: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: headersTulis(),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gagal menyimpan ke server (${r.status}).`);
}

/**
 * Catat pembayaran (penuh maupun cicilan).
 *
 * `amount` adalah nominal yang diketik kasir, BUKAN sisa tagihan. Nominal itu
 * dipotong dulu untuk pembayaran, sisanya masuk deposit.
 */
export async function catatPembayaranPiutang(
  saleId: number,
  amount: number,
  note = "Pembayaran cicilan manual",
): Promise<HasilPiutang> {
  const nominal = Math.floor(n(amount));
  if (nominal <= 0) return { ok: false, pesan: "Nominal pembayaran tidak valid." };

  try {
    const sale = await ambilStruk(saleId);
    const sisaSebelum = sisaPiutang(sale);
    if (sisaSebelum <= 0) return { ok: false, pesan: "Transaksi ini sudah lunas." };

    /* Berapa yang benar-benar mengurangi utang, dan sisanya jadi deposit. */
    const untukUtang = Math.min(nominal, sisaSebelum);
    const untukDeposit = nominal - untukUtang;

    /* Catatan pembayaran menyimpan KEJADIAN, bukan sisa. Kalau yang ditulis
       cuma sisa, riwayat pembayaran jadi tidak bisa menjelaskan deposit —
       dan pembatalan tidak akan bisa menghitung penyesuaiannya. */
    const catatan = untukDeposit > 0
      ? `${note}: Bayar Rp ${nominal.toLocaleString("id-ID")} (Kelebihan Rp ${untukDeposit.toLocaleString("id-ID")} masuk deposit)`
      : note;

    const insert = await fetch(`${SUPABASE_URL}/rest/v1/sale_payments`, {
      method: "POST",
      headers: headersTulis(),
      body: JSON.stringify({
        sale_id: saleId,
        amount: nominal,
        payment_date: new Date().toISOString(),
        note: catatan,
      }),
    });
    if (!insert.ok) throw new Error(`sale_payments: HTTP ${insert.status}`);

    /* Id baris yang baru dibuat, dipakai untuk membatalkan diri sendiri kalau
       langkah berikutnya gagal. Tanpa ini, kasir melihat "Gagal" lalu menekan
       ulang — dan pembayarannya tercatat dua kali. */
    const dibuat = ((await insert.json()) as { id?: number }[])?.[0];
    const idPembayaran = dibuat?.id ?? null;

    try {
      await patch(`sales?id=eq.${saleId}`, { paid_amount: n(sale.paid_amount) + untukUtang });
      await tambahDeposit(String(sale.customer_name ?? ""), untukDeposit);
    } catch (e) {
      /* Pembayaran sudah tercatat sebelum langkah ini gagal. Kembalikan lagi —
         pembayaran setengah jadi lebih buruk daripada tidak ada: kasir mengira
         gagal lalu menekan ulang. Yang dikembalikan persis ke nilai sebelum,
         jadi percobaan berikutnya membaca keadaan yang bersih. */
      if (idPembayaran !== null) {
        await fetch(`${SUPABASE_URL}/rest/v1/sale_payments?id=eq.${idPembayaran}`, {
          method: "DELETE",
          headers: headersTulis(),
        }).catch(() => {});
        await patch(`sales?id=eq.${saleId}`, { paid_amount: n(sale.paid_amount) }).catch(() => {});
      }
      return {
        ok: false,
        pesan: `Pembayaran tidak disimpan dan tidak ada yang berubah: ${(e as Error).message}`,
      };
    }

    return { ok: true, sisa: Math.max(0, sisaSebelum - untukUtang), deposit: untukDeposit };
  } catch (e) {
    return { ok: false, pesan: (e as Error).message };
  }
}

/**
 * Tandai lunas dari Detail Struk / Ubah Data: cicil tepat sebanyak sisa,
 * tanpa deposit.
 *
 * Kasir menerima uangnya di luar aplikasi (chat, bawaan) lalu hanya ingin
 * status struk berubah — mengetik nominalnya lagi di Piutang dua kali kerja.
 * Nominal yang ditulis ke `sale_payments` tetap sisa tagihan, jadi riwayat
 * pembayarannya bisa dibalikkan lewat `batalkanLunasPiutang` seperti
 * pembayaran apa pun.
 */
export async function lunasKanPiutang(
  saleId: number,
  note = "Pelunasan dicatat dari Detail Struk",
): Promise<HasilPiutang> {
  let sale: SaleRow;
  try {
    sale = await ambilStruk(saleId);
  } catch (e) {
    return { ok: false, pesan: (e as Error).message };
  }
  const sisa = sisaPiutang(sale);
  if (sisa <= 0) return { ok: false, pesan: "Transaksi ini sudah lunas." };
  return catatPembayaranPiutang(saleId, sisa, note);
}

/**
 * Total `paid_amount` setelah pembatalan, dihitung dari baris `sale_payments`
 * yang masih ada di server.
 *
 * Jalur pembatalan sekarang menghapus SEMUA pembayaran struk itu, jadi
 * angkanya 0 — dan itu memang jawaban yang benar: membatalkan pelunasan
 * berarti pembayarannya dibatalkan, bukan dipotong sebagian.
 *
 * Yang penting: angkanya dibaca dari server, bukan `0` yang ditulis
 * hardcode. Kalau pembatalan suatu saat jadi sebagian, `paid_amount` ikut
 * dihitung dari sisa pembayaran yang benar-benar ada.
 */
async function paymentsYangTersisa(saleId: number, idDihapus: number[]): Promise<number> {
  const params = new URLSearchParams({ select: "id,amount", sale_id: `eq.${saleId}` });
  const r = await fetch(`${SUPABASE_URL}/rest/v1/sale_payments?${params}`, { headers: headerRest() });
  if (!r.ok) throw new Error(`sale_payments: HTTP ${r.status}`);
  const baris = (await r.json()) as { id: number; amount: number }[];
  return paidSetelahBatal(baris, new Set(idDihapus), (b) => Number(b.id));
}

/** Kembalikan transaksi ke "Belum lunas": hapus riwayat + reversing deposit. */
export async function batalkanLunasPiutang(saleId: number): Promise<HasilPiutang> {
  try {
    const sale = await ambilStruk(saleId);

    const payments = new URL(`${SUPABASE_URL}/rest/v1/sale_payments`);
    payments.searchParams.set("select", "id,amount,note");
    payments.searchParams.set("sale_id", `eq.${saleId}`);
    const r = await fetch(payments, { headers: headerRest() });
    if (!r.ok) throw new Error(`sale_payments: HTTP ${r.status}`);
    const baris = (await r.json()) as SalePaymentRow[];

    /* Deposit dikoreksi DULUAN. Kalau hapus pembayaran berhasil lalu update
       deposit gagal, customer kehilangan Rp-nya tanpa ada jejaknya — dan
       pembatalan tidak bisa diulang karena riwayatnya sudah hilang. */
    const adjust = penyesuaianDeposit(baris);
    if (adjust !== 0) await geserDeposit(String(sale.customer_name ?? ""), adjust);

    const hapus = await fetch(`${SUPABASE_URL}/rest/v1/sale_payments?sale_id=eq.${saleId}`, {
      method: "DELETE",
      headers: headerRest(),
    });
    if (!hapus.ok) throw new Error(`sale_payments: HTTP ${hapus.status}`);

    /* `paid_amount` dihitung dari pembayaran yang TIDAK ikut terhapus.
       Versi lama menulis `paid_amount: 0`, sehingga struk yang sudah dibayar
       separuh kehilangan catatan pembayarannya begitu pembatalannya ditekan —
       dan tidak ada lagi yang bisa merekonstruksinya. */
    const tersisa = await paymentsYangTersisa(saleId, baris.map((b) => Number(b.id)));
    await patch(`sales?id=eq.${saleId}`, { paid_amount: tersisa });

    const total = n(sale.total);
    return { ok: true, sisa: total, deposit: 0 };
  } catch (e) {
    return { ok: false, pesan: (e as Error).message };
  }
}

/**
 * Geser saldo deposit. Posisi = bertambah, negatif = berkurang, dan saldo
 * tidak pernah boleh turun di bawah nol.
 *
 * Customer dicari dengan `pilihCustomer`, sama seperti `tambahDeposit`: nama
 * persis, nama ternormalisasi, lalu alias. Versi lama hanya mencoba
 * `name=eq.<nama>` — jadi kalau nama customer di struk beda spasi atau beda
 * ejaan dari yang tercatat, depositnya tidak dikoreksi. Efeknya lebih ringan
 * daripada di `tambahDeposit` (tidak ada customer baru, jadi tidak ada duplikat
 * baru), tapi deposit yang seharusnya dikembalikan tetap tertinggal di kasir.
 *
 * Customer yang benar-benar tidak ada tetap dilewati diam-diam: pembatalan lunas
 * tidak boleh gagal hanya karena orangnya belum masuk tabel customers. Yang
 * sudah berubah setelah pembatalan tidak bisa diulang — riwayatnya sudah
 * dihapus — jadi lebih baik depositnya tidak dikembalikan daripada
 * pembatalannya seluruhnya ditolak.
 */
async function geserDeposit(nama: string, posisi: number): Promise<void> {
  if (!nama || posisi === 0) return;
  const customer = await cariCustomerUntukDeposit(nama);
  if (!customer) return;
  await patch(`customers?id=eq.${customer.id}`, {
    deposit_balance: Math.max(0, n(customer.deposit_balance) + posisi),
    updated_at: new Date().toISOString(),
  });
}