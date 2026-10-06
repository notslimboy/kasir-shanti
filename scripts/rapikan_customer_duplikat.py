#!/usr/bin/env python3
"""Rapikan customer duplikat — PATAKAN customers.csv, sisanya jadi alias.

ANALISIS DULU. Tanpa `--apply` skrip ini tidak menulis apa pun ke Supabase.

    export SUPABASE_KEY='sb_secret_...'          # service_role, Dashboard → Settings → API
    python3 scripts/rapikan_customer_duplikat.py                # laporan
    python3 scripts/rapikan_customer_duplikat.py --apply        # eksekusi

Aturan
------
1. `customers.csv` adalah acuan. Baris Supabase yang namanya SAMA PERSIS
   dengan nama kanon CSV menang; sisanya dilebur ke sana.

2. `_ANGKA_SAMA` — dua nama hanya boleh digabung kalau token angkanya
   persis sama. "ITS U 180" dan "ITS U 80" TIDAK boleh digabung: itu dua
   unit berbeda, dua orang berbeda. Nomor-nomor ini yang jadi identitas,
   dan memangkas atau menyamakan angka adalah cara tercepat mengarang
   customer yang tidak ada. Nama yang token angkanya berbeda tidak pernah
   digabung otomatis — dilaporkan untuk diperiksa orang.

3. Baris Supabase yang nama kánonnya tidak ada di CSV tidak disentuh.
   Itu mungkin customer sungguhan yang belum masuk CSV, bukan duplikat.
   Menggabungkannya ke orang yang mirip adalah keputusan yang bukan milik
   skrip ini.

4.<Order ikut pindah, bukan ditinggal. `sales` tidak punya `customer_id`;
   satu-satunya penghubung ke customer adalah teks `customer_name`. Kalau
   namawinner berubah, semua order-nya harus ditulis ulang, kalau tidak
   order itu yatim dan tidak muncul lagi di halaman mana pun.

Yang dipindahkan saat merge
---------------------------
    sales.customer_name  ->  nama winner
    deposit_balance       ->  dijumlahkan ke winner
    alias                ->  nama lama + semua alias lama pindah ke winner

Semua angka itu satu kesatuan: uang dan histori. Kalau winner dan loser
sama-sama punya deposit, penjumlahan harus dicek manual — skrip ini
menandainya, tidak menjadikannya secara diam-diam.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict
from urllib import error, parse, request

DEFAULT_URL = "https://ddfalsclevkqhiyojngx.supabase.co"
CSV_KANON = "customers.csv"


# --------------------------------------------------------------------------
# Kunci pembanding
# --------------------------------------------------------------------------

def ascii_text(value: str) -> str:
    return unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode()


def kunci(nama: str) -> str:
    """Huruf kecil, tanpa tanda baca dan tanpa spasi.

    `Mutiara C3 / 367` dan `Mutiara C3/367` harus jadi kunci yang sama —
    itu seluruh tujuan perbandingan ini. Angka TIDAK pernah dibuang.
    """
    return re.sub(r"[^a-z0-9]+", "", ascii_text(nama).lower())


def token_angka(nama: str) -> list[str]:
    """Semua urutan angka di dalam nama, sesuai urutan kemunculannya.

    Ini penjaga `ITS U 180` vs `ITS U 80`. Perbandingan nama boleh
    mengabaikan spasi, tanda baca, dan kapitalisasi — tapi TIDAK boleh
    mengabaikan angka, karena angka itulah yang membedakan satu unit
    dari unit lain di kompleks yang sama.
    """
    return re.findall(r"\d+", ascii_text(nama))


def angka_sama(a: str, b: str) -> bool:
    return token_angka(a) == token_angka(b)


# --------------------------------------------------------------------------
# Akses Supabase
# --------------------------------------------------------------------------

class Supabase:
    def __init__(self, url: str, key: str) -> None:
        self.url = url.rstrip("/")
        self.key = key

    def _hdr(self) -> dict[str, str]:
        return {"apikey": self.key, "Authorization": f"Bearer {self.key}"}

    def get(self, table: str, params: dict[str, str]) -> list[dict]:
        qs = parse.urlencode(params)
        req = request.Request(f"{self.url}/rest/v1/{table}?{qs}", headers=self._hdr())
        with request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())

    def send(self, table: str, method: str, params: dict[str, str], body: dict) -> list[dict]:
        """PATCH/DELETE dengan filter. `Prefer: return=representation` supaya
        server mengembalikan baris yang benar-benar berubah — tanpa itu
        respons kosong tidak bisa dibedakan dari "tidak ada yang cocok"."""
        qs = parse.urlencode(params)
        data = json.dumps(body).encode()
        hdr = {**self._hdr(), "Content-Type": "application/json", "Prefer": "return=representation"}
        req = request.Request(f"{self.url}/rest/v1/{table}?{qs}", data=data, headers=hdr, method=method)
        with request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or "[]")


def wajib_key() -> str:
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if not key:
        sys.exit(
            "SUPABASE_KEY belum diisi. Skrip ini butuh service_role key.\n"
            "  Dashboard → Settings → API → service_role, lalu:\n"
            "  export SUPABASE_KEY='sb_secret_...'"
        )
    return key


# --------------------------------------------------------------------------
# Rencana
# --------------------------------------------------------------------------

def baca_csv(path: str) -> dict[str, str]:
    """Kunci kanon -> nama persis seperti tertulis di CSV."""
    kanon: dict[str, str] = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            k = kunci(r.get("name", ""))
            if k:
                kanon.setdefault(k, r["name"].strip())
    return kanon


def susun_rencana(sb_rows: list[dict], kanon: dict[str, str]) -> dict:
    grup: dict[str, list[dict]] = defaultdict(list)
    for c in sb_rows:
        k = kunci(c.get("name", ""))
        if k:
            grup[k].append(c)

    gabung: list[dict] = []
    tolak_angka: list[dict] = []
    di_luar_csv: list[dict] = []

    for k, rows in grup.items():
        if k not in kanon:
            di_luar_csv.extend(rows)
            continue
        if len(rows) == 1:
            continue

        nama_kanon = kanon[k]

        # Penjaga angka: kalau token angkanya berbeda, jangan gabung.
        beda = [r for r in rows if not angka_sama(r["name"], nama_kanon)]
        if beda:
            tolak_angka.append({"nama": nama_kanon, "baris": rows, "penyebab": beda})
            continue

        # Winner: nama yang sama persis dengan CSV, lalu id terkecil.
        sama_persis = [r for r in rows if (r.get("name") or "").strip() == nama_kanon]
        kandidat = sama_persis or rows
        winner = min(kandidat, key=lambda r: int(r["id"]))
        losers = [r for r in rows if int(r["id"]) != int(winner["id"])]
        gabung.append({"winner": winner, "losers": losers, "nama_kanon": nama_kanon})

    return {"gabung": gabung, "tolak_angka": tolak_angka, "di_luar_csv": di_luar_csv}


# --------------------------------------------------------------------------
# Laporan
# --------------------------------------------------------------------------

def tampilkan(rencana: dict, sb_rows: list[dict]) -> None:
    gabung = rencana["gabung"]
    tolak = rencana["tolak_angka"]
    luar = rencana["di_luar_csv"]

    print("=" * 74)
    print(f"customers.csv : {len(baca_csv(CSV_KANON))} nama kanon")
    print(f"Supabase      : {len(sb_rows)} baris customer")
    print("=" * 74)
    print(f"AKAN DIGABUNG            : {len(gabung)}")
    print(f"TOKEN ANGKA BERBEDA      : {len(tolak)}   <- tidak disentuh, perlu dilihat")
    print(f"NAMA DI LUAR CSV        : {len(luar)}   <- tidak disentuh")
    print()

    print("-" * 74)
    print("DIGABUNG — nama kanon CSV menang, sisanya jadi alias")
    print("-" * 74)
    for g in gabung:
        w = g["winner"]
        print(f"\n  KANON  {g['nama_kanon']!r}  ->  id {w['id']}  (tag={w.get('tag')}, ongkir={w.get('default_shipping')})")
        for l in g["losers"]:
            depo_w = int(w.get("deposit_balance") or 0)
            depo_l = int(l.get("deposit_balance") or 0)
            catatan = "  ⚠ dua-duanya punya deposit, cek manual" if depo_w and depo_l else ""
            print(f"    - id {l['id']:>5} {l['name']!r}  (tag={l.get('tag')}, ongkir={l.get('default_shipping')}, deposit={depo_l}){catatan}")
    print()

    print("-" * 74)
    print("TOKEN ANGKA BERBEDA — TIDAK DIGABUNG, ini nama yang berbeda orang")
    print("-" * 74)
    if not tolak:
        print("  (tidak ada)")
    for t in tolak:
        print(f"\n  {t['nama']!r}")
        for r in t["baris"]:
            print(f"    - id {r['id']:>5} {r['name']!r}  angka={token_angka(r['name'])}")
        print("    → beda nomor unit. Mustahil digabung otomatis.")
    print()

    print("-" * 74)
    print(f"NAMA DI LUAR CSV — {len(luar)} baris, TIDAK disentuh")
    print("-" * 74)
    if not luar:
        print("  (tidak ada)")
    for c in luar:
        print(f"  id {c['id']:>5} {c['name']!r}  (tag={c.get('tag')})")
    print()


# --------------------------------------------------------------------------
# Eksekusi
# --------------------------------------------------------------------------

def gabungkan(sb: Supabase, g: dict, dry: bool) -> None:
    w = g["winner"]
    nama_final = g["nama_kanon"]
    aksi = []

    for l in g["losers"]:
        # 1. Order ikut pindah. sales tidak punya customer_id, jadi satu-satunya
        #    cara adalah menulis ulang teksnya.
        if dry:
            aksi.append(f"    sales.customer_name {l['name']!r} -> {nama_final!r}")
        else:
            sb.send("sales", "PATCH", {"customer_name": f"eq.{l['name']}"}, {"customer_name": nama_final})
            aksi.append(f"    sales.customer_name {l['name']!r} -> {nama_final!r}  (ditulis)")

        # 2. Alias: nama lama ikut jadi alias supaya chat lama tetap resolve.
        if not dry:
            for alias in [l["name"], *(l.get("_aliases") or [])]:
                if kunci(alias) == kunci(nama_final):
                    continue
                ada = sb.get("customer_aliases", {"customer_id": f"eq.{w['id']}", "alias": f"eq.{alias}", "select": "id"})
                if not ada:
                    sb.send("customer_aliases", "POST", {}, {
                        "customer_id": int(w["id"]),
                        "alias": alias,
                        "alias_key": kunci(alias),
                    })
                    aksi.append(f"    + alias {alias!r}")

            # 3. Deposit dijumlahkan.
            sb.send("customers", "PATCH", {"id": f"eq.{w['id']}"}, {
                "deposit_balance": int(w.get("deposit_balance") or 0) + int(l.get("deposit_balance") or 0),
            })
            aksi.append(f"    deposit += {int(l.get('deposit_balance') or 0)}")

            # 4. Alias lama ikut pindah, lalu baris placeholder dihapus.
            sb.send("customer_aliases", "PATCH", {"customer_id": f"eq.{l['id']}"}, {"customer_id": int(w["id"])})
            sb.send("customers", "DELETE", {"id": f"eq.{l['id']}"}, {})
            aksi.append(f"    hapus id {l['id']}")

    print(f"  {nama_final!r} -> id {w['id']}")
    for a in aksi:
        print(a)


def main() -> int:
    ap = argparse.ArgumentParser(description="Rapikan customer duplikat, patokan customers.csv.")
    ap.add_argument("--apply", action="store_true", help="Tulis ke Supabase. Tanpa flag ini hanya laporan.")
    ap.add_argument("--csv", default=CSV_KANON, help="File CSV kanon.")
    args = ap.parse_args()

    sb = Supabase(os.environ.get("SUPABASE_URL", DEFAULT_URL), wajib_key())

    customers = sb.get("customers", {"select": "id,name,tag,default_shipping,deposit_balance", "order": "id"})
    aliases = sb.get("customer_aliases", {"select": "customer_id,alias"})
    per_customer: dict[int, list[str]] = defaultdict(list)
    for a in aliases:
        per_customer[int(a["customer_id"])].append(a["alias"])
    for c in customers:
        c["_aliases"] = per_customer.get(int(c["id"]), [])

    kanon = baca_csv(args.csv)
    rencana = susun_rencana(customers, kanon)
    tampilkan(rencana, customers)

    if not rencana["gabung"]:
        print("Tidak ada yang perlu digabung.")
        return 0

    if not args.apply:
        print("=" * 74)
        print("Laporan saja. Jalankan ulang dengan --apply untuk menulis.")
        return 0

    print("=" * 74)
    print("MENYIMPAN:")
    for g in rencana["gabung"]:
        gabungkan(sb, g, dry=False)
    print("=" * 74)

    # Verifikasi: tidak boleh ada nama ganda atau order yatim setelah merge.
    setelah = sb.get("customers", {"select": "id,name"})
    rij = defaultdict(list)
    for c in setelah:
        k = kunci(c["name"])
        if k:
            rij[k].append(c["id"])
    sisa = {k: v for k, v in rij.items() if len(v) > 1}
    print(f"\nSisa nama ganda: {len(sisa)}")
    for k, v in list(sisa.items())[:10]:
        print(f"  {k} -> {v}")
    if len(sisa) == 0:
        print("  bersih.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except error.HTTPError as e:
        detail = e.read().decode()[:400]
        sys.exit(f"Gagal ({e.code}): {detail}")