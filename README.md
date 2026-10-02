# Kasir Shanti

Aplikasi kasir (POS) untuk Shanti Catering, ditambah perangkat parsing order
WhatsApp. Dua bagian yang saling melengkapi dalam satu repo:

| Bagian | Isi |
|---|---|
| `src/`, `e2e/` | Aplikasi kasir — Vite + React 19 + TypeScript, data di Supabase |
| `instruksi_ai_parser.md`, `scripts/`, `_forAI/`, `recognizer-kit/` | Parser order WhatsApp → CSV |

Keduanya gagal kalau dipisah: parser menghasilkan CSV yang harus bisa
dibaca aplikasi, dan aplikasi butuh data customer yang sama dengan yang
dipakai parser.

## Deploy

Hosted di **Vercel** sebagai SPA statis. Repo ini **bukan** GitHub Pages —
versi lama (vanilla JS + service worker) tetap di sana dan codebase-nya
sudah tidak disentuh.

Setting yang wajib di Vercel:

```
Root Directory : /            (root repo — bukan subfolder)
Build Command  : npm run build
Output         : dist
Branch         : feat/next-stack
```

`vercel.json` berisi rewrite `/(.*)` → `/index.html`. Tanpa itu, `/kasir`
yang dibuka langsung akan 404 — klik dari sidebar tetap jalan, jadi
errornya mudah hilang saat testing manual.

### Sebelum deploy: RLS Supabase

Aplikasi ini **tidak punya login sama sekali**. Semua orang yang punya URL
bisa membaca, mengubah, dan menghapus data.izu RLS di Supabase **wajib**
ditutup sebelum aplikasi ini terbit publik — `DELETE /customers` dengan
anon key akan menghapus seluruh data customer dan order.

Env opsional (`clients fallback ke nilai yang tertulis di `src/supabase/client.ts`):

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

## Menjalankan

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
npm run verify     # typecheck + unit + E2E
```

Test:

```bash
npm test           # 430 unit test
npm run e2e        # 35 E2E + audit a11y
```

E2E memakai `vite preview`, bukan dev server — supaya yang diuji adalah
hasil build yang memang dilayani hosting, bukan perilaku HMR.

## Data customer

Parser membaca `customers.csv` sebagai referensi aktif. **File itu tidak
ada di repo** — isinya 327 nama dan alamat customer sungguhan, jadi
gitignored. Bentuk kolomnya ada di [`customers.csv.example`](customers.csv.example).

Membuat ulang:

```bash
python3 update_customers_csv.py      # menarik dari Supabase → customers.csv
```

Parsing rutin tidak boleh menjalankan sinkronisasi ini atau menunggu
jaringan. Maintenance customer adalah pekerjaan terpisah.

## Parser order WhatsApp

Aturan parsing ada di [`instruksi_ai_parser.md`](instruksi_ai_parser.md).
Dokumen itu adalah sumber utama — dokumen lain mengikutinya, bukan
menggantikannya.

Agent yang mengerjakan parsing wajib membaca, dalam urutan ini:

1. [`instruksi_ai_parser.md`](instruksi_ai_parser.md) — aturan utama
2. [`_forAI/PARSER_RUNTIME_COMPACT.md`](_forAI/PARSER_RUNTIME_COMPACT.md) — ringkasan runtime
3. [`_forAI/ORDER_PARSING_GUARDRAILS.md`](_forAI/ORDER_PARSING_GUARDRAILS.md) — checklist wajib
4. `recognizer-kit/fixtures/evaluation-cases.md` — hanya untuk evaluasi recognizer

Prinsipnya: **Python menyaring, AI mengaudit.** Script lokal tidak boleh
membaca chat mentah ke dalam konteks model.

```bash
python3 scripts/prepare_order_parse_context.py --help
python3 scripts/allocate_limited_stock.py --help
```

Hasilnya masuk ke `orderan/hasil-parser/<rentang>/` (gitignored) — file
kandidat, bukan order final. Urutan `allocate_limited_stock.py` baru
dipanggil setelah identitas, revisi, dan pembatalan AI selesai.

File `Chat1.txt` / `Chat2.txt` juga gitignored: isinya percakapan pribadi
customer dan hanya dipakai sebagai input lokal.

## Struktur

```
src/                    aplikasi kasir
e2e/                    E2E Playwright + audit a11y
scripts/                script Python untuk parser
_forAI/                 pengetahuan agent untuk parsing
recognizer-kit/         tempat evaluasi recognizer
legacy/                 dokumentasi stack lama — tidak Describes repo ini
instruksi_ai_parser.md  aturan parsing utama
update_customers_csv.py sinkronisasi customers.csv dari Supabase
DESIGN.md               design system aplikasi
```

## Yang belum ada

- **Belum ada autentikasi.** Lihat bagian RLS di atas.
- **Belum ada test parsing.** 430 unit test yang ada semuanya logika
  aplikasi; `prepare_order_parse_context.py` belum punya test.
- **`legacy/PROJECT_TECHNICAL_CONTEXT.md` menjelaskan stack lama**
  (`server.py`, SQLite, `script.js`) dan tidak menggambarkan repo ini.
  Dipakai sebagai rujukan historis saja.