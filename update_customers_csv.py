import urllib.request
import json
import csv
import re
import sqlite3
import pathlib

from scripts.parser_customer_reference import build_reference_rows

SUPABASE_URL = "https://ddfalsclevkqhiyojngx.supabase.co"
SUPABASE_KEY = "sb_publishable_Ve_QZUvSQgQSE9_LcEAHmw_WLaQDSrP"

CUSTOMER_TAG_ALIASES = {
    "gojek": "GOJEK",
    "pakuwoncity": "Pakuwon",
    "puriasri": "Pakuwon",
    "griyaasri": "Pakuwon",
    "villaroyal": "Pakuwon",
    "royal": "Pakuwon",
    "sandiego": "Pakuwon",
    "sanantonio": "Pakuwon",
    "westwood": "Pakuwon",
    "florence": "Pakuwon",
    "laguna": "Pakuwon",
    "mutiara": "Pakuwon",
    "kenejeran": "Kenjeran",
    "pantaimentari": "Pantai Mentari",
    "pantaimentri": "Pantai Mentari",
    "pantainmentari": "Pantai Mentari",
    "sahabudin": "Kenjeran",
    "tuwowo": "Kenjeran",
    "tohir": "Kenjeran",
    "babatan": "Kenjeran",
    "dupak": "Kenjeran",
    "dupakpecahbelah": "Kenjeran",
    "pecahbelah": "Kenjeran",
    "ngadi": "Kenjeran",
    "putroagung": "Kenjeran",
}

CUSTOMER_ITS_BLOCK_PATTERN = re.compile(
    r"\b(?:its\s*)?(?:perum\s*)?(?:blok\s*)?(?:(p1)\s*[/ -]?\s*\d+|([tuvwjdnxmrficahb])(?!\s*o\s*\d)\s*(?:lama\s*)?(?:[/.-]|\s)*[a-z]?\s*\d+)\b",
    re.IGNORECASE
)
CUSTOMER_GOJEK_PATTERN = re.compile(r"\bgo\s*jek\b|\bgojek\b", re.IGNORECASE)

CUSTOMER_ITS_FALLBACK_PATTERN = re.compile(
    r"\b(?:its|dptsi|bapkm|sdmo|dpsp|spkb|ftspk|wr\s*3|teknik|tek|t\s*lingkungan|lingku(?:ngan)?|arsitek(?:tur)?|bahasa|mesin|kimia|fisika|geofisika|statistika|mipa|instrumen(?:tasi)?|hidrodinamika|brin|nasdec|riset|research\s*center|gedung\s*riset|gedung\s*rc|rc\s*(?:lt|lantai)|perpus(?:takaan)?|manajemen\s*bisnis)\b",
    re.IGNORECASE
)

CUSTOMER_ADDRESS_TAG_RULES = [
    { "tag": "Sutorejo", "pattern": re.compile(r"\b(?:sutorejo|suto|sut)\s*(?:tengah|teng|tgh)\b|\bsutotengah\b|\bsutoteng\b|\bsutotgh\b", re.IGNORECASE) },
    { "tag": "Sutorejo", "pattern": re.compile(r"\b(?:sutorejo|suto|sut)\s*(?:selatan|sel)\b|\bsutoselatan\b|\bsutosel\b", re.IGNORECASE) },
    { "tag": "Sutorejo", "pattern": re.compile(r"\b(?:sutorejo|suto|sut)\s*(?:utara|ut)\b|\bsutoutara\b|\bsutout\b", re.IGNORECASE) },
    { "tag": "Sutorejo", "pattern": re.compile(r"\b(?:sutorejo|suto|sut)\s*(?:timur|tim)\b|\bsutotimur\b|\bsutotim\b", re.IGNORECASE) },
    { "tag": "Sutorejo", "pattern": re.compile(r"\bsutorejo\b|\bsuto\b|\banak\s*7\s*37\b|\bartha\s*catur\b", re.IGNORECASE) },
    { "tag": "BPD", "pattern": re.compile(r"\bbpd\b", re.IGNORECASE) },
    { "tag": "Mulyosari", "pattern": re.compile(r"\bmuly(?:o|osari)?\s*(?:tengah|tng|teng|tgh)\b|\bmulyotengah\b|\bmulyotng\b|\bmulyoteng\b|\bmulyotgh\b", re.IGNORECASE) },
    { "tag": "Mulyosari", "pattern": re.compile(r"\bmuly(?:o|osari)?\s*(?:utara|ut)\b|\bmulyoutara\b|\bmulyout\b", re.IGNORECASE) },
    { "tag": "Mulyosari", "pattern": re.compile(r"\bmulyosari\b|\bmulyo\b|\bmuly\b", re.IGNORECASE) },
    { "tag": "Wisper", "pattern": re.compile(r"\b(?:wisper|wis\s*per|spr)\b", re.IGNORECASE) },
    { "tag": "Bhaskara", "pattern": re.compile(r"\b(?:bhaskara|bhaska|bhas|bhsksari)\b|\bbu\s*bambang\s*gg\s*1\b|\bzainal\s*gg\s*3\b", re.IGNORECASE) },
    { "tag": "Kenjeran", "pattern": re.compile(r"\b(?:kenjeran|pantai\s*ment(?:ari|ri)|sahabudin|tuwowo|tohir|babatan|dupak(?:\s*pecah\s*belah)?|pecah\s*belah|ngadi|putro\s*agung)\b", re.IGNORECASE) },
    { "tag": "Keputih", "pattern": re.compile(r"\bkeputih\b|\bjoko\s*sukolilo\b", re.IGNORECASE) },
    { "tag": "Dharmahusada", "pattern": re.compile(r"\bdharmahusada\b", re.IGNORECASE) },
    { "tag": "Pakuwon", "pattern": re.compile(r"\bpakuwon\b|\b(?:puri|griya)\s*asri\b|\bvilla\s*royal\b|\broyal\s+[a-z]?\d\b|\bsan\s*(?:antonio|diego)\b|\bwestwood\b|\bflorence\b|\blaguna\b|\bmutiara\b|\bnenet\b", re.IGNORECASE) },
    { "tag": "Bumi Galaxy", "pattern": re.compile(r"\bbumi\s*galaxy\s*permai\b|\bbumigalaxypermai\b|\bgalaxy\s*permai\b|\bsma\s*5\s*ratna\s*juli\b|\bsma5ratnajuli\b", re.IGNORECASE) },
    { "tag": "Bumi Marina", "pattern": re.compile(r"\bbumi\s*marina\b", re.IGNORECASE) },
    { "tag": "Rungkut", "pattern": re.compile(r"\brungkut\b", re.IGNORECASE) },
    { "tag": "Manyar", "pattern": re.compile(r"\bmanyar\b", re.IGNORECASE) },
    { "tag": "Kalijudan", "pattern": re.compile(r"\bkalijudan\b", re.IGNORECASE) },
    { "tag": "Supit", "pattern": re.compile(r"\bsupit\b", re.IGNORECASE) },
]

def compact_customer_key(value):
    return re.sub(r"[^0-9a-z]+", "", str(value or "").lower().strip())

def normalize_customer_tag_text(value):
    return re.sub(r"[^0-9a-z]+", " ", str(value or "").lower()).strip()

def normalize_customer_tag(value):
    tag = str(value or "").strip()
    tag = " ".join(tag.split())
    return CUSTOMER_TAG_ALIASES.get(compact_customer_key(tag), tag)

def infer_customer_address_tag(name, aliases_list):
    raw_text = " ".join([name] + aliases_list)
    if not raw_text.strip():
        return ""
    tag_text = f"{normalize_customer_tag_text(raw_text)} {compact_customer_key(raw_text)}".strip()
    if CUSTOMER_GOJEK_PATTERN.search(tag_text):
        return "GOJEK"
    if CUSTOMER_ITS_FALLBACK_PATTERN.search(tag_text):
        return "ITS"
    for rule in CUSTOMER_ADDRESS_TAG_RULES:
        if rule["pattern"].search(tag_text):
            return rule["tag"]
    if CUSTOMER_ITS_BLOCK_PATTERN.search(tag_text):
        return "ITS"
    return ""

def resolve_customer_tag(name, aliases_list, tag=""):
    return normalize_customer_tag(tag) or infer_customer_address_tag(name, aliases_list)

def fetch_table(table_name):
    url = f"{SUPABASE_URL}/rest/v1/{table_name}?select=*"
    req = urllib.request.Request(
        url,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}"
        }
    )
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode("utf-8"))

def main():
    print("Menghubungkan ke Supabase...")
    try:
        customers = fetch_table("customers")
        aliases = fetch_table("customer_aliases")
        print(f"Berhasil menarik {len(customers)} customer dan {len(aliases)} alias dari Supabase.")
    except Exception as e:
        print(f"Error mengambil data dari Supabase: {e}")
        return 1

    # Map aliases and tags
    aliases_by_cust = {}
    tag_by_cust = {}
    for a in aliases:
        cid = str(a["customer_id"])
        alias = a.get("alias") or ""
        if alias.startswith("tagalamat:"):
            tag_by_cust[cid] = alias.replace("tagalamat:", "")
        else:
            aliases_by_cust.setdefault(cid, []).append(alias)

    # Sort customers by ID/Name
    customers.sort(key=lambda x: x.get("name", "").lower())

    # Supabase is authoritative. The parser rules may still contain legacy
    # overlays, but a compact rules file simply returns these rows unchanged.
    base_customer_rows = []
    for c in customers:
        cid = str(c["id"])
        customer_aliases = aliases_by_cust.get(cid, [])
        explicit_tag = tag_by_cust.get(cid, "")
        resolved_tag = resolve_customer_tag(c["name"], customer_aliases, explicit_tag)
        base_customer_rows.append({
            "id": cid,
            "name": c["name"],
            "default_shipping": str(c.get("default_shipping") or 0),
            "tag": resolved_tag,
            "aliases": ";".join(customer_aliases),
        })
    parser_reference, parser_warnings = build_reference_rows(
        base_customer_rows,
        pathlib.Path("instruksi_ai_parser.md"),
    )

    # Write to customers.csv
    csv_file = pathlib.Path("customers.csv")
    temp_csv_file = csv_file.with_suffix(".csv.tmp")
    try:
        with temp_csv_file.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=["id", "name", "default_shipping", "tag", "aliases"],
                lineterminator="\n",
            )
            writer.writeheader()
            writer.writerows(parser_reference)
        temp_csv_file.replace(csv_file)
    except Exception as e:
        temp_csv_file.unlink(missing_ok=True)
        print(f"Error menulis snapshot customer: {e}")
        return 1

    print(
        f"File CSV parser berhasil ditulis ke: {csv_file} "
        f"({len(parser_reference)} customer, {len(parser_warnings)} warning)"
    )
    for warning in parser_warnings:
        print(
            f"WARNING {warning['type']}: {warning['customer']} "
            f"({warning['detail']})"
        )

    # Also sync to local SQLite
    print("Sinkronisasi ke SQLite lokal (kasir-bento.sqlite3)...")
    conn = sqlite3.connect("kasir-bento.sqlite3")
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM customers")
        cursor.execute("DELETE FROM customer_aliases")

        customer_inserts = []
        for c in customers:
            cid = str(c["id"])
            tag = tag_by_cust.get(cid, "")
            customer_inserts.append((
                c["id"],
                c["name"],
                c["default_shipping"],
                c.get("last_order_at") or "",
                c.get("created_at") or "",
                c.get("updated_at") or "",
                c.get("deposit_balance") or 0,
                tag
            ))
        cursor.executemany("""
            INSERT INTO customers (id, name, default_shipping, last_order_at, created_at, updated_at, deposit_balance, tag)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, customer_inserts)

        alias_inserts = []
        for a in aliases:
            alias_inserts.append((
                a["id"],
                a["customer_id"],
                a["alias"],
                a.get("alias_key") or "",
                a.get("created_at") or ""
            ))
        cursor.executemany("""
            INSERT INTO customer_aliases (id, customer_id, alias, alias_key, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, alias_inserts)

        conn.commit()
        print("Database SQLite lokal berhasil disinkronkan.")
    except Exception as e:
        conn.rollback()
        print(f"Error sinkronisasi SQLite: {e}")
    finally:
        conn.close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
