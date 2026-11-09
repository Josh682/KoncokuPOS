/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { createTestDb, type TestD1Database } from './helpers/testDb';
import { MockNotificationProvider } from '../src/providers/notification';
import { generateUUIDv7 } from '@koncoku/shared';
import type { Env } from '../src/types';

describe('Koncoku POS Stage 2 Backend Edge Core Integration Tests', () => {
  let testDb: TestD1Database;
  let mockNotification: MockNotificationProvider;
  let env: Env;
  let executionCtx: ExecutionContext;

  beforeEach(() => {
    testDb = createTestDb();
    mockNotification = new MockNotificationProvider();
    env = {
      DB: testDb.d1,
      SYSTEM_SECRET: 'test_secret_key_1234567890',
      NOTIFICATION_PROVIDER: 'mock',
      ALLOW_ANONYMOUS_CHECKOUT_FOR_TEST: 'true',
    };
    executionCtx = {
      waitUntil: (promise: Promise<unknown>) => {
        promise.catch(() => {});
      },
      passThroughOnException: () => {},
    };
  });

  const request = async (
    path: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    const url = `http://localhost${path}`;
    const req = new Request(url, options);
    return app.fetch(req, env, executionCtx);
  };

  describe('1. Fast PIN Authentication (POST /api/auth/login)', () => {
    it('successfully logs in cashier with 6-digit PIN and returns HMAC JWT with CASHIER role', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '111111' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.token).toBeDefined();
      expect(typeof data.token).toBe('string');
      expect(data.user).toBeDefined();
      expect(data.user.role).toBe('CASHIER');
      expect(data.user.name).toBe('Kasir Utama');
    });

    it('successfully logs in owner with 6-digit PIN and returns HMAC JWT with OWNER role', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '123456' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.token).toBeDefined();
      expect(data.user.role).toBe('OWNER');
      expect(data.user.name).toBe('Owner Koncoku');
    });

    it('rejects invalid PIN with 401 UNAUTHORIZED', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '999999' }),
      });

      expect(res.status).toBe(401);
      const data = await res.json() as any;
      expect(data.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects malformed PIN (less than 6 digits) with 400 VALIDATION_ERROR', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '123' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('2. Zero-Read Catalog Sync (GET /api/catalog/sync?version=X)', () => {
    it('returns 304 Not Modified when version parameter matches catalog_version (0 row read on products)', async () => {
      // In seed.sql, catalog_version = 1
      const res = await request('/api/catalog/sync?version=1');
      expect(res.status).toBe(304);
      const text = await res.text();
      expect(text).toBe('');
    });

    it('returns 200 OK with product list and customers when version is different or omitted', async () => {
      const res = await request('/api/catalog/sync?version=0');
      expect(res.status).toBe(200);
      const data = await res.json() as any;

      expect(data.version).toBe(1);
      expect(Array.isArray(data.products)).toBe(true);
      expect(data.products.length).toBeGreaterThan(0);

      // Verify ZERO HPP LEAKAGE: cost_price must NEVER be exposed
      for (const prod of data.products) {
        expect(prod).toHaveProperty('id');
        expect(prod).toHaveProperty('name');
        expect(prod).toHaveProperty('sell_price');
        expect(prod).not.toHaveProperty('cost_price');
      }
    });
  });

  describe('3. Zero-Trust Pricing & Hybrid Stock Checkout (POST /api/transactions)', () => {
    const espressoId = '01931000-0000-7000-8000-000000000010'; // COFFEE, AVAILABILITY_ONLY, sell_price: 18000, cost: 5000
    const acehBeansId = '01931000-0000-7000-8000-000000000050'; // ROASTED_BEANS, TRACKED_STOCK, stock: 15, sell: 95000, cost: 55000

    it('precisely deducts TRACKED_STOCK, leaves AVAILABILITY_ONLY stock untouched, updates catalog_version, and writes inventory_logs', async () => {
      const initialBeans = testDb.sqlite
        .prepare('SELECT stock_qty FROM products WHERE id = ?')
        .get(acehBeansId) as { stock_qty: number };
      const initialEspresso = testDb.sqlite
        .prepare('SELECT stock_qty FROM products WHERE id = ?')
        .get(espressoId) as { stock_qty: number };
      const initialMeta = testDb.sqlite
        .prepare("SELECT meta_value FROM system_meta WHERE meta_key = 'catalog_version'")
        .get() as { meta_value: string };

      expect(initialBeans.stock_qty).toBe(15);
      expect(initialEspresso.stock_qty).toBe(0);
      expect(initialMeta.meta_value).toBe('1');

      const idempotencyKey = generateUUIDv7();

      // Client attempts to tamper with prices: note that client cannot pass prices anyway in Zod schema
      const res = await request('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          payment_method: 'CASH',
          cash_received: 300000, // 2x Espresso (36k) + 2x Aceh Beans (190k) = 226k
          customer: {
            phone: '081234567890',
            name: 'Kopi Lover',
          },
          items: [
            { product_id: espressoId, qty: 2 },
            { product_id: acehBeansId, qty: 2 },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const receipt = await res.json() as any;

      // Check calculations
      expect(receipt.total_amount).toBe(226000); // 2*18000 + 2*95000
      expect(receipt.cash_received).toBe(300000);
      expect(receipt.change_amount).toBe(74000);
      expect(receipt.invoice_number).toMatch(/^KCK-\d{6}-\d{4}$/);
      expect(receipt.customer_phone_snapshot).toBe('6281234567890');

      // Check NO HPP in receipt response
      expect(receipt).not.toHaveProperty('total_cost_amount');
      for (const itm of receipt.items) {
        expect(itm).not.toHaveProperty('cost_price_snapshot');
      }

      // Check DB Hybrid Inventory:
      // Aceh Beans stock reduced from 15 to 13
      const afterBeans = testDb.sqlite
        .prepare('SELECT stock_qty, version FROM products WHERE id = ?')
        .get(acehBeansId) as { stock_qty: number; version: number };
      expect(afterBeans.stock_qty).toBe(13);
      expect(afterBeans.version).toBe(2);

      // Espresso stock UNCHANGED at 0
      const afterEspresso = testDb.sqlite
        .prepare('SELECT stock_qty FROM products WHERE id = ?')
        .get(espressoId) as { stock_qty: number };
      expect(afterEspresso.stock_qty).toBe(0);

      // Global catalog_version incremented to 2
      const afterMeta = testDb.sqlite
        .prepare("SELECT meta_value FROM system_meta WHERE meta_key = 'catalog_version'")
        .get() as { meta_value: string };
      expect(afterMeta.meta_value).toBe('2');

      // Inventory logs written for Aceh Beans
      const logs = testDb.sqlite
        .prepare('SELECT * FROM inventory_logs WHERE product_id = ?')
        .all(acehBeansId) as any[];
      expect(logs).toHaveLength(1);
      expect(logs[0].change_type).toBe('SALE');
      expect(logs[0].qty_delta).toBe(-2);
      expect(logs[0].stock_after).toBe(13);

      // No inventory logs for AVAILABILITY_ONLY
      const espressoLogs = testDb.sqlite
        .prepare('SELECT * FROM inventory_logs WHERE product_id = ?')
        .all(espressoId) as any[];
      expect(espressoLogs).toHaveLength(0);
    });
  });

  describe('4. Out-of-Stock Abort & Negative Stock Prevention', () => {
    const acehBeansId = '01931000-0000-7000-8000-000000000050'; // stock: 15
    const espressoId = '01931000-0000-7000-8000-000000000010';

    it('rejects purchase of TRACKED_STOCK exceeding stock_qty with 409 INSUFFICIENT_STOCK and rolls back completely', async () => {
      const initialTxCount = (testDb.sqlite
        .prepare('SELECT COUNT(*) as c FROM transactions')
        .get() as any).c;
      const initialLogCount = (testDb.sqlite
        .prepare('SELECT COUNT(*) as c FROM inventory_logs')
        .get() as any).c;

      const res = await request('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: generateUUIDv7(),
          payment_method: 'QRIS',
          items: [{ product_id: acehBeansId, qty: 50 }], // Stock is only 15
        }),
      });

      expect(res.status).toBe(409);
      const data = await res.json() as any;
      expect(data.error.code).toBe('INSUFFICIENT_STOCK');

      // Verify ZERO rows added to transactions or inventory_logs
      const finalTxCount = (testDb.sqlite
        .prepare('SELECT COUNT(*) as c FROM transactions')
        .get() as any).c;
      const finalLogCount = (testDb.sqlite
        .prepare('SELECT COUNT(*) as c FROM inventory_logs')
        .get() as any).c;

      expect(finalTxCount).toBe(initialTxCount);
      expect(finalLogCount).toBe(initialLogCount);
    });

    it('rejects purchase when product is_available == 0 with 409 PRODUCT_UNAVAILABLE', async () => {
      // Set espresso unavailable
      testDb.sqlite
        .prepare('UPDATE products SET is_available = 0 WHERE id = ?')
        .run(espressoId);

      const res = await request('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: generateUUIDv7(),
          payment_method: 'QRIS',
          items: [{ product_id: espressoId, qty: 1 }],
        }),
      });

      expect(res.status).toBe(409);
      const data = await res.json() as any;
      expect(data.error.code).toBe('PRODUCT_UNAVAILABLE');
    });
  });

  describe('5. Idempotency Replay (Hukum 6: Idempotent Mutations)', () => {
    const croissantId = '01931000-0000-7000-8000-000000000040'; // SNACK, TRACKED_STOCK, stock: 25

    it('sending identical payload twice with same idempotency_key only deducts stock once and returns identical receipt', async () => {
      const idempotencyKey = generateUUIDv7();

      const payload = {
        idempotency_key: idempotencyKey,
        payment_method: 'CASH',
        cash_received: 50000,
        items: [{ product_id: croissantId, qty: 2 }],
      };

      // 1st request
      const res1 = await request('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res1.status).toBe(200);
      const receipt1 = await res1.json() as any;

      // 2nd request with EXACT SAME idempotency_key
      const res2 = await request('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res2.status).toBe(200);
      const receipt2 = await res2.json() as any;

      // Verify identical invoice number and transaction details
      expect(receipt2.invoice_number).toBe(receipt1.invoice_number);
      expect(receipt2.total_amount).toBe(receipt1.total_amount);

      // Verify stock was deducted only ONCE: 25 - 2 = 23 (NOT 21!)
      const stockRow = testDb.sqlite
        .prepare('SELECT stock_qty FROM products WHERE id = ?')
        .get(croissantId) as { stock_qty: number };
      expect(stockRow.stock_qty).toBe(23);

      // Verify only 1 log row in inventory_logs
      const logRows = testDb.sqlite
        .prepare('SELECT * FROM inventory_logs WHERE product_id = ?')
        .all(croissantId) as any[];
      expect(logRows).toHaveLength(1);
    });
  });

  describe('6. Customer CRM Upsert', () => {
    const latteId = '01931000-0000-7000-8000-000000000011'; // COFFEE, 28000

    it('creates new customer on transaction 1 (visit_count = 1) and updates on transaction 2 (visit_count = 2, accumulated total_spent)', async () => {
      const phoneInput = '087811223344';
      const expectedNormalizedPhone = '6287811223344';

      // 1st transaction
      const res1 = await request('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: generateUUIDv7(),
          payment_method: 'QRIS',
          customer: {
            phone: phoneInput,
            name: 'Andi Perkasa',
          },
          items: [{ product_id: latteId, qty: 1 }], // 28000
        }),
      });

      expect(res1.status).toBe(200);

      const customer1 = testDb.sqlite
        .prepare('SELECT * FROM customers WHERE phone = ?')
        .get(expectedNormalizedPhone) as any;

      expect(customer1).toBeDefined();
      expect(customer1.visit_count).toBe(1);
      expect(customer1.total_spent).toBe(28000);
      expect(customer1.name).toBe('Andi Perkasa');

      // 2nd transaction with same customer phone, different name spelling
      const res2 = await request('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: generateUUIDv7(),
          payment_method: 'CASH',
          cash_received: 100000,
          customer: {
            phone: phoneInput,
            name: 'Andi P.',
          },
          items: [{ product_id: latteId, qty: 2 }], // 56000
        }),
      });

      expect(res2.status).toBe(200);

      const customer2 = testDb.sqlite
        .prepare('SELECT * FROM customers WHERE phone = ?')
        .get(expectedNormalizedPhone) as any;

      expect(customer2.visit_count).toBe(2);
      expect(customer2.total_spent).toBe(84000); // 28000 + 56000
      expect(customer2.name).toBe('Andi P.');
    });
  });

  describe('7. Public Receipt & Customer Search Endpoints', () => {
    const latteId = '01931000-0000-7000-8000-000000000011';

    it('serves public receipt by invoice number WITHOUT leaking HPP', async () => {
      // Create a transaction first
      const txRes = await request('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: generateUUIDv7(),
          payment_method: 'QRIS',
          items: [{ product_id: latteId, qty: 1 }],
        }),
      });

      const txData = await txRes.json() as any;
      const invoice = txData.invoice_number;

      // Public endpoint
      const receiptRes = await request(`/api/receipts/${invoice}`);
      expect(receiptRes.status).toBe(200);

      const receipt = await receiptRes.json() as any;
      expect(receipt.invoice_number).toBe(invoice);
      expect(receipt.total_amount).toBe(28000);
      expect(receipt).not.toHaveProperty('total_cost_amount');

      for (const item of receipt.items) {
        expect(item).not.toHaveProperty('cost_price_snapshot');
      }
    });

    it('returns 404 NOT_FOUND for non-existent invoice', async () => {
      const res = await request('/api/receipts/KCK-999999-9999');
      expect(res.status).toBe(404);
      const data = await res.json() as any;
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('searches customers by partial phone or name prefix', async () => {
      // Seed a customer
      testDb.sqlite
        .prepare(
          'INSERT INTO customers (id, phone, name, visit_count, total_spent, last_visit_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run('cust-1', '62811998877', 'Dewi Lestari', 3, 150000, 1000, 1000);

      const res = await request('/api/customers/search?q=Dewi');
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.customers).toHaveLength(1);
      expect(data.customers[0].phone).toBe('62811998877');

      const phoneRes = await request('/api/customers/search?q=9988');
      expect(phoneRes.status).toBe(200);
      const phoneData = await phoneRes.json() as any;
      expect(phoneData.customers).toHaveLength(1);
    });
  });

  describe('8. Asynchronous Owner Audit Notification (Notification Port)', () => {
    const espressoId = '01931000-0000-7000-8000-000000000010'; // sell: 18000, cost: 5000
    const acehBeansId = '01931000-0000-7000-8000-000000000050'; // sell: 95000, cost: 55000

    it('triggers sendOwnerAuditReceipt with full margin and HPP calculation in the background', async () => {
      env.NOTIFICATION_PROVIDER_INSTANCE = mockNotification;

      const res = await request('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: generateUUIDv7(),
          payment_method: 'QRIS',
          items: [
            { product_id: espressoId, qty: 2 },   // sell: 36000, cost: 10000
            { product_id: acehBeansId, qty: 1 },  // sell: 95000, cost: 55000
          ],
        }),
      });

      expect(res.status).toBe(200);
      expect(mockNotification.sentAuditReceipts).toHaveLength(1);

      const audit = mockNotification.sentAuditReceipts[0]!;
      expect(audit.total_amount).toBe(131000); // 36000 + 95000
      expect(audit.totalCostAmount).toBe(65000); // 10000 + 55000
      expect(audit.grossProfit).toBe(66000); // 131000 - 65000
    });
  });

  describe('9. Role-Based Authorization Middleware (requireAuth & requireRole)', () => {
    it('verifies owner and cashier tokens and enforces RBAC', async () => {
      // 1. Login as Cashier
      const cashierLogin = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '111111' }),
      });
      const cashierData = await cashierLogin.json() as any;
      const cashierToken = cashierData.token;

      // 2. Login as Owner
      const ownerLogin = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '123456' }),
      });
      const ownerData = await ownerLogin.json() as any;
      const ownerToken = ownerData.token;

      // Mount temporary test endpoints to test middleware behavior
      const { requireAuth, requireRole } = await import('../src/middleware/auth');
      const testRouter = (await import('hono')).Hono;
      const testApp = new testRouter();

      testApp.get('/protected-owner', requireAuth(), requireRole(['OWNER']), (c: any) => c.text('owner ok'));
      testApp.get('/protected-cashier', requireAuth(), requireRole(['CASHIER', 'OWNER']), (c: any) => c.text('cashier ok'));

      // Test protected-owner with no token and anonymous disabled -> 401
      const noAuthRes = await testApp.fetch(
        new Request('http://localhost/protected-owner'),
        { ...env, ALLOW_ANONYMOUS_CHECKOUT_FOR_TEST: undefined },
        executionCtx
      );
      expect(noAuthRes.status).toBe(401);

      // Test protected-owner with CASHIER token -> 403 FORBIDDEN
      const cashierOnOwnerRes = await testApp.fetch(
        new Request('http://localhost/protected-owner', {
          headers: { Authorization: `Bearer ${cashierToken}` },
        }),
        env,
        executionCtx
      );
      expect(cashierOnOwnerRes.status).toBe(403);

      // Test protected-owner with OWNER token -> 200 OK
      const ownerOnOwnerRes = await testApp.fetch(
        new Request('http://localhost/protected-owner', {
          headers: { Authorization: `Bearer ${ownerToken}` },
        }),
        env,
        executionCtx
      );
      expect(ownerOnOwnerRes.status).toBe(200);

      // Test protected-cashier with CASHIER token -> 200 OK
      const cashierOnCashierRes = await testApp.fetch(
        new Request('http://localhost/protected-cashier', {
          headers: { Authorization: `Bearer ${cashierToken}` },
        }),
        env,
        executionCtx
      );
      expect(cashierOnCashierRes.status).toBe(200);
    });
  });

  describe('10. Telegram Notification Provider Safe Error Handling', () => {
    it('safely handles network errors without unhandled rejections', async () => {
      const { TelegramNotificationProvider } = await import('../src/providers/notification');
      const provider = new TelegramNotificationProvider('invalid_token', 'invalid_chat_id');

      // Should not throw even with invalid token or network error
      await expect(
        provider.sendOwnerAuditReceipt({
          invoice_number: 'KCK-261109-0001',
          created_at: 1000,
          status: 'COMPLETED',
          payment_method: 'CASH',
          total_amount: 50000,
          totalCostAmount: 25000,
          grossProfit: 25000,
          items: [],
        })
      ).resolves.not.toThrow();

      await expect(
        provider.sendVoidApprovalRequest({
          invoiceNumber: 'KCK-261109-0001',
          cashierName: 'Kasir',
          paymentMethod: 'CASH',
          totalAmount: 50000,
          itemsSummary: [],
          reason: 'Salah menu',
          plainOtpCode: '123456',
          oneClickApproveUrl: 'https://example.com/void',
        })
      ).resolves.not.toThrow();
    });
  });
});
