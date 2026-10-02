#!/usr/bin/env python3
"""Isi tag customer yang kosong di Supabase.

Hanya mengisi `tag` yang NULL/kosong. TIDAK menghapus, TIDAK mengganti nama,
TIDAK menyentuh sales. Kalau Rules tidak bisa menebak, tag dibiarkan kosong
dan dilaporkan — menebak salah area lebih buruk daripada kosong.

Jalankan:
    python3 scripts/tag_customer_supabase.py          # dry-run, tidak menulis
    python3 scripts/tag_customer_supabase.py --tulis  # benar-benar menulis
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from collections import Counter

sys.path.insert(0, ".")
from update_customers_csv import infer_customer_address_tag, normalize_customer_tag

SUPABASE_URL = "https://ddfalsclevkqhiyojngx.supabase.co"
SUPABASE_KEY = "sb_publishable_Ve_QZUvSQgQSE9_LcEAHmw_WLaQDSrP"
AKUN_RAZIP = "backups/supabase-20261002-1344"


def panggil(method: str, path: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        SUPABASE_URL + "/rest/v1/" + path,
        data=data,
        method=method,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": "Bearer " + SUPABASE_KEY,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tulis", action="store_true", help="tulis ke Supabase")
    args = ap.parse_args()

    customers = json.load(open(f"{AKUN_RAZIP}/customers.json", encoding="utf-8"))
    alias = json.load(open(f"{AKUN_RAZIP}/customer_aliases.json", encoding="utf-8"))

    # Alias dikelompokkan per customer_id supaya `infer_customer_address_tag`
    # bisa melihat semua nama yang dikenal untuk customer itu. Tanpa ini
    # orang seperti "BU BAMBANG GG 1" (yang tag-nya ada di alias) akan
    # terlihat tidak dikenali.
    per_customer: dict[int, list[str]] = {}
    for a in alias:
        per_customer.setdefault(a["customer_id"], []).append(a["alias"])

    kosong = [c for c in customers if not str(c.get("tag") or "").strip()]
    print(f"Total customer    : {len(customers)}")
    print(f"Tag sudah ada     : {len(customers) - len(kosong)}")
    print(f"Tag kosong        : {len(kosong)}")
    print()

    rencana = []
    tak_tertebak = []
    for c in kosong:
        alias_na = per_customer.get(c["id"], [])
        tag = normalize_customer_tag(infer_customer_address_tag(c["name"], alias_na))
        if tag:
            rencana.append({"id": c["id"], "name": c["name"], "tag_baru": tag})
        else:
            tak_tertebak.append({"id": c["id"], "name": c["name"]})

    print(f"Berhasil ditebak  : {len(rencana)}")
    print(f"Tidak bisa ditebak: {len(tak_tertebak)}")
    print()

    print("Distribusi tag baru:")
    for tag, n in Counter(r["tag_baru"] for r in rencana).most_common():
        print(f"  {tag:18} {n}")
    print()

    if tak_tertebak:
        print("TIDAK BISA DITEBAK — dibiarkan kosong, tidak ditebak asal:")
        for r in tak_tertebak:
            print(f"  {r['name']!r}")
        print()

    print("Contoh 15 hasil:")
    for r in rencana[:15]:
        print(f"  {r['name']!r:45} -> {r['tag_baru']}")
    print()

    json.dump(
        {"rencana": rencana, "tak_tertebak": tak_tertebak},
        open("/tmp/tag_rencana.json", "w", encoding="utf-8"),
        ensure_ascii=False,
        indent=1,
    )

    if not args.tulis:
        print("DRY-RUN. Tidak ada yang ditulis. Jalankan dengan --tulis untuk menerapkan.")
        return

    print(f"Menulis {len(rencana)} tag ke Supabase...")
    gagal = 0
    for i, r in enumerate(rencana, 1):
        try:
            panggil("PATCH", f"customers?id=eq.{r['id']}", {"tag": r["tag_baru"]})
        except Exception as e:  # noqa: BLE001
            gagal += 1
            print(f"  GAGAL id={r['id']} {r['name']!r}: {e}")
        if i % 25 == 0:
            print(f"  {i}/{len(rencana)}")
    print(f"Selesai. Gagal: {gagal}")


if __name__ == "__main__":
    main()