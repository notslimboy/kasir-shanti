#!/usr/bin/env python3
"""Rencana merge nama customer — ANALISIS SAJA, tidak menulis ke Supabase.

Yang dijawab script ini: kalau customers.csv jadi acuan nama kanonik,
customer mana yang hilang dan customer mana yang只剩 satu.

Jalankan: python3 scripts/rencana_merge_customer.py
"""
import csv
import json
import re
import unicodedata
from collections import defaultdict

AKUN_RAZIP = "backups/supabase-20261002-1344"
CSV = "customers.csv"


def normal(s: str) -> str:
    """Kunci pembanding: huruf kecil, tanpa tanda baca, tanpa spasi.

    `Mutiara C3 / 367` dan `Mutiara C3/367` harus jadi kunci yang sama —
    itu seluruh tujuan dari perbandingan ini.
    """
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


# Alias kata yang sering ditulis berbeda orang.
# `Mulyosari` → `Mulyo`, `Sutorejo` → `Suto`. Tanpa ini, customer yang sama
#terlihat sebagai dua orang di dua sumber.
VARIASI = [
    (r"mulyosari", "mulyo"),
    (r"sutorejo", "suto"),
    (r"wisper", "wisp"),
    (r"bhaskara", "bhas"),
]


def longgar(s: str) -> str:
    """Kunci pembanding longgar: sudah dinormalisasi, lalu disederhanakan
    satu tingkat lagi supaya salah ketik sepele tidak menyembunyikan orangnya.

    Prefix "ITS" sengaja TIDAK dihapus di sini. "ITS U 117" dan "U 117"
    memang customer yang sama, tapi membuang prefix itu juga menyamakan
    "M10" dengan "Mulyosari 10" - dua orang berbeda. Penanganan prefix
    ada di `alternate()`, dipanggil terpisah supaya bisa diuji. """
    k = normal(s)
    for pola, jadi in VARIASI:
        k = re.sub(pola, jadi, k)
    return k


def alternate(kunci: str) -> set[str]:
    """Semua kunci yang mungkin menunjuk customer yang sama untuk satu nama.

    Dua sumber sering menulis customer dengan awalan "ITS" atau tanpanya:
    `ITS U 117` vs `U 117`. Ini HANYA untuk MEMBANDINGKAN, supaya daftar
    yang perlu ditinjau orang jadi kecil - bukan untuk menulis. Penulisan
    tetap memakai nama yang sudah ada di database. """
    out = {kunci}
    if kunci.startswith("its"):
        out.add(kunci[3:])
    else:
        out.add("its" + kunci)
    return out


def main() -> None:
    csv_rows = list(csv.DictReader(open(CSV, encoding="utf-8")))
    sb = json.load(open(f"{AKUN_RAZIP}/customers.json", encoding="utf-8"))

    # ---------------------------- baca CSV ----------------------------
    # `aliases` dipisah tanda titik koma. Dipakai sebagai bahan Fallback:
    # kalau nama customer di CSV tidak cocok dengan apa pun, alias-nya
    # bisa saja yang dicatat sebagai nama utama di Supabase.
    csv_pakai: dict[str, dict] = {}
    csv_alias: dict[str, dict] = {}
    for r in csv_rows:
        csv_pakai[longgar(r["name"])] = r
        for a in (r.get("aliases") or "").split(";"):
            a = a.strip()
            if a:
                csv_alias.setdefault(longgar(a), r)

    # --------------------------- baca Supabase ---------------------------
    sb_pakai: dict[str, list[dict]] = defaultdict(list)
    for c in sb:
        sb_pakai[longgar(c["name"])].append(c)

    # ----------------------------- hasilnya -----------------------------
    cocok, tak_cocok, dobel = [], [], []

    for kunci, baris in sb_pakai.items():
        tujuan = next((csv_pakai[k] for k in alternate(kunci) if k in csv_pakai), None) \
            or next((csv_alias[k] for k in alternate(kunci) if k in csv_alias), None)
        if tujuan:
            cocok.append((baris, tujuan))
            if len(baris) > 1:
                dobel.append((baris, tujuan))
        else:
            tak_cocok.append(baris)

    print("=" * 72)
    print(f"customers.csv   : {len(csv_rows)} baris")
    print(f"Supabase        : {len(sb)} baris")
    print("=" * 72)
    print(f"Cocok           : {len(cocok)} nama")
    print(f"Customer dobel  : {len(dobel)} nama (>{1} baris di Supabase)")
    print(f"TIDAK ada di CSV: {len(tak_cocok)} nama")
    print()

    # Yang hilang dari Supabase = ada di Supabase tapi tidak match CSV.
    # Ini yang perlu dicek manual: bisa jadi format beda, bisa jadi
    # customer sungguhan yang belum masuk CSV.
    print("-" * 72)
    print("TIDAK ADA DI CSV — ini yang akan hilang kalau CSV jadi acuan")
    print("-" * 72)
    for grup in tak_cocok:
        for baris in grup:
            print(f"  {baris['name']!r}  (tag={baris.get('tag')}, ongkir={baris.get('default_shipping')})")
    print()

    print("-" * 72)
    print("CUSTOMER DOBEL di Supabase — perlu digabung")
    print("-" * 72)
    for baris, tujuan in dobel:
        nama = [b["name"] for b in baris]
        print(f"  {nama}  -> CSV: {tujuan['name']!r}")
    print()

    # Nama yang ada di CSV tapi belum ada di Supabase.
    punya_sb = set(sb_pakai)
    hilang = [r for k, r in csv_pakai.items() if k not in punya_sb]
    print("-" * 72)
    print(f"ADA DI CSV tapi tidak ada di Supabase — {len(hilang)} nama")
    print("(bakal ditambahkan, bukan dihapus)")
    print("-" * 72)
    for r in hilang:
        print(f"  {r['name']!r}  (tag={r['tag']})")
    print()

    json.dump(
        {
            "tak_cocok": tak_cocok,
            "dobel": [[b for b in baris] for baris, _ in dobel],
            "hilang": hilang,
        },
        open("/tmp/rencana_merge.json", "w", encoding="utf-8"),
        ensure_ascii=False,
        indent=1,
    )


if __name__ == "__main__":
    main()