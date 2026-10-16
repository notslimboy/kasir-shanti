#!/usr/bin/env python3
"""Tandai penjualan jadi BELUM LUNAS untuk satu rentang tanggal.

Padanan massal dari aksi "Belum lunas" di halaman Piutang, yang memanggil
`batalkanLunasPiutang` satu struk demi satu struk. Urutannya sama dan itu
penting:

  1. deposit dikoreksi lebih dulu — kalau riwayat pembayaran dihapus duluan
     lalu koreksi deposit gagal, uang customer hilang tanpa jejak dan tidak
     bisa diulang karena riwayatnya sudah tidak ada;
  2. `sale_payments` struk itu dihapus;
  3. `paid_amount` diisi jumlah pembayaran yang TERSISA (nol), bukan angka nol
     yang ditulis hardcode — sama seperti aplikasinya.

Yang TIDAK dilakukan script ini: mengubah harga, item, atau struk terhapus.
Status "lunas" di app diturunkan dari `paid_amount >= total`, jadi menolkan
`paid_amount` sudah cukup untuk mengubah statusnya.

Butuh kredensial nyata; publishable key tidak bisa menulis karena RLS ditutup:

    export SUPABASE_KEY=sb_secret_...   # service_role

Jalankan:

    python3 scripts/tandai_belum_lunas.py                       # dry-run
    python3 scripts/tandai_belum_lunas.py --dari 2026-08-01     # dry-run
    python3 scripts/tandai_belum_lunas.py --dari 2026-08-01 --tulis

Dry-run hanya membaca dan melaporkan; tanpa `--tulis` tidak ada satu byte pun
yang berubah.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, ".")
from update_customers_csv import supabase_key, _KEY_BELUM_DIATUR  # noqa: E402

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ddfalsclevkqhiyojngx.supabase.co")

# WIB. `completed_at` disimpan UTC, jadi batas tanggal harus digeser dulu —
# tanpa ini, transaksi 1 Agustus pukul 01.00 WIB (31 Juli 18.00 UTC) lolos
# dari rentangnya.
WIB_OFFSET = "+07:00"

BATAS_PER_POTONGAN = 100


# --------------------------------------------------------------------------
# Kredensial
# --------------------------------------------------------------------------


def kunci_dari_env_file():
    """`SUPABASE_KEY` dari .env.local / .env.

    Script ini jalan di terminal, jadi ia boleh membaca file yang gitignored —
    dan itu lebih baik daripada key ditempel di chat atau di command line, di
    mana ia ikut tercatat di riwayat shell. Yang dibaca hanya satu variabel;
    file-nya tidak dieksekusi.
    """
    for nama in (".env.local", ".env"):
        if not os.path.exists(nama):
            continue
        with open(nama, encoding="utf-8") as f:
            for baris in f:
                baris = baris.strip()
                if not baris or baris.startswith("#") or "=" not in baris:
                    continue
                k, v = baris.split("=", 1)
                if k.strip() == "SUPABASE_KEY":
                    return v.strip().strip("'\"")
    return ""


def kunci():
    key = os.environ.get("SUPABASE_KEY", "").strip() or kunci_dari_env_file()
    if not key:
        # Pesannya milik modul bersama supaya hanya ada satu penjelasan.
        supabase_key()
    return key


# --------------------------------------------------------------------------
# REST
# --------------------------------------------------------------------------


def rest(path, method="GET", body=None, prefer=None):
    """Satu permintaan ke PostgREST. Melempar kalau server menolak."""
    key = kunci()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer

    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}", data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(req) as response:
            isi = response.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        pesan = e.read().decode("utf-8", "replace")
        if e.code in (401, 403):
            raise RuntimeError(
                f"Supabase menolak {path} (HTTP {e.code}). "
                "SUPABASE_KEY belum diisi atau bukan service_role key.\n" + _KEY_BELUM_DIATUR
            ) from e
        raise RuntimeError(f"{method} {path} gagal (HTTP {e.code}): {pesan}") from e
    return json.loads(isi) if isi else None


def potong(daftar, ukuran):
    for i in range(0, len(daftar), ukuran):
        yield daftar[i : i + ukuran]


# --------------------------------------------------------------------------
# Aturan deposit — salinan dari src/lib/piutang.ts `penyesuaianDeposit`
# --------------------------------------------------------------------------


def penyesuaian_deposit(payments):
    """Seberapa besar saldo deposit harus dikoreksi saat pembatalan.

    Pembayaran ber-note "Otomatis Potong Deposit" mengambil uang dari deposit,
    jadi harus dikembalikan. Pembayaran yang menyebut "Kelebihan Rp ..." pernah
    MENAMBAH deposit, jadi kelebihannya harus dikeluarkan lagi.
    """
    adjust = 0
    for p in payments:
        note = p.get("note") or ""
        amount = p.get("amount") or 0
        if note == "Otomatis Potong Deposit":
            adjust += amount
            continue
        cocok = re.search(r"Kelebihan Rp\s*(\d+)", note.replace(".", "").replace(",", ""))
        if cocok:
            adjust -= int(cocok.group(1))
    return adjust


def kunci_nama(nama):
    return re.sub(r"\s+", " ", (nama or "").strip()).lower()


def rp(nilai):
    """Rp 1.234.567 — pemisah ribuan titik, sama seperti struk dan CSV."""
    return "Rp " + f"{int(nilai):,}".replace(",", ".")


def peta_customer(customers, aliases):
    """Nama persis dan alias -> customer. Sama seperti `pilihCustomer`."""
    persis = {c["name"]: c for c in customers}
    normal = {kunci_nama(c["name"]): c for c in customers}
    lewat_alias = {}
    for a in aliases:
        c = next((x for x in customers if x["id"] == a["customer_id"]), None)
        if c:
            lewat_alias.setdefault(kunci_nama(a["alias"]), c)
    return persis, normal, lewat_alias


def cari_customer(nama, peta):
    persis, normal, lewat_alias = peta
    if nama in persis:
        return persis[nama]
    return normal.get(kunci_nama(nama)) or lewat_alias.get(kunci_nama(nama))


# --------------------------------------------------------------------------
# Alur
# --------------------------------------------------------------------------


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dari", default="2026-08-01", help="tanggal awal, format YYYY-MM-DD (default 2026-08-01)")
    p.add_argument("--sampai", default=None, help="tanggal akhir, format YYYY-MM-DD (default: sekarang)")
    p.add_argument("--tulis", action="store_true", help="benar-benar menulis; tanpa ini hanya melapor")
    args = p.parse_args()

    dari = f"{args.dari}T00:00:00{WIB_OFFSET}"
    sampai = f"{args.sampai}T23:59:59{WIB_OFFSET}" if args.sampai else datetime.now(timezone.utc).isoformat()

    # Diperiksa di depan: script yang sudah setengah jalan lalu berhenti karena
    # kredensialnya kurang akan meninggalkan status yang campur aduk.
    try:
        kunci_terpakai = kunci()
    except RuntimeError as e:
        print(e)
        return 1
    if kunci_terpakai.startswith("sb_publishable_"):
        print(
            "Key yang dipakai key publishable. RLS menolaknya (401) — bahkan untuk\n"
            "membaca. Ambil service_role key dari Dashboard → Project Settings →\n"
            "API Keys, taruh di .env.local sebagai SUPABASE_KEY=..."
        )
        return 1

    print(f"Rentang : {dari}  →  {sampai}")
    print(f"Mode    : {'TULIS' if args.tulis else 'DRY-RUN (tidak menulis apa pun)'}")

    query = urllib.parse.urlencode(
        [
            (
                "select",
                "id,receipt_no,completed_at,total,paid_amount,deleted_at,customer_name",
            ),
            # Dua batas dengan nama kolom yang sama: itulah cara PostgREST
            # menulis rentang, dan `urlencode` menerima daftar pasangan.
            ("completed_at", f"gte.{dari}"),
            ("completed_at", f"lte.{sampai}"),
            ("order", "completed_at.asc"),
        ]
    )
    sales = rest(f"sales?{query}")
    print(f"Struk di rentang: {len(sales)}")

    # Hanya yang masih punya uang tercatat. Struk yang sudah belum lunas tidak
    # disentuh sama sekali — mengulang script ini harus tidak mengubah apa pun.
    target = [s for s in sales if (s.get("paid_amount") or 0) > 0]
    print(f"Struk lunas/sebagian yang akan diubah: {len(target)}")
    if not target:
        print("Tidak ada yang perlu diubah.")
        return 0

    ids = [s["id"] for s in target]
    payments_by_sale = {}
    for bagian in potong(ids, BATAS_PER_POTONGAN):
        q = urllib.parse.urlencode(
            {"select": "id,sale_id,amount,note", "sale_id": f"in.({','.join(str(i) for i in bagian)})"}
        )
        for baris in rest(f"sale_payments?{q}") or []:
            payments_by_sale.setdefault(baris["sale_id"], []).append(baris)

    customers = rest("customers?select=id,name,deposit_balance")
    aliases = rest("customer_aliases?select=customer_id,alias")
    peta = peta_customer(customers, aliases)

    total_dibayar = sum((s.get("paid_amount") or 0) for s in target)
    total_pembayaran = sum(len(payments_by_sale.get(i, [])) for i in ids)
    total_deposit = 0
    tanpa_customer = []
    persiapan = []

    for s in target:
        baris = payments_by_sale.get(s["id"], [])
        adjust = penyesuaian_deposit(baris)
        cust = cari_customer(s.get("customer_name") or "", peta)
        if adjust != 0:
            total_deposit += adjust
            if cust is None:
                tanpa_customer.append((s["receipt_no"], s.get("customer_name"), adjust))
                adjust = 0  # dilaporkan, tidak ditebak
        persiapan.append({"sale": s, "payments": baris, "adjust": adjust, "customer": cust})

    print()
    print(f"Uang yang berubah jadi piutang : {rp(total_dibayar)}")
    print(f"Baris sale_payments dihapus    : {total_pembayaran}")
    print(f"Koreksi deposit (bersih)       : {rp(total_deposit)}")
    for receipt, nama, adjust in tanpa_customer:
        print(
            f"  ! {receipt} — customer '{nama}' tidak ada di tabel customers; "
            f"deposit {rp(adjust)} TIDAK dikoreksi"
        )

    print()
    print("Contoh 10 struk:")
    for item in persiapan[:10]:
        s = item["sale"]
        print(
            f"  {s['receipt_no']}  {str(s['completed_at'])[:19]}  "
            f"total {s['total']:>9}  dibayar {s['paid_amount']:>9}  "
            f"→ belum lunas{'  (deposit ' + str(item['adjust']) + ')' if item['adjust'] else ''}"
        )

    if not args.tulis:
        print()
        print("Dry-run selesai. Ulangi dengan --tulis untuk menulis.")
        return 0

    print()
    berhasil = 0
    for item in persiapan:
        s = item["sale"]
        sale_id = s["id"]
        try:
            # 1. Deposit dulu — urutannya dibalik berarti kerugian yang tidak
            #    bisa diulang begitu riwayat pembayarannya hilang.
            if item["adjust"] != 0 and item["customer"] is not None:
                saldo = max(0, (item["customer"].get("deposit_balance") or 0) + item["adjust"])
                rest(
                    f"customers?id=eq.{item['customer']['id']}",
                    method="PATCH",
                    body={"deposit_balance": saldo},
                    prefer="return=minimal",
                )
                item["customer"]["deposit_balance"] = saldo

            # 2. Riwayat pembayaran.
            rest(f"sale_payments?sale_id=eq.{sale_id}", method="DELETE", prefer="return=minimal")

            # 3. `paid_amount` = pembayaran yang tersisa. Semuanya baru saja
            #    dihapus, jadi angkanya nol — tapi tetap dibaca dari server,
            #    bukan ditulis nol: kalau pembatalan suatu saat jadi sebagian,
            #    angkanya ikut benar dengan sendirinya.
            sisa = rest(f"sale_payments?select=amount&sale_id=eq.{sale_id}") or []
            rest(
                f"sales?id=eq.{sale_id}",
                method="PATCH",
                body={"paid_amount": sum((b.get("amount") or 0) for b in sisa)},
                prefer="return=minimal",
            )
            berhasil += 1
        except Exception as e:
            print(f"  ! gagal pada {s['receipt_no']}: {e}")
            print("    Sisa struk tidak diproses supaya keadaannya tidak makin bercampur.")
            return 1

    print(f"Selesai: {berhasil} struk sekarang berstatus Belum Lunas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
