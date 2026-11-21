#!/usr/bin/env python3
"""Read-only duplicate customer analysis for Supabase customers + customer_aliases.

Fetches via PostgREST GET, builds strong normalized keys, groups by union-find,
suggests a keeper per group, writes report CSV to orderan/laporan-customer-duplikat.csv
and conflict CSV to orderan/laporan-customer-ongkir-konflik.csv.
No writes to Supabase.
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from collections import defaultdict, Counter

# Allow import from sibling scripts
sys.path.insert(0, str(Path(__file__).parent))
from parser_customer_reference import normalize_key

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ddfalsclevkqhiyojngx.supabase.co")
REPORT_PATH = Path(__file__).resolve().parents[1] / "orderan" / "laporan-customer-duplikat.csv"
KONFLIK_PATH = Path(__file__).resolve().parents[1] / "orderan" / "laporan-customer-ongkir-konflik.csv"
TAGALAMAT_PREFIX = "tagalamat:"

# ── Abbreviation expansion maps ─────────────────────────────────────────────

# For key generation: abbreviation → canonical form
EXPANSIONS: dict[str, str] = {
    "mulyo": "mulyosari",
    "suto": "sutorejo",
    "sut": "sutorejo",
    "bhas": "bhaskara",
    "bhask": "bhaskara",
    "teng": "tengah",
    "tgh": "tengah",
    "tng": "tengah",
    "sel": "selatan",
    "ut": "utara",
    "tim": "timur",
    "wpt": "wisper",
    "tgl": "tegal",
    "gg": "gang",
}

# Tokens to drop entirely
DROPS: set[str] = {"no", "blok", "jl", "mc"}

ROMAN_MAP: dict[str, str] = {
    "i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5",
    "vi": "6", "vii": "7", "viii": "8", "ix": "9", "x": "10",
    "xi": "11", "xii": "12", "xiii": "13", "xiv": "14", "xv": "15",
    "xvi": "16", "xvii": "17", "xviii": "18", "xix": "19", "xx": "20",
}

# ── Canonical form weight map (for keeper scoring) ──────────────────────────
# How many bonus points for using the long form vs abbreviation
BOBOT_BAKU: dict[str, tuple[str, int]] = {
    "mulyosari": ("mulyosari", 2),
    "sutorejo": ("sutorejo", 2),
    "bhaskara": ("bhaskara", 2),
    "tengah": ("tengah", 1),
    "selatan": ("selatan", 1),
    "utara": ("utara", 1),
    "timur": ("timur", 1),
    "wisper": ("wisper", 1),
}


# ── Helper: load env key with .env.local fallback ───────────────────────────

def _load_key() -> str:
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if key:
        return key
    env_path = Path(__file__).resolve().parents[1] / ".env.local"
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("SUPABASE_KEY=") and not line.startswith("#"):
                raw = line[len("SUPABASE_KEY="):].strip().strip("\"'")
                if raw:
                    return raw
    raise RuntimeError(
        "SUPABASE_KEY tidak ditemukan di env atau .env.local. "
        "Set SUPABASE_KEY=sb_secret_... di environment."
    )


def _rest_get(table: str, key: str) -> list[dict]:
    """Fetch all rows from a Supabase table via PostgREST GET (Range: 0-9999)."""
    url = f"{SUPABASE_URL}/rest/v1/{table}?select=*"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Range": "0-9999",
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"HTTP {e.code} fetching {table}: {e.reason}\n{body[:500]}"
        ) from e


# ── Tokenization and strong key construction ───────────────────────────────

# Word-splitting on raw (un-normalized) name: alphabetic or digit sequences
_RAW_TOKEN_RE = re.compile(r"[A-Za-z]+|\d+")
_DIGIT_TOKEN_RE = re.compile(r"[a-z]+|\d+")

# Split names on these separators to extract sub-addresses
_NAME_PART_SPLIT_RE = re.compile(r"\s*[-–—,;]\s*")

# Detect ITS-style block address in normalized text
_ITS_PATTERN = re.compile(
    r"(?:its|blok)?\s*([a-z]{1,2})\s*[/\-]?\s*(\d{1,3})$", re.IGNORECASE
)

# Direction/area tokens that can be dropped for relaxed matching
_DIRECTION_TOKENS = frozenset({"tengah", "selatan", "utara", "timur", "barat"})


def _roman_to_digits(tok: str) -> str | None:
    """Return digit string if tok is a roman numeral I..XX, else None."""
    return ROMAN_MAP.get(tok.casefold())


def _expand_tokens(tokens: list[str]) -> list[str]:
    """Expand tokens using abbreviation + drops + roman maps.

    Handles MU specially: if 'mu' followed by a block+number pattern,
    expands to 'mulyosariutara<block><number>'.
    """
    expanded: list[str] = []
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        lower = tok.casefold()

        if lower in DROPS:
            i += 1
            continue

        # MU pattern: "mu" followed by block+number pattern
        # Check next tokens: mu [letter] [number] or mu [number] [number]
        if lower == "mu" and i + 2 < len(tokens):
            tok1 = tokens[i + 1].casefold()
            tok2 = tokens[i + 2].casefold()
            # MU <letter> <digits> or MU <digits> <digits>
            if tok1.isalpha() and tok2.isdigit() and len(tok1) == 1:
                # MU B 22 → mulyosariutara b 22
                expanded.append("mulyosariutara")
                expanded.append(tok1)
                expanded.append(tok2)
                i += 3
                continue
            elif tok1.isdigit() and tok2.isdigit() and len(tok1) <= 3 and len(tok2) <= 3:
                # MU 6 24 → mulyosariutara 6 24
                expanded.append("mulyosariutara")
                expanded.append(tok1)
                expanded.append(tok2)
                i += 3
                continue

        # Check roman numeral (only for alphabetic strings)
        if tok.isalpha():
            roman_digits = _roman_to_digits(tok)
            if roman_digits:
                expanded.append(roman_digits)
                i += 1
                continue

        # Check abbreviation expansion
        ex = EXPANSIONS.get(lower)
        if ex:
            expanded.append(ex)
            i += 1
            continue

        expanded.append(lower)
        i += 1

    return expanded


def _try_its_pattern(val: str) -> str | None:
    """If val matches ITS block pattern, return its form (e.g. 'itsu117'), else None."""
    m = _ITS_PATTERN.match(val)
    if m:
        block = m.group(1).lower()
        num = m.group(2)
        return f"its{block}{num}"
    return None


def _split_name_parts(raw: str) -> list[str]:
    """Split a name on separators to extract sub-addresses.

    Only splits on -/+ when followed by a space, to avoid splitting
    compound block numbers like B-22 or A6-1.
    Also splits on , and ; unconditionally.
    """
    # Replace - and – with spaces only when surrounded by spaces (standalone address separator)
    import re as _re
    processed = _re.sub(r"\s+[-–]\s+", "  |  ", raw)
    # Split on |, comma, semicolon
    parts = _re.split(r"\s*\|\s*|\s*,\s*|\s*;\s*", processed)
    return [p.strip() for p in parts if p.strip()]


def _key_ok(k: str) -> bool:
    """A key must be at least 3 chars and not purely digits."""
    if len(k) < 3:
        return False
    if k.isdigit():
        return False
    return True


def kunci_kuat(name: str, aliases: list[str] | None = None) -> set[str]:
    """Return a set of strong keys for a customer name + aliases."""
    keys: set[str] = set()
    candidates = [name]
    if aliases:
        candidates.extend(aliases)

    for raw in candidates:
        if not raw:
            continue

        # ── Strategy 0: process the unchanged raw string first ──
        # Catches cases like "WPT IX / JJ - 37" where - splits the address
        # but the whole string is one address
        raw0_tokens = _RAW_TOKEN_RE.findall(raw)
        if raw0_tokens:
            exp0 = _expand_tokens(raw0_tokens)
            if exp0:
                full0 = "".join(exp0)
                if _key_ok(full0):
                    keys.add(full0)
                relaxed0 = _drop_directions(exp0)
                if relaxed0 != full0 and _key_ok(relaxed0):
                    keys.add(relaxed0)

        # ── Process each sub-part of the name separately ──
        # Names like "Suto Tengah 13/45 - Sut Teng XIII/45" have two addresses
        for part in _split_name_parts(raw):
            # Strategy 1: tokenize the raw (un-normalized) part
            raw_tokens = _RAW_TOKEN_RE.findall(part)
            if raw_tokens:
                exp = _expand_tokens(raw_tokens)
                if exp:
                    full = "".join(exp)
                    if _key_ok(full):
                        keys.add(full)
                    # Also add a relaxed key with direction tokens dropped
                    relaxed = _drop_directions(exp)
                    if relaxed != full and _key_ok(relaxed):
                        keys.add(relaxed)

        # Strategy 2: normalized form (process full string as well)
        val = normalize_key(raw)
        if not val:
            continue

        # Check ITS block pattern
        its_key = _try_its_pattern(val)
        if its_key and _key_ok(its_key):
            keys.add(its_key)

        # Digit-aware tokenization of normalized form
        norm_tokens = _DIGIT_TOKEN_RE.findall(val)
        if norm_tokens:
            exp_norm = _expand_tokens(norm_tokens)
            if exp_norm:
                full = "".join(exp_norm)
                if _key_ok(full):
                    keys.add(full)
                relaxed = _drop_directions(exp_norm)
                if relaxed != full and _key_ok(relaxed):
                    keys.add(relaxed)

        # Also keep raw normalized as fallback if useful
        if _key_ok(val):
            keys.add(val)

    return keys


def _drop_directions(tokens: list[str]) -> str:
    """Drop direction tokens from expanded tokens for relaxed matching."""
    return "".join(t for t in tokens if t not in _DIRECTION_TOKENS)


# ── Keeper scoring ──────────────────────────────────────────────────────────

def _hitung_bobot_baku(name: str) -> int:
    """Count how many canonical forms appear in the normalized name."""
    val = normalize_key(name)
    score = 0
    for canon, (_, weight) in BOBOT_BAKU.items():
        if canon in val:
            score += weight
    return score


def _hitung_titlecase(name: str) -> int:
    """Score: count Title-Cased words minus ALL-CAPS words (>1 letter)."""
    words = re.findall(r"[A-Za-z]+", name)
    title_count = 0
    allcaps_count = 0
    for w in words:
        if len(w) <= 1:
            continue
        if w.isupper():
            allcaps_count += 1
        elif w[0].isupper() and w[1:].islower():
            title_count += 1
    return title_count - allcaps_count


def _hitung_its_score(name: str) -> int:
    """Prefer ITS <letter> <number> format over Blok or bare patterns.
    2 = ITS <letter> <number> or ITS <letter>/<number>
    1 = Blok <letter>...
    0 = bare (<letter><number> or <letter> / <number>)
    """
    val = normalize_key(name)
    if re.search(r"\bits", val):
        return 2
    if re.search(r"\bblok", val):
        return 1
    return 0


def skor_kandidat(
    idx: int,
    customers_raw: list[dict],
    alias_by_customer: dict,
    name: str,
) -> tuple:
    """Return a sortable tuple (highest = best keeper).
    Lexicographic priority:
      1. bobot_baku (higher better) — canonical form weight
      2. its_score (higher better)  — ITS vs Blok vs bare
      3. titlecase_score (higher better)
      4. alias_count (higher better)
      5. -id (lower id better)
    """
    bobot = _hitung_bobot_baku(name)
    its = _hitung_its_score(name)
    tc = _hitung_titlecase(name)
    cid_str = str(customers_raw[idx].get("id", ""))
    alias_count = len(alias_by_customer.get(cid_str, []))
    id_num = int(cid_str) if cid_str.isdigit() else 999999
    return (bobot, its, tc, alias_count, -id_num)


def deskripsi_skor(s: tuple) -> str:
    """Human-readable score string for alasan column."""
    return f"skor=({s[0]},{s[1]},{s[2]},{s[3]},{s[4]})"


# ── Union-Find ──────────────────────────────────────────────────────────────

class UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            self.parent[ra] = rb
        elif self.rank[ra] > self.rank[rb]:
            self.parent[rb] = ra
        else:
            self.parent[rb] = ra
            self.rank[ra] += 1


# ── Main ────────────────────────────────────────────────────────────────────

def main() -> int:
    key = _load_key()
    print("Memuat data dari Supabase …", file=sys.stderr)

    customers_raw = _rest_get("customers", key)
    aliases_raw = _rest_get("customer_aliases", key)

    print(f"  customers: {len(customers_raw)}", file=sys.stderr)
    print(f"  aliases:   {len(aliases_raw)}", file=sys.stderr)

    if not customers_raw:
        print("Tidak ada customer. Tidak ada analisis.", file=sys.stderr)
        return 0

    # Build alias lookup: customer_id -> [alias strings]
    alias_by_customer: dict[str, list[str]] = defaultdict(list)
    for a in aliases_raw:
        cid = str(a.get("customer_id", ""))
        alias_val = a.get("alias", "") or ""
        alias_key_val = a.get("alias_key", "") or ""
        if alias_val.startswith(TAGALAMAT_PREFIX) or alias_key_val.startswith(TAGALAMAT_PREFIX):
            continue
        if alias_val:
            alias_by_customer[cid].append(alias_val)
        if alias_key_val and alias_key_val != alias_val:
            alias_by_customer[cid].append(alias_key_val)

    n = len(customers_raw)
    uf = UnionFind(n)

    # Build (strong_key -> set of indices)
    key_to_idxs: dict[str, set[int]] = defaultdict(set)
    for idx, row in enumerate(customers_raw):
        cid = str(row.get("id", ""))
        name = row.get("name", "") or ""
        aliases = alias_by_customer.get(cid, [])
        for skey in kunci_kuat(name, aliases):
            key_to_idxs[skey].add(idx)

    # Union all indices that share any key
    for skey, idxs in key_to_idxs.items():
        if len(idxs) < 2:
            continue
        it = iter(idxs)
        first = next(it)
        for other in it:
            uf.union(first, other)

    # Gather groups
    groups: dict[int, list[int]] = defaultdict(list)
    for idx in range(n):
        groups[uf.find(idx)].append(idx)

    multi_groups = [(root, members) for root, members in groups.items() if len(members) >= 2]
    multi_groups.sort(key=lambda x: min(x[1]))

    print(f"\nGrup duplikat: {len(multi_groups)}", file=sys.stderr)

    report_rows: list[dict] = []
    konflik_rows: list[dict] = []
    total_hapus = 0
    total_ongkir_konflik = 0
    total_periksa = 0

    for gid, members in multi_groups:
        member_rows = [customers_raw[i] for i in members]

        # ── Compute scores for each member ──
        score_of: dict[int, tuple] = {}
        for i in members:
            name = customers_raw[i].get("name", "") or ""
            score_of[i] = skor_kandidat(i, customers_raw, alias_by_customer, name)

        # ── Deterministic keeper selection by score tuple ──
        sorted_members = sorted(members, key=lambda i: score_of[i], reverse=True)
        keeper_idx = sorted_members[0]
        hapus_idxs = sorted_members[1:]

        keeper_row = customers_raw[keeper_idx]
        keeper_name = keeper_row.get("name", "") or ""
        keeper_id = str(keeper_row.get("id", ""))

        # ── Ongkir analysis — NEVER resolve conflicts ──
        ongkir_values: list[tuple[str, str]] = []
        for i in members:
            row = customers_raw[i]
            raw_ongkir = row.get("default_shipping")
            o = str(raw_ongkir) if raw_ongkir is not None else ""
            rid = str(row.get("id", ""))
            ongkir_values.append((rid, o))

        # Normalize: treat "" and "None" as empty
        norm_set: set[str] = set()
        for _, v in ongkir_values:
            if v in ("", "None"):
                norm_set.add("")
            else:
                norm_set.add(v)
        ongkir_konflik = len(norm_set) > 1

        if ongkir_konflik:
            suggested_ongkir = ""  # Never resolve — leave empty
            total_ongkir_konflik += 1
        else:
            suggested_ongkir = next(iter(norm_set))

        # ── last_order_at → max ──
        last_times = [str(row.get("last_order_at") or "") for row in member_rows]
        valid_times = [t for t in last_times if t]
        max_last = max(valid_times) if valid_times else ""

        # ── Alasan for KEEP ──
        alasan_parts: list[str] = [deskripsi_skor(score_of[keeper_idx])]

        if ongkir_konflik:
            values_str = ", ".join(f"{rid}={ov}" for rid, ov in ongkir_values)
            alasan_parts.append(f"ONGKIR_KONFLIK: {values_str}")

        # ── Suspicious group detection ──
        # Check if any member shares only very short or numeric-only keys
        keeper_cid = str(keeper_row.get("id", ""))
        keeper_aliases = alias_by_customer.get(keeper_cid, [])
        keeper_keys = kunci_kuat(keeper_name, keeper_aliases)
        suspicious = False
        for i in members:
            if i == keeper_idx:
                continue
            other_name = customers_raw[i].get("name", "") or ""
            other_cid = str(customers_raw[i].get("id", ""))
            other_aliases = alias_by_customer.get(other_cid, [])
            other_keys = kunci_kuat(other_name, other_aliases)
            shared = other_keys & keeper_keys
            # A key is "strong" if >= 5 chars OR has both letter and digit
            strong_shared = {k for k in shared if len(k) >= 5 or (any(c.isalpha() for c in k) and any(c.isdigit() for c in k))}
            if not strong_shared:
                suspicious = True
                break

        if suspicious:
            alasan_parts.append("PERIKSA: key bersama pendek, cek manual")
            total_periksa += 1

        alasan_keep = "; ".join(alasan_parts)

        # ── Build report rows ──
        report_rows.append({
            "grup_id": str(gid),
            "aksi": "KEEP",
            "id_anggota": keeper_id,
            "name": keeper_name,
            "ongkir": suggested_ongkir,
            "tag": str(keeper_row.get("tag", "") or ""),
            "last_order": max_last,
            "alasan": alasan_keep,
        })

        # Hapus rows
        for hi in hapus_idxs:
            hrow = customers_raw[hi]
            hid = str(hrow.get("id", ""))
            hname = hrow.get("name", "") or ""
            hongkir = str(hrow.get("default_shipping") if hrow.get("default_shipping") is not None else "")
            htag = str(hrow.get("tag", "") or "")
            hlast = str(hrow.get("last_order_at") or "")

            reasons: list[str] = [deskripsi_skor(score_of[hi])]
            h_cid = str(hrow.get("id", ""))
            h_aliases = alias_by_customer.get(h_cid, [])
            h_keys = kunci_kuat(hname, h_aliases)
            k_cid = str(keeper_row.get("id", ""))
            k_aliases = alias_by_customer.get(k_cid, [])
            k_keys = kunci_kuat(keeper_name, k_aliases)

            shared = h_keys & k_keys
            if shared:
                reasons.append(f"key sama: {', '.join(sorted(shared)[:3])}")

            if not reasons:
                reasons.append("grup duplikat")

            report_rows.append({
                "grup_id": str(gid),
                "aksi": "HAPUS",
                "id_anggota": hid,
                "name": hname,
                "ongkir": hongkir,
                "tag": str(htag),
                "last_order": hlast,
                "alasan": "; ".join(reasons),
            })

        total_hapus += len(hapus_idxs)

        # ── Konflik rows ──
        if ongkir_konflik:
            konflik_rows.append({
                "grup_id": str(gid),
                "id_keeper": keeper_id,
                "nama_keeper": keeper_name,
                "detail_ongkir": "; ".join(f"{rid}={ov}" for rid, ov in ongkir_values),
            })

        # ── Stdout ──
        ongkir_label = f"ongkir={suggested_ongkir}" + (" (KONFLIK)" if ongkir_konflik else "")
        print(f"  Grup #{gid}: {keeper_id} {keeper_name} [{ongkir_label}] KEEP", file=sys.stderr)
        for hi in hapus_idxs:
            hrow = customers_raw[hi]
            hid = str(hrow.get("id", ""))
            hname = hrow.get("name", "") or ""
            hongkir = str(hrow.get("default_shipping") if hrow.get("default_shipping") is not None else "")
            print(f"           {hid} {hname} ongkir={hongkir} HAPUS", file=sys.stderr)

    # ── Write report CSVs ──
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with REPORT_PATH.open("w", encoding="utf-8", newline="") as f:
        fieldnames = ["grup_id", "aksi", "id_anggota", "name", "ongkir", "tag", "last_order", "alasan"]
        writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(report_rows)

    if konflik_rows:
        with KONFLIK_PATH.open("w", encoding="utf-8", newline="") as f:
            fieldnames = ["grup_id", "id_keeper", "nama_keeper", "detail_ongkir"]
            writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
            writer.writeheader()
            writer.writerows(konflik_rows)

    # ── Final summary ──
    print(f"\nRingkasan:", file=sys.stderr)
    print(f"  Total customer:        {len(customers_raw)}", file=sys.stderr)
    print(f"  Total alias rows:      {len(aliases_raw)}", file=sys.stderr)
    print(f"  Grup duplikat:         {len(multi_groups)}", file=sys.stderr)
    print(f"  Baris untuk dihapus:   {total_hapus}", file=sys.stderr)
    print(f"  Grup ONGKIR_KONFLIK:   {total_ongkir_konflik}", file=sys.stderr)
    print(f"  Grup PERIKSA:          {total_periksa}", file=sys.stderr)
    print(f"  Laporan:               {REPORT_PATH}", file=sys.stderr)
    if konflik_rows:
        print(f"  Laporan konflik:       {KONFLIK_PATH}", file=sys.stderr)

    # Compact summary to stdout
    print(f"customers={len(customers_raw)} aliases={len(aliases_raw)} groups={len(multi_groups)} to_delete={total_hapus} ongkir_conflict={total_ongkir_konflik} periksa={total_periksa}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())