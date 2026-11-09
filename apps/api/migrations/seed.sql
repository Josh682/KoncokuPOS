-- seed.sql
-- Seed data for Koncoku POS (Cafe & Roastery Edition)

-- 1. Metadata Versi Katalog Awal
INSERT OR REPLACE INTO system_meta (meta_key, meta_value, updated_at)
VALUES ('catalog_version', '1', 1731110400000);

-- 2. Akun Pengguna Awal (Owner & Cashier)
-- Owner PIN: 123456 (Hash: f33ff495acfe467070a911bb00cd610b058fd6b2e2a8746154b5ff7c5702f343)
INSERT OR REPLACE INTO users (id, name, role, pin_hash, is_active, created_at)
VALUES (
    '01931000-0000-7000-8000-000000000001',
    'Owner Koncoku',
    'OWNER',
    'f33ff495acfe467070a911bb00cd610b058fd6b2e2a8746154b5ff7c5702f343',
    1,
    1731110400000
);

-- Cashier PIN: 111111 (Hash: e53451a2043af8c370f2718505335eeaf8c91ab8a00876024d905dfa5b3a66dd)
INSERT OR REPLACE INTO users (id, name, role, pin_hash, is_active, created_at)
VALUES (
    '01931000-0000-7000-8000-000000000002',
    'Kasir Utama',
    'CASHIER',
    'e53451a2043af8c370f2718505335eeaf8c91ab8a00876024d905dfa5b3a66dd',
    1,
    1731110400000
);

-- 3. Sampel Produk (7 Kategori Riil: AVAILABILITY_ONLY & TRACKED_STOCK)
-- COFFEE (AVAILABILITY_ONLY)
INSERT OR REPLACE INTO products (id, sku, name, category, inventory_type, sell_price, cost_price, stock_qty, unit, is_available, image_url, version, updated_at)
VALUES
(
    '01931000-0000-7000-8000-000000000010',
    'COF-ESP-01',
    'Espresso Single',
    'COFFEE',
    'AVAILABILITY_ONLY',
    18000,
    5000,
    0,
    'cup',
    1,
    null,
    1,
    1731110400000
),
(
    '01931000-0000-7000-8000-000000000011',
    'COF-LAT-01',
    'Caffe Latte',
    'COFFEE',
    'AVAILABILITY_ONLY',
    28000,
    9000,
    0,
    'cup',
    1,
    null,
    1,
    1731110400000
);

-- NON_COFFEE (AVAILABILITY_ONLY)
INSERT OR REPLACE INTO products (id, sku, name, category, inventory_type, sell_price, cost_price, stock_qty, unit, is_available, image_url, version, updated_at)
VALUES
(
    '01931000-0000-7000-8000-000000000020',
    'NCF-MAT-01',
    'Uji Matcha Latte',
    'NON_COFFEE',
    'AVAILABILITY_ONLY',
    32000,
    11000,
    0,
    'cup',
    1,
    null,
    1,
    1731110400000
),
(
    '01931000-0000-7000-8000-000000000021',
    'NCF-TEA-01',
    'Earl Grey Artisan Tea',
    'NON_COFFEE',
    'AVAILABILITY_ONLY',
    24000,
    6000,
    0,
    'cup',
    1,
    null,
    1,
    1731110400000
);

-- MANUAL_BREW (AVAILABILITY_ONLY)
INSERT OR REPLACE INTO products (id, sku, name, category, inventory_type, sell_price, cost_price, stock_qty, unit, is_available, image_url, version, updated_at)
VALUES
(
    '01931000-0000-7000-8000-000000000030',
    'MBR-V60-01',
    'Filter V60 Pour Over',
    'MANUAL_BREW',
    'AVAILABILITY_ONLY',
    35000,
    12000,
    0,
    'cup',
    1,
    null,
    1,
    1731110400000
),
(
    '01931000-0000-7000-8000-000000000031',
    'MBR-JAP-01',
    'Japanese Iced Drip',
    'MANUAL_BREW',
    'AVAILABILITY_ONLY',
    38000,
    13000,
    0,
    'cup',
    1,
    null,
    1,
    1731110400000
);

-- SNACK (TRACKED_STOCK)
INSERT OR REPLACE INTO products (id, sku, name, category, inventory_type, sell_price, cost_price, stock_qty, unit, is_available, image_url, version, updated_at)
VALUES
(
    '01931000-0000-7000-8000-000000000040',
    'SNK-CRS-01',
    'Butter Croissant',
    'SNACK',
    'TRACKED_STOCK',
    22000,
    12000,
    25,
    'pcs',
    1,
    null,
    1,
    1731110400000
);

-- ROASTED_BEANS (TRACKED_STOCK)
INSERT OR REPLACE INTO products (id, sku, name, category, inventory_type, sell_price, cost_price, stock_qty, unit, is_available, image_url, version, updated_at)
VALUES
(
    '01931000-0000-7000-8000-000000000050',
    'RBN-GYO-01',
    'Aceh Gayo Anaerobic 200g',
    'ROASTED_BEANS',
    'TRACKED_STOCK',
    95000,
    55000,
    15,
    'pack',
    1,
    null,
    1,
    1731110400000
),
(
    '01931000-0000-7000-8000-000000000051',
    'RBN-FLR-01',
    'Flores Bajawa Full Wash 200g',
    'ROASTED_BEANS',
    'TRACKED_STOCK',
    85000,
    48000,
    20,
    'pack',
    1,
    null,
    1,
    1731110400000
);

-- RAW_MATERIAL (TRACKED_STOCK with integer & decimal gram qty)
INSERT OR REPLACE INTO products (id, sku, name, category, inventory_type, sell_price, cost_price, stock_qty, unit, is_available, image_url, version, updated_at)
VALUES
(
    '01931000-0000-7000-8000-000000000060',
    'RMT-MLK-01',
    'Fresh Milk Diamond 1L',
    'RAW_MATERIAL',
    'TRACKED_STOCK',
    22000,
    18000,
    48,
    'pack',
    1,
    null,
    1,
    1731110400000
),
(
    '01931000-0000-7000-8000-000000000061',
    'RMT-BNS-01',
    'Green Bean Gayo Natural (Bulk)',
    'RAW_MATERIAL',
    'TRACKED_STOCK',
    140000,
    110000,
    5000.0,
    'gram',
    1,
    null,
    1,
    1731110400000
);

-- TOOLS (TRACKED_STOCK)
INSERT OR REPLACE INTO products (id, sku, name, category, inventory_type, sell_price, cost_price, stock_qty, unit, is_available, image_url, version, updated_at)
VALUES
(
    '01931000-0000-7000-8000-000000000070',
    'TLS-V60-01',
    'Hario V60 Ceramic Dripper 02',
    'TOOLS',
    'TRACKED_STOCK',
    285000,
    210000,
    8,
    'pcs',
    1,
    null,
    1,
    1731110400000
),
(
    '01931000-0000-7000-8000-000000000071',
    'TLS-FLT-01',
    'Hario Paper Filter 02 (100 Sheets)',
    'TOOLS',
    'TRACKED_STOCK',
    65000,
    45000,
    30,
    'pack',
    1,
    null,
    1,
    1731110400000
);
