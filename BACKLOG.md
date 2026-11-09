# BACKLOG.md — Peta Jalan Implementasi Koncoku POS

> **Aturan Agen:** Kerjakan satu *milestone* per sesi. Ubah status `[ ]` menjadi `[~]` saat mulai bekerja, dan ubah menjadi `[x]` hanya setelah `npm run typecheck` dan `npm run test` lulus $100\%$.

## Stage 1: Fondasi Monorepo, Skema Database, & Kontrak Bersama
- [x] **M1.1 — Setup Workspace Monorepo & Shared Zod Contracts (`shared/`)**
  - Referensi: `AGENTS.md`, `docs/specs/04-api-contracts.md`
  - Buat konfigurasi TypeScript ketat, tipe domain bersama, validator mata uang `INTEGER`, normalizer nomor WA (`08xx` $\rightarrow$ `628xx`), dan skema Zod untuk seluruh *endpoint*.
- [x] **M1.2 — Migrasi SQLite/D1 & Repositori Database (`backend/migrations/` & `backend/src/db/`)**
  - Referensi: `docs/specs/01-schema-and-dexie.md`
  - Implementasikan DDL 8 tabel (`users`, `products`, `system_meta`, `customers`, `transactions`, `transaction_items`, `void_requests`, `inventory_logs`) beserta indeks dan *unit test* integritas constraint SQLite.

## Stage 2: Backend Edge Core (Hono.js + D1 + Notification Port)
- [x] **M2.1 — Autentikasi PIN Kasir/Owner & Zero-Read Catalog Sync (`GET /api/catalog/sync`)**
  - Referensi: `docs/ARCHITECTURE.md`, `docs/specs/01-schema-and-dexie.md`, `docs/specs/04-api-contracts.md`
  - Implementasikan verifikasi PIN 6-digit serta logika pengecekan `catalog_version` di `system_meta` (kembalikan `304 Not Modified` jika versi sama).
- [x] **M2.2 — Mesin Checkout Atomik, Zero-Trust Pricing, & CRM Upsert (`POST /api/transactions`)**
  - Referensi: `docs/specs/02-catalog-and-checkout.md`, `docs/specs/04-api-contracts.md`
  - Implementasikan transaksi `db.batch()` D1: cek `idempotency_key`, hitung ulang harga & HPP (`cost_price_snapshot`), potong stok `TRACKED_STOCK` secara atomik dengan penjaga `stock_qty >= qty`, catat `inventory_logs`, dan *upsert* data pelanggan.
- [x] **M2.3 — Port Notifikasi & Struk Digital Publik (`/api/receipts/:invoice` & Notification Provider)**
  - Referensi: `docs/ARCHITECTURE.md`, `docs/specs/04-api-contracts.md`
  - Implementasikan adapter `INotificationProvider` (Telegram Bot + Mock untuk unit test), eksekusi aman `executionCtx.waitUntil()`, audit owner asinkron, serta endpoint struk digital publik tanpa kebocoran HPP. Alur permohonan void (`/api/void/*`) diselesaikan penuh bersama Stage 4.

## Stage 3: Local-First POS Frontend (React 19 + Dexie.js + Zustand)
- [x] **M3.1 — Dexie.js Local DB & Implementasi `IPosRepository` (`frontend/src/db/` & `frontend/src/services/`)**
  - Referensi: `docs/ARCHITECTURE.md`, `docs/specs/01-schema-and-dexie.md`
  - Bangun `KoncokuLocalDB`, mekanisme *background sync* `catalog_version`, pencarian produk lokal $< 10\text{ ms}$, dan pencarian *auto-complete* pelanggan 4-digit dari *cache* lokal.
- [x] **M3.2 — Antarmuka Kasir Split-Screen, 8 Kategori, & Keranjang Zustand (`frontend/src/features/pos/`)**
  - Referensi: `docs/DESIGN_SYSTEM.md`, `docs/specs/02-catalog-and-checkout.md`
  - Bangun *layout* 65%/35%, *shortcut* `/` untuk fokus pencarian, *pill tabs* 8 kategori, kartu produk dengan *badge* stok hibrida, *clear cart* (`CART_DRAFT` cancel), serta modal pembayaran `CASH`, `QRIS`, dan `TRANSFER`.

## Stage 4: Integrasi Void UI, One-Click Approval Web, & Struk Digital WA
- [x] **M4.1 — Modal Void Kasir (Polling 3 Detik + Input OTP) & Halaman Konfirmasi Owner**
  - Referensi: `docs/specs/03-void-and-wa-receipt.md`, `docs/DESIGN_SYSTEM.md`
  - Bangun modal pengajuan *Void* di kasir dengan *polling* `GET /api/void/status/:requestId` setiap $3\text{ detik}$, serta halaman web minimalis `/void-approve?token=...` dengan tombol konfirmasi `POST` (Anti-Prefetch).
- [x] **M4.2 — Halaman Struk Digital Publik (`/r/:invoice`) & Deep-Link WhatsApp**
  - Referensi: `docs/specs/03-void-and-wa-receipt.md`, `docs/DESIGN_SYSTEM.md`
  - Bangun tampilan Struk Digital pelanggan, generator QR Code struk di layar kasir seusai bayar, dan aksi tombol `Enter` untuk mengirim struk ke WhatsApp pelanggan.