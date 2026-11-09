import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import type { LocalProduct, LocalCustomer, CreateTransactionInput, PublicReceiptData } from '@koncoku/shared';
import { KoncokuLocalDB } from '../src/db/localDb';
import { PosRepository } from '../src/services/posRepository';

// Configure fake-indexeddb for Dexie in Node test environment
Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

describe('Stage 3 — PosRepository & Zero-Latency Dexie Operations', () => {
  let db: KoncokuLocalDB;
  let repo: PosRepository;
  const mockFetch = vi.fn();

  const sampleProducts: LocalProduct[] = [
    {
      id: '01931000-0000-7000-8000-000000000001',
      sku: 'COF-ESPR-01',
      name: 'Espresso Single Shot',
      category: 'COFFEE',
      inventory_type: 'AVAILABILITY_ONLY',
      sell_price: 15000,
      stock_qty: 0,
      unit: 'cup',
      is_available: 1,
      image_url: null,
      version: 1,
    },
    {
      id: '01931000-0000-7000-8000-000000000002',
      sku: 'COF-LATTE-01',
      name: 'Cafe Latte',
      category: 'COFFEE',
      inventory_type: 'AVAILABILITY_ONLY',
      sell_price: 22000,
      stock_qty: 0,
      unit: 'cup',
      is_available: 1,
      image_url: null,
      version: 1,
    },
    {
      id: '01931000-0000-7000-8000-000000000003',
      sku: 'NON-MATCHA-01',
      name: 'Matcha Latte',
      category: 'NON_COFFEE',
      inventory_type: 'AVAILABILITY_ONLY',
      sell_price: 25000,
      stock_qty: 0,
      unit: 'cup',
      is_available: 1,
      image_url: null,
      version: 1,
    },
    {
      id: '01931000-0000-7000-8000-000000000004',
      sku: 'MB-V60-GAYO',
      name: 'V60 Gayo Anaerob',
      category: 'MANUAL_BREW',
      inventory_type: 'AVAILABILITY_ONLY',
      sell_price: 28000,
      stock_qty: 0,
      unit: 'cup',
      is_available: 1,
      image_url: null,
      version: 1,
    },
    {
      id: '01931000-0000-7000-8000-000000000005',
      sku: 'SNK-CROISS-01',
      name: 'Butter Croissant',
      category: 'SNACK',
      inventory_type: 'TRACKED_STOCK',
      sell_price: 20000,
      stock_qty: 5,
      unit: 'pcs',
      is_available: 1,
      image_url: null,
      version: 1,
    },
    {
      id: '01931000-0000-7000-8000-000000000006',
      sku: 'BNS-GAYO-200G',
      name: 'Roasted Beans Aceh Gayo 200g',
      category: 'ROASTED_BEANS',
      inventory_type: 'TRACKED_STOCK',
      sell_price: 85000,
      stock_qty: 2, // Low stock (Sisa 2)
      unit: 'pack',
      is_available: 1,
      image_url: null,
      version: 1,
    },
    {
      id: '01931000-0000-7000-8000-000000000007',
      sku: 'RAW-MILK-1L',
      name: 'Fresh Milk 1L',
      category: 'RAW_MATERIAL',
      inventory_type: 'TRACKED_STOCK',
      sell_price: 18000,
      stock_qty: 10,
      unit: 'pack',
      is_available: 1,
      image_url: null,
      version: 1,
    },
    {
      id: '01931000-0000-7000-8000-000000000008',
      sku: 'TLS-V60-02',
      name: 'Hario V60 Plastic 02',
      category: 'TOOLS',
      inventory_type: 'TRACKED_STOCK',
      sell_price: 95000,
      stock_qty: 0, // Habis
      unit: 'pcs',
      is_available: 1,
      image_url: null,
      version: 1,
    },
  ];

  const sampleCustomers: LocalCustomer[] = [
    {
      id: '01931000-0000-7000-8000-000000000010',
      phone: '628123456789',
      name: 'Budi Santoso',
      visit_count: 5,
      last_visit_at: 1700000000000,
    },
    {
      id: '01931000-0000-7000-8000-000000000011',
      phone: '628987654321',
      name: 'Siti Rahma',
      visit_count: 2,
      last_visit_at: 1700000005000,
    },
  ];

  beforeEach(async () => {
    // Unique in-memory DB per test
    const testDbName = `KoncokuTest_${Date.now()}_${Math.random()}`;
    db = new KoncokuLocalDB(testDbName, { indexedDB, IDBKeyRange });
    repo = new PosRepository(db, 'https://pos.test.local/api');

    // Seed test data
    await db.products.bulkPut(sampleProducts);
    await db.customers.bulkPut(sampleCustomers);
    await db.sync_meta.put({
      key: 'catalog_version',
      value: '1',
      updated_at: Date.now(),
    });

    // Mock global fetch
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete();
  });

  describe('1. Zero-Latency Read & Zero HTTP Calls (Hukum Invarian 1)', () => {
    it('executes category switching and product searching purely in Dexie with 0 HTTP calls', async () => {
      // 1. Search 'ALL'
      const allProducts = await repo.searchProductsLocal('', 'ALL');
      expect(allProducts.length).toBe(8);

      // 2. Filter by each of the 8 categories
      const coffee = await repo.searchProductsLocal('', 'COFFEE');
      expect(coffee.length).toBe(2);
      expect(coffee.every((p) => p.category === 'COFFEE')).toBe(true);

      const nonCoffee = await repo.searchProductsLocal('', 'NON_COFFEE');
      expect(nonCoffee.length).toBe(1);

      const manualBrew = await repo.searchProductsLocal('', 'MANUAL_BREW');
      expect(manualBrew.length).toBe(1);

      const snack = await repo.searchProductsLocal('', 'SNACK');
      expect(snack.length).toBe(1);

      const beans = await repo.searchProductsLocal('', 'ROASTED_BEANS');
      expect(beans.length).toBe(1);

      const raw = await repo.searchProductsLocal('', 'RAW_MATERIAL');
      expect(raw.length).toBe(1);

      const tools = await repo.searchProductsLocal('', 'TOOLS');
      expect(tools.length).toBe(1);

      // 3. Search by name substring
      const matcha = await repo.searchProductsLocal('matcha', 'ALL');
      expect(matcha.length).toBe(1);
      expect(matcha[0]?.name).toBe('Matcha Latte');

      // 4. Search by SKU
      const bySku = await repo.searchProductsLocal('COF-LATTE', 'ALL');
      expect(bySku.length).toBe(1);
      expect(bySku[0]?.name).toBe('Cafe Latte');

      // CRITICAL INVARIANT: ZERO HTTP CALLS!
      expect(mockFetch).toHaveBeenCalledTimes(0);
    });
  });

  describe('2. Catalog Sync Mechanism (Zero-Read 304 & Atomic 200 Update)', () => {
    it('handles 304 Not Modified without modifying Dexie products', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 304,
        ok: true,
      });

      const result = await repo.syncCatalogIfNeeded();
      expect(result.updated).toBe(false);
      expect(result.version).toBe(1);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://pos.test.local/api/catalog/sync?version=1',
        expect.any(Object)
      );

      // Verify products table untouched
      const count = await db.products.count();
      expect(count).toBe(8);
    });

    it('handles 200 OK and atomically updates Dexie products and sync_meta', async () => {
      const updatedProductList: LocalProduct[] = [
        {
          id: '01931000-0000-7000-8000-000000000099',
          sku: 'NEW-PROD-01',
          name: 'Affogato Special',
          category: 'COFFEE',
          inventory_type: 'AVAILABILITY_ONLY',
          sell_price: 30000,
          stock_qty: 0,
          unit: 'cup',
          is_available: 1,
          image_url: null,
          version: 2,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          version: 2,
          products: updatedProductList,
          customers: [],
        }),
      });

      const result = await repo.syncCatalog();
      expect(result.updated).toBe(true);
      expect(result.version).toBe(2);

      // Verify Dexie products replaced with new catalog
      const productsInDb = await db.products.toArray();
      expect(productsInDb.length).toBe(1);
      expect(productsInDb[0]?.name).toBe('Affogato Special');

      // Verify sync_meta version updated
      const meta = await db.sync_meta.get('catalog_version');
      expect(meta?.value).toBe('2');
    });
  });

  describe('3. Local CRM Auto-Complete (<10ms & Normalization)', () => {
    it('finds customer by phone prefix (08xx and 628xx) with 0 HTTP calls', async () => {
      // Searching with 0812 (Indonesia standard mobile format)
      const res1 = await repo.searchCustomersByPhonePrefix('0812');
      expect(res1.length).toBe(1);
      expect(res1[0]?.name).toBe('Budi Santoso');
      expect(res1[0]?.phone).toBe('628123456789');

      // Searching with 6289
      const res2 = await repo.searchCustomersByPhonePrefix('6289');
      expect(res2.length).toBe(1);
      expect(res2[0]?.name).toBe('Siti Rahma');

      // Searching by customer name substring
      const res3 = await repo.searchCustomersByPhonePrefix('Budi');
      expect(res3.length).toBe(1);
      expect(res3[0]?.name).toBe('Budi Santoso');

      // Non-existent search returns empty array
      const res4 = await repo.searchCustomersByPhonePrefix('089999999');
      expect(res4.length).toBe(0);

      // ZERO HTTP calls
      expect(mockFetch).toHaveBeenCalledTimes(0);
    });
  });

  describe('4. Checkout Submission & Optimistic Local Updates', () => {
    it('submits transaction to server and optimistically updates stock and customer in Dexie', async () => {
      const mockReceipt: PublicReceiptData = {
        invoice_number: 'KCK-261109-0001',
        created_at: Date.now(),
        status: 'COMPLETED',
        payment_method: 'CASH',
        total_amount: 85000,
        cash_received: 100000,
        change_amount: 15000,
        customer_name_snapshot: 'Andi Wijaya',
        customer_phone_snapshot: '628555123456',
        cashier_name: 'Kasir Utama',
        items: [
          {
            product_id: '01931000-0000-7000-8000-000000000006', // Beans Gayo (stock was 2)
            product_name_snapshot: 'Roasted Beans Aceh Gayo 200g',
            category_snapshot: 'ROASTED_BEANS',
            qty: 1,
            sell_price_snapshot: 85000,
            subtotal: 85000,
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => mockReceipt,
      });

      const payload: CreateTransactionInput = {
        idempotency_key: '01931000-0000-7000-8000-000000000050',
        payment_method: 'CASH',
        cash_received: 100000,
        customer: {
          phone: '08555123456',
          name: 'Andi Wijaya',
        },
        items: [
          {
            product_id: '01931000-0000-7000-8000-000000000006',
            qty: 1,
          },
        ],
      };

      const receipt = await repo.submitCheckout(payload);
      expect(receipt.invoice_number).toBe('KCK-261109-0001');

      // Verify optimistic stock reduction in Dexie: 2 - 1 = 1
      const updatedProduct = await db.products.get('01931000-0000-7000-8000-000000000006');
      expect(updatedProduct?.stock_qty).toBe(1);

      // Verify customer upsert in Dexie
      const savedCustomer = await db.customers.where('phone').equals('628555123456').first();
      expect(savedCustomer).toBeDefined();
      expect(savedCustomer?.name).toBe('Andi Wijaya');
      expect(savedCustomer?.visit_count).toBe(1);
    });
  });
});