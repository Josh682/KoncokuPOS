# AGENTS.md — Koncoku POS (Cafe & Roastery Edition)

## 1. Identitas & Misi Sistem
**Koncoku POS** adalah aplikasi *Point of Sale* (POS) dan audit inventori berarsitektur **Local-First SPA + Edge Serverless** untuk operasional bisnis Cafe & Roastery (menjual minuman siap saji, *roasted beans*, bahan baku, *snack*, dan alat seduh kopi).
- **Target Biaya Operasional:** $\text{Rp } 0\text{ / bulan}$ (*Forever-Free Tier* di Cloudflare Pages, Workers, D1, R2, dan Telegram Bot API), namun $100\%$ siap dipindahkan ke VPS (*Portable*).

## 2. Enam Hukum Invarian Bisnis (DILARANG DILANGGAR)
1. **Zero-Latency Cashier Read ($< 10\text{ ms}$):** Pencarian produk dan perpindahan kategori di layar kasir **DILARANG** memanggil HTTP API ke server. Seluruh pembacaan katalog dan *auto-complete* pelanggan wajib bersumber dari `IndexedDB (Dexie.js)` di browser lokal.
2. **Zero-Trust Client Pricing:** Server **DILARANG** mempercayai `subtotal` atau `total_amount` kiriman *frontend*. Saat *checkout*, *backend* wajib menghitung ulang harga dari tabel `products` di D1 dan mengunci `sell_price_snapshot` serta `cost_price_snapshot` (HPP).
3. **Append-Only Financial Ledger:** Tabel `transactions`, `transaction_items`, dan `inventory_logs` bersifat **Immutable** (dilarang menjalankan `DELETE` atau mengubah nominal lewat `UPDATE`). Pembatalan struk (*Void*) wajib mengubah status menjadi `VOIDED` dan menyisipkan baris jurnal balik (*reversal entry*) bernilai positif (`VOID_RETURN`) pada `inventory_logs`.
4. **Integer Currency Only:** Seluruh nilai mata uang (Rupiah) wajib disimpan dan dihitung sebagai bilangan bulat `INTEGER` murni (contoh: `25000`, bukan `25000.00` atau `FLOAT`) untuk mencegah galat pembulatan *floating-point*.
5. **Hybrid Inventory Behavior:**
   - `TRACKED_STOCK` (*Tools*, *Roasted Beans*, *Raw Material*, *Snack* kemasan): Stok numerik wajib dipotong secara atomik saat *checkout* dan dikembalikan saat *void*.
   - `AVAILABILITY_ONLY` (*Coffee*, *Non Coffee*, *Manual Brew*): Tidak memotong angka stok saat *checkout*; hanya dikontrol lewat *toggle* `is_available` ($1$ = Ready, $0$ = Habis).
6. **Idempotent Mutations:** Setiap pembuatan transaksi wajib menyertakan `idempotency_key` berbasis **UUIDv7** yang dibuat klien sejak keranjang diinisialisasi guna mencegah duplikasi transaksi saat koneksi Wi-Fi tidak stabil.

## 3. Tech Stack & Struktur Monorepo
- **Frontend:** React 19 (Vite SPA) + TypeScript + Tailwind CSS + Zustand + Dexie.js.
- **Backend:** Hono.js + TypeScript + Zod di atas Cloudflare Workers (kompatibel penuh dengan Node.js / Bun).
- **Database & Storage:** Cloudflare D1 (SQLite Edge) + Cloudflare R2 (kompresi gambar klien `.webp` $< 40\text{ KB}$).
- **Notifikasi & Struk:** Telegram Bot API (Inline *One-Click Approve*) + WhatsApp Gateway Adapter + Deep-Link `wa.me`.

```text
koncoku-pos/
├── AGENTS.md                                # [Lapis 1] Hukum sistem & peta navigasi agen
├── BACKLOG.md                               # [Lapis 3] Pelacak milestone pembangunan
├── docs/                                    # [Lapis 2] Konteks modular sesuai tugas
│   ├── ARCHITECTURE.md                      # Topologi Local-First + Edge & Port/Adapter Pattern
│   ├── DESIGN_SYSTEM.md                     # Ergonomi layar kasir (65/35), shortcut, & badge stok
│   └── specs/
│       ├── 01-schema-and-dexie.md           # Skema SQL D1 (8 tabel), Dexie.js, & Zero-Read Sync
│       ├── 02-catalog-and-checkout.md       # 8 Kategori, HPP Snapshot, & Multi-Payment
│       ├── 03-void-and-wa-receipt.md        # 2-Stage Cancel/Void (OTP + 1-Click) & CRM WA Receipt
│       └── 04-api-contracts.md              # Kontrak Endpoint REST, Skema Zod, & Keamanan Token
├── shared/                                  # Skema Zod, tipe TypeScript, & konstanta bersama
├── backend/                                 # Aplikasi Hono.js, migrasi D1, & Notification Adapter
└── frontend/                                # Aplikasi React 19, Dexie DB, Zustand store, & UI
```

## 4. Peta Navigasi Konteks (Selective Context Loading)
> **INSTRUKSI WAJIB BAGI AGEN:** Jangan memuat seluruh isi folder `docs/` sekaligus. Muat hanya dokumen yang relevan dengan tugas di `BACKLOG.md` yang sedang dikerjakan:
1. Merancang struktur folder, *Repository/Adapter Pattern*, atau autentikasi PIN $\rightarrow$ Baca `docs/ARCHITECTURE.md`.
2. Membuat skema tabel D1, migrasi SQL, atau sinkronisasi `Dexie.js` $\rightarrow$ Baca `docs/specs/01-schema-and-dexie.md`.
3. Membuat validasi *payload* Zod atau rute endpoint Hono.js $\rightarrow$ Baca `docs/specs/04-api-contracts.md`.
4. Mengimplementasikan katalog 8 kategori, kalkulasi keranjang, atau *checkout* atomik $\rightarrow$ Baca `docs/specs/02-catalog-and-checkout.md`.
5. Mengimplementasikan pembatalan struk (*Void* OTP / *One-Click Approve*) atau Struk Digital WA & CRM $\rightarrow$ Baca `docs/specs/03-void-and-wa-receipt.md`.
6. Mengerjakan komponen tampilan React/Tailwind $\rightarrow$ Baca `docs/DESIGN_SYSTEM.md`.

## 5. Perintah Verifikasi Mandiri (Self-Verification Commands)
Jalankan perintah berikut di terminal setiap selesai mengimplementasikan fitur sebelum memperbarui `BACKLOG.md`:
- **Typecheck (Shared + Backend + Frontend):** `npm run typecheck`
- **Unit & Integration Test (Vitest):** `npm run test`
- **Linter:** `npm run lint`