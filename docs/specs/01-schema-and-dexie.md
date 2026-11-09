# 01 — Skema Database (Cloudflare D1 / SQLite) & Sinkronisasi Dexie.js

## 1. Skema Relasional Utama (`backend/migrations/0001_init.sql`)
Seluruh nilai uang wajib bertipe `INTEGER` (Rupiah penuh) dan seluruh stempel waktu menggunakan `INTEGER` (*Unix Timestamp* dalam milidetik).

```sql
PRAGMA foreign_keys = ON;

-- 1. Tabel Pengguna (Kasir & Owner)
CREATE TABLE users (
    id TEXT PRIMARY KEY, -- UUIDv7
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('OWNER', 'CASHIER')),
    pin_hash TEXT NOT NULL, -- SHA-256 / PBKDF2 hash dari 6-digit PIN
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at INTEGER NOT NULL
);

-- 2. Tabel Katalog Produk
CREATE TABLE products (
    id TEXT PRIMARY KEY, -- UUIDv7
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'COFFEE', 'NON_COFFEE', 'MANUAL_BREW', 'SNACK',
        'ROASTED_BEANS', 'RAW_MATERIAL', 'TOOLS'
    )),
    inventory_type TEXT NOT NULL CHECK (inventory_type IN (
        'TRACKED_STOCK',      -- Tools, Beans, Raw Material, Packaged Snack
        'AVAILABILITY_ONLY'   -- Drinks / Made-to-order
    )),
    sell_price INTEGER NOT NULL CHECK (sell_price >= 0),
    cost_price INTEGER NOT NULL CHECK (cost_price >= 0), -- HPP (Rahasia Owner)
    stock_qty REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'pcs', -- pcs, pack, gram, ml
    is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
    image_url TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
);

-- 3. Tabel Metadata Versi Katalog (Untuk Zero-Read Sync)
CREATE TABLE system_meta (
    meta_key TEXT PRIMARY KEY,
    meta_value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Seed awal wajib:
INSERT INTO system_meta (meta_key, meta_value, updated_at)
VALUES ('catalog_version', '1', 0)
ON CONFLICT(meta_key) DO NOTHING;

-- 4. Tabel Pelanggan (CRM WA Collector)
CREATE TABLE customers (
    id TEXT PRIMARY KEY, -- UUIDv7
    phone TEXT UNIQUE NOT NULL, -- Format wajib: 628xxxxxxxxxx
    name TEXT NOT NULL,
    visit_count INTEGER NOT NULL DEFAULT 1 CHECK (visit_count >= 1),
    total_spent INTEGER NOT NULL DEFAULT 0 CHECK (total_spent >= 0),
    last_visit_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- 5. Tabel Transaksi Utama (Immutable Header)
CREATE TABLE transactions (
    id TEXT PRIMARY KEY, -- UUIDv7
    idempotency_key TEXT UNIQUE NOT NULL,
    invoice_number TEXT UNIQUE NOT NULL, -- Format: KCK-YYMMDD-XXXX
    cashier_id TEXT NOT NULL REFERENCES users(id),
    customer_id TEXT REFERENCES customers(id),
    customer_name_snapshot TEXT,
    customer_phone_snapshot TEXT,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('QRIS', 'CASH', 'TRANSFER')),
    payment_reference TEXT,
    total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
    total_cost_amount INTEGER NOT NULL CHECK (total_cost_amount >= 0),
    cash_received INTEGER,
    change_amount INTEGER,
    status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'VOID_PENDING', 'VOIDED')),
    voided_at INTEGER,
    void_reason TEXT,
    void_approved_by TEXT CHECK (void_approved_by IN ('OTP_ENTRY', 'ONE_CLICK_LINK') OR void_approved_by IS NULL),
    created_at INTEGER NOT NULL
);

-- 6. Tabel Detail Item Transaksi (Immutable Lines)
CREATE TABLE transaction_items (
    id TEXT PRIMARY KEY, -- UUIDv7
    transaction_id TEXT NOT NULL REFERENCES transactions(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    product_name_snapshot TEXT NOT NULL,
    category_snapshot TEXT NOT NULL,
    qty REAL NOT NULL CHECK (qty > 0),
    sell_price_snapshot INTEGER NOT NULL CHECK (sell_price_snapshot >= 0),
    cost_price_snapshot INTEGER NOT NULL CHECK (cost_price_snapshot >= 0),
    subtotal INTEGER NOT NULL CHECK (subtotal >= 0)
);

-- 7. Tabel Permohonan Pembatalan (OTP & One-Click Approve)
CREATE TABLE void_requests (
    id TEXT PRIMARY KEY, -- UUIDv7
    transaction_id TEXT NOT NULL REFERENCES transactions(id),
    requested_by TEXT NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    otp_hash TEXT NOT NULL,          -- SHA-256 hex dari 6-digit OTP
    token_hash TEXT UNIQUE NOT NULL, -- SHA-256 hex dari One-Click Token
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'EXPIRED', 'REJECTED')),
    expires_at INTEGER NOT NULL,     -- created_at + 300000 (5 menit)
    resolved_at INTEGER,
    created_at INTEGER NOT NULL
);

-- 8. Tabel Buku Besar Stok (Append-Only Audit Log)
CREATE TABLE inventory_logs (
    id TEXT PRIMARY KEY, -- UUIDv7
    product_id TEXT NOT NULL REFERENCES products(id),
    transaction_id TEXT REFERENCES transactions(id),
    change_type TEXT NOT NULL CHECK (change_type IN ('SALE', 'VOID_RETURN', 'RESTOCK', 'OPNAME_ADJUST')),
    qty_delta REAL NOT NULL, -- Negatif untuk SALE, Positif untuk VOID_RETURN & RESTOCK
    stock_after REAL NOT NULL,
    notes TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL
);

-- Indeks Performa Kueri
CREATE INDEX idx_products_category_avail ON products(category, is_available);
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX idx_transactions_invoice ON transactions(invoice_number);
CREATE INDEX idx_tx_items_tx_id ON transaction_items(transaction_id);
CREATE INDEX idx_void_req_tx_id ON void_requests(transaction_id, status);
CREATE INDEX idx_inv_logs_product_id ON inventory_logs(product_id, created_at DESC);
```

---

## 2. Aturan Pemotongan Stok Atomik (Anti-Race Condition di D1)
Saat mengurangi stok produk `TRACKED_STOCK` atau mengubah `catalog_version`, gunakan pernyataan SQL bersyarat di dalam `db.batch()` untuk mencegah stok minus ketika dua kasir menekan tombol bayar bersamaan:

```sql
-- Pemotongan stok atomik: wajib memeriksa bahwa baris yang terpengaruh (changes) == 1
UPDATE products
SET stock_qty = stock_qty - ?1,
    version = version + 1,
    updated_at = ?2
WHERE id = ?3
  AND inventory_type = 'TRACKED_STOCK'
  AND is_available = 1
  AND stock_qty >= ?1;

-- Setiap ada perubahan produk atau stok, naikkan catalog_version global:
UPDATE system_meta
SET meta_value = CAST(CAST(meta_value AS INTEGER) + 1 AS TEXT),
    updated_at = ?1
WHERE meta_key = 'catalog_version';
```

---

## 3. Skema IndexedDB Lokal (`Dexie.js` — `KoncokuLocalDB`)
Di sisi *frontend*, `Dexie.js` menyimpan katalog produk (tanpa `cost_price` demi keamanan jika perangkat kasir dibuka via DevTools), *cache* pelanggan, dan antrean transaksi:

```typescript
import Dexie, { type EntityTable } from 'dexie';

export interface LocalProduct {
  id: string;
  sku: string;
  name: string;
  category: 'COFFEE' | 'NON_COFFEE' | 'MANUAL_BREW' | 'SNACK' | 'ROASTED_BEANS' | 'RAW_MATERIAL' | 'TOOLS';
  inventory_type: 'TRACKED_STOCK' | 'AVAILABILITY_ONLY';
  sell_price: number;
  stock_qty: number;
  unit: string;
  is_available: 0 | 1;
  image_url: string | null;
  version: number;
}

export interface LocalCustomer {
  id: string;
  phone: string; // 628xxxxxxxxxx
  name: string;
  visit_count: number;
  last_visit_at: number;
}

export interface SyncMeta {
  key: 'catalog_version';
  value: string;
  updated_at: number;
}

export interface OfflineTxQueueItem {
  idempotency_key: string;
  payload: unknown;
  created_at: number;
  status: 'PENDING' | 'SYNCING' | 'FAILED_CONFLICT';
  error_message?: string;
}

export class KoncokuLocalDB extends Dexie {
  products!: EntityTable<LocalProduct, 'id'>;
  customers!: EntityTable<LocalCustomer, 'id'>;
  sync_meta!: EntityTable<SyncMeta, 'key'>;
  offline_tx_queue!: EntityTable<OfflineTxQueueItem, 'idempotency_key'>;

  constructor() {
    super('KoncokuLocalDB');
    this.version(1).stores({
      products: 'id, &sku, name, category, is_available',
      customers: 'id, &phone, name',
      sync_meta: 'key',
      offline_tx_queue: 'idempotency_key, created_at, status',
    });
  }
}
```