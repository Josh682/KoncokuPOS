/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { createTestDb, type TestD1Database } from './helpers/testDb';
import { MockNotificationProvider } from '../src/providers/notification';
import { generateUUIDv7 } from '@koncoku/shared';
import type { Env } from '../src/types';

describe('Stage 4 Backend Void Lifecycle & Anti-Prefetch Security Integration Tests', () => {
  let testDb: TestD1Database;
  let mockNotification: MockNotificationProvider;
  let env: Env;
  let executionCtx: ExecutionContext;

  const acehBeansId = '01931000-0000-7000-8000-000000000050'; // ROASTED_BEANS, TRACKED_STOCK, stock: 15, sell: 95000, cost: 55000
  const espressoId = '01931000-0000-7000-8000-000000000010'; // COFFEE, AVAILABILITY_ONLY, sell: 18000, cost: 5000

  beforeEach(() => {
    testDb = createTestDb();
    mockNotification = new MockNotificationProvider();
    env = {
      DB: testDb.d1,
      SYSTEM_SECRET: 'test_secret_key_1234567890',
      NOTIFICATION_PROVIDER: 'mock',
      NOTIFICATION_PROVIDER_INSTANCE: mockNotification,
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

  /**
   * Helper to create a completed transaction
   */
  async function createCompletedTransaction(qty = 2, customerPhone?: string) {
    const idempotencyKey = generateUUIDv7();
    const payload: any = {
      idempotency_key: idempotencyKey,
      payment_method: 'CASH',
      cash_received: 500000,
      items: [
        { product_id: acehBeansId, qty },
        { product_id: espressoId, qty: 1 },
      ],
    };

    if (customerPhone) {
      payload.customer = {
        phone: customerPhone,
        name: 'Pelanggan Setia',
      };
    }

    const res = await request('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const receipt = await res.json() as any;

    const txRow = testDb.sqlite
      .prepare('SELECT id FROM transactions WHERE invoice_number = ?')
      .get(receipt.invoice_number) as { id: string };

    return {
      transactionId: txRow.id,
      invoiceNumber: receipt.invoice_number,
      totalAmount: receipt.total_amount,
    };
  }

  describe('1. Keamanan Response Void: POST /api/void/request', () => {
    it('generates OTP & token, sends them to Owner notification, and NEVER leaks otp_code or token in HTTP response', async () => {
      const { transactionId, invoiceNumber } = await createCompletedTransaction(2);

      // Stock before void request: 15 - 2 = 13
      const stockBefore = (testDb.sqlite
        .prepare('SELECT stock_qty FROM products WHERE id = ?')
        .get(acehBeansId) as any).stock_qty;
      expect(stockBefore).toBe(13);

      const res = await request('/api/void/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transactionId,
          reason: 'Pelanggan membatalkan pesanan karena salah pilih varian beans',
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json() as any;

      // Invariant Check: voidRequestId and expiresAt present
      expect(data.voidRequestId).toBeDefined();
      expect(typeof data.voidRequestId).toBe('string');
      expect(data.expiresAt).toBeDefined();
      expect(typeof data.expiresAt).toBe('number');

      // STRICT SECURITY INVARIANT: DILARANG mengembalikan otp_code atau token mentah di body response!
      expect(data).not.toHaveProperty('otp_code');
      expect(data).not.toHaveProperty('plainOtpCode');
      expect(data).not.toHaveProperty('token');
      expect(data).not.toHaveProperty('approvalToken');
      expect(data).not.toHaveProperty('approval_token');

      // Check transaction status changed to VOID_PENDING
      const tx = testDb.sqlite
        .prepare('SELECT status FROM transactions WHERE id = ?')
        .get(transactionId) as any;
      expect(tx.status).toBe('VOID_PENDING');

      // Check void_requests table has PENDING record with only HASHES
      const voidRow = testDb.sqlite
        .prepare('SELECT * FROM void_requests WHERE id = ?')
        .get(data.voidRequestId) as any;
      expect(voidRow).toBeDefined();
      expect(voidRow.status).toBe('PENDING');
      expect(voidRow.otp_hash).toBeDefined();
      expect(voidRow.token_hash).toBeDefined();
      // Ensure raw values are NOT stored
      expect(voidRow).not.toHaveProperty('otp_code');
      expect(voidRow).not.toHaveProperty('approval_token');

      // Verify Owner Notification was triggered with plain OTP & One-Click link
      expect(mockNotification.sentVoidApprovals).toHaveLength(1);
      const notif = mockNotification.sentVoidApprovals[0]!;
      expect(notif.invoiceNumber).toBe(invoiceNumber);
      expect(notif.plainOtpCode).toMatch(/^\d{6}$/);
      expect(notif.oneClickApproveUrl).toMatch(/^https:\/\/pos\.koncoku\.com\/void-approve\?token=[a-f0-9]{64}$/);
      expect(notif.reason).toBe('Pelanggan membatalkan pesanan karena salah pilih varian beans');
    });

    it('rejects requesting void on an already VOIDED transaction with 409 ALREADY_VOIDED', async () => {
      const { transactionId } = await createCompletedTransaction(1);

      // Artificially mark transaction VOIDED
      testDb.sqlite
        .prepare("UPDATE transactions SET status = 'VOIDED' WHERE id = ?")
        .run(transactionId);

      const res = await request('/api/void/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transactionId,
          reason: 'Mencoba void ulang struk yang sudah void',
        }),
      });

      expect(res.status).toBe(409);
      const data = await res.json() as any;
      expect(data.error.code).toBe('ALREADY_VOIDED');
    });
  });

  describe('2. Proteksi Anti-Prefetch (GET /api/void/approve-info?token=...)', () => {
    it('calling approve-info multiple times previews transaction details WITHOUT mutating status to VOIDED and WITHOUT returning stock', async () => {
      const { transactionId } = await createCompletedTransaction(2);

      await request('/api/void/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transactionId,
          reason: 'Salah pesanan kopi',
        }),
      });

      const notif = mockNotification.sentVoidApprovals[0]!;
      const token = notif.oneClickApproveUrl.split('token=')[1]!;

      // Stock before preview requests: 13
      const stockBefore = (testDb.sqlite
        .prepare('SELECT stock_qty FROM products WHERE id = ?')
        .get(acehBeansId) as any).stock_qty;
      expect(stockBefore).toBe(13);

      // Simulate crawler 1 (e.g. WhatsApp Bot Preview)
      const preview1 = await request(`/api/void/approve-info?token=${token}`);
      expect(preview1.status).toBe(200);
      const info1 = await preview1.json() as any;
      expect(info1.invoice_number).toBe(notif.invoiceNumber);
      expect(info1.status).toBe('PENDING');
      expect(info1.is_expired).toBe(false);
      expect(Array.isArray(info1.items)).toBe(true);

      // Simulate crawler 2 (e.g. Telegram Preview)
      const preview2 = await request(`/api/void/approve-info?token=${token}`);
      expect(preview2.status).toBe(200);

      // ANTI-PREFETCH VERIFICATION:
      // Status in DB MUST STILL BE VOID_PENDING / PENDING!
      const tx = testDb.sqlite
        .prepare('SELECT status FROM transactions WHERE id = ?')
        .get(transactionId) as any;
      expect(tx.status).toBe('VOID_PENDING');

      const vr = testDb.sqlite
        .prepare('SELECT status FROM void_requests WHERE transaction_id = ?')
        .get(transactionId) as any;
      expect(vr.status).toBe('PENDING');

      // Stock must remain unchanged
      const stockAfter = (testDb.sqlite
        .prepare('SELECT stock_qty FROM products WHERE id = ?')
        .get(acehBeansId) as any).stock_qty;
      expect(stockAfter).toBe(13);
    });
  });

  describe('3. Append-Only Reversal & Stok via Verify-OTP (POST /api/void/verify-otp)', () => {
    it('executes atomic void reversal: marks VOIDED, restores TRACKED_STOCK, writes VOID_RETURN log, bumps catalog_version', async () => {
      const { transactionId, invoiceNumber } = await createCompletedTransaction(3);

      const initialCatalogVersion = parseInt(
        (testDb.sqlite.prepare("SELECT meta_value FROM system_meta WHERE meta_key = 'catalog_version'").get() as any).meta_value,
        10
      );

      // Stock after purchase: 15 - 3 = 12
      expect(
        (testDb.sqlite.prepare('SELECT stock_qty FROM products WHERE id = ?').get(acehBeansId) as any).stock_qty
      ).toBe(12);

      // Request void
      const reqRes = await request('/api/void/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transactionId,
          reason: 'Pelanggan minta ganti minuman dan snack',
        }),
      });
      const reqData = await reqRes.json() as any;
      const plainOtp = mockNotification.sentVoidApprovals[0]!.plainOtpCode;

      // Verify OTP
      const verifyRes = await request('/api/void/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          void_request_id: reqData.voidRequestId,
          otp_code: plainOtp,
        }),
      });

      expect(verifyRes.status).toBe(200);
      const verifyData = await verifyRes.json() as any;
      expect(verifyData.status).toBe('VOIDED');

      // Check transaction updated
      const tx = testDb.sqlite
        .prepare('SELECT status, void_approved_by, void_reason, voided_at FROM transactions WHERE id = ?')
        .get(transactionId) as any;
      expect(tx.status).toBe('VOIDED');
      expect(tx.void_approved_by).toBe('OTP_ENTRY');
      expect(tx.void_reason).toBe('Pelanggan minta ganti minuman dan snack');
      expect(tx.voided_at).toBeGreaterThan(0);

      // Check void_requests updated to APPROVED
      const vr = testDb.sqlite
        .prepare('SELECT status, resolved_at FROM void_requests WHERE id = ?')
        .get(reqData.voidRequestId) as any;
      expect(vr.status).toBe('APPROVED');
      expect(vr.resolved_at).toBeGreaterThan(0);

      // Check TRACKED_STOCK restored: 12 + 3 = 15!
      const beansRow = testDb.sqlite
        .prepare('SELECT stock_qty FROM products WHERE id = ?')
        .get(acehBeansId) as any;
      expect(beansRow.stock_qty).toBe(15);

      // Check AVAILABILITY_ONLY stock untouched (remains 0)
      const espressoRow = testDb.sqlite
        .prepare('SELECT stock_qty FROM products WHERE id = ?')
        .get(espressoId) as any;
      expect(espressoRow.stock_qty).toBe(0);

      // Check Append-Only inventory_logs has positive VOID_RETURN
      const logs = testDb.sqlite
        .prepare("SELECT * FROM inventory_logs WHERE transaction_id = ? AND change_type = 'VOID_RETURN'")
        .all(transactionId) as any[];
      expect(logs).toHaveLength(1);
      expect(logs[0].qty_delta).toBe(3); // POSITIVE DELTA
      expect(logs[0].stock_after).toBe(15);
      expect(logs[0].notes).toContain(invoiceNumber);

      // Check global catalog_version incremented
      const nextVersion = parseInt(
        (testDb.sqlite.prepare("SELECT meta_value FROM system_meta WHERE meta_key = 'catalog_version'").get() as any).meta_value,
        10
      );
      expect(nextVersion).toBe(initialCatalogVersion + 1);
    });

    it('rejects invalid OTP with 400 VALIDATION_ERROR and does not modify stock', async () => {
      const { transactionId } = await createCompletedTransaction(2);

      const reqRes = await request('/api/void/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transactionId,
          reason: 'Salah ketik item menu',
        }),
      });
      const reqData = await reqRes.json() as any;

      // Submit incorrect OTP
      const verifyRes = await request('/api/void/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          void_request_id: reqData.voidRequestId,
          otp_code: '000000',
        }),
      });

      expect(verifyRes.status).toBe(400);
      const errData = await verifyRes.json() as any;
      expect(errData.error.message).toContain('Kode OTP');

      // Verify transaction is still VOID_PENDING
      const tx = testDb.sqlite
        .prepare('SELECT status FROM transactions WHERE id = ?')
        .get(transactionId) as any;
      expect(tx.status).toBe('VOID_PENDING');
    });
  });

  describe('4. Append-Only Reversal via One-Click Approve (POST /api/void/approve-one-click)', () => {
    it('approves void via One-Click link, restores stock, decrements customer total_spent, and records ONE_CLICK_LINK', async () => {
      const phone = '081299988877';
      const normPhone = '6281299988877';
      const { transactionId, totalAmount } = await createCompletedTransaction(2, phone);

      // Verify customer total_spent before void
      const custBefore = testDb.sqlite
        .prepare('SELECT total_spent FROM customers WHERE phone = ?')
        .get(normPhone) as any;
      expect(custBefore.total_spent).toBe(totalAmount);

      // Request void
      await request('/api/void/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transactionId,
          reason: 'Pelanggan minta ganti menu',
        }),
      });

      const token = mockNotification.sentVoidApprovals[0]!.oneClickApproveUrl.split('token=')[1]!;

      // Owner clicks "Setujui Pembatalan Sekarang"
      const approveRes = await request('/api/void/approve-one-click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      expect(approveRes.status).toBe(200);

      // Check transaction updated with ONE_CLICK_LINK
      const tx = testDb.sqlite
        .prepare('SELECT status, void_approved_by FROM transactions WHERE id = ?')
        .get(transactionId) as any;
      expect(tx.status).toBe('VOIDED');
      expect(tx.void_approved_by).toBe('ONE_CLICK_LINK');

      // Check customer total_spent reduced
      const custAfter = testDb.sqlite
        .prepare('SELECT total_spent FROM customers WHERE phone = ?')
        .get(normPhone) as any;
      expect(custAfter.total_spent).toBe(0);
    });
  });

  describe('5. Pencegahan Double-Void & Expiration (5 Menit)', () => {
    it('rejects double-void attempt with 409 ALREADY_VOIDED and does not increment stock twice', async () => {
      const { transactionId } = await createCompletedTransaction(2);

      const reqRes = await request('/api/void/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transactionId,
          reason: 'Pembatalan transaksi ganda',
        }),
      });
      const reqData = await reqRes.json() as any;
      const plainOtp = mockNotification.sentVoidApprovals[0]!.plainOtpCode;
      const token = mockNotification.sentVoidApprovals[0]!.oneClickApproveUrl.split('token=')[1]!;

      // 1st approve via OTP
      const res1 = await request('/api/void/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          void_request_id: reqData.voidRequestId,
          otp_code: plainOtp,
        }),
      });
      expect(res1.status).toBe(200);

      const stockAfterFirstVoid = (testDb.sqlite
        .prepare('SELECT stock_qty FROM products WHERE id = ?')
        .get(acehBeansId) as any).stock_qty;
      expect(stockAfterFirstVoid).toBe(15);

      // 2nd approve attempt via One-Click token for same transaction
      const res2 = await request('/api/void/approve-one-click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      expect(res2.status).toBe(409);
      const data2 = await res2.json() as any;
      expect(data2.error.code).toBe('ALREADY_VOIDED');

      // 3rd approve attempt via OTP again
      const res3 = await request('/api/void/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          void_request_id: reqData.voidRequestId,
          otp_code: plainOtp,
        }),
      });
      expect(res3.status).toBe(409);

      // STOCK MUST NOT BE INCREMENTED A SECOND TIME
      const stockAfterSecondAttempt = (testDb.sqlite
        .prepare('SELECT stock_qty FROM products WHERE id = ?')
        .get(acehBeansId) as any).stock_qty;
      expect(stockAfterSecondAttempt).toBe(15);
    });

    it('rejects expired void requests with 410 VOID_TOKEN_EXPIRED and reverts transaction status to COMPLETED via polling', async () => {
      const { transactionId } = await createCompletedTransaction(1);

      const reqRes = await request('/api/void/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transactionId,
          reason: 'Transaksi kedaluwarsa test',
        }),
      });
      const reqData = await reqRes.json() as any;
      const plainOtp = mockNotification.sentVoidApprovals[0]!.plainOtpCode;

      // Manually fast-forward expires_at to the past
      testDb.sqlite
        .prepare('UPDATE void_requests SET expires_at = ? WHERE id = ?')
        .run(Date.now() - 1000, reqData.voidRequestId);

      // Polling GET /api/void/status/:requestId should detect expiration and revert tx status to COMPLETED
      const pollRes = await request(`/api/void/status/${reqData.voidRequestId}`);
      expect(pollRes.status).toBe(200);
      const pollData = await pollRes.json() as any;
      expect(pollData.status).toBe('EXPIRED');

      const tx = testDb.sqlite
        .prepare('SELECT status FROM transactions WHERE id = ?')
        .get(transactionId) as any;
      expect(tx.status).toBe('COMPLETED');

      // Trying to verify OTP now should return 410 VOID_TOKEN_EXPIRED
      const otpRes = await request('/api/void/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          void_request_id: reqData.voidRequestId,
          otp_code: plainOtp,
        }),
      });
      expect(otpRes.status).toBe(410);

      // Now cashier CAN create a new void request since previous one expired!
      const newReqRes = await request('/api/void/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transactionId,
          reason: 'Pengajuan ulang setelah yang lama kedaluwarsa',
        }),
      });
      expect(newReqRes.status).toBe(201);
    });
  });

  describe('6. Riwayat Transaksi Kasir (GET /api/transactions)', () => {
    it('returns list of transactions with cashier name, items count, and void request state', async () => {
      await createCompletedTransaction(1);
      await createCompletedTransaction(2);

      const res = await request('/api/transactions?limit=10');
      expect(res.status).toBe(200);
      const data = await res.json() as any;

      expect(Array.isArray(data.transactions)).toBe(true);
      expect(data.transactions.length).toBeGreaterThanOrEqual(2);

      const first = data.transactions[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('invoice_number');
      expect(first).toHaveProperty('total_amount');
      expect(first).toHaveProperty('status');
      expect(first).toHaveProperty('items_count');
      expect(first).toHaveProperty('cashier_name');
    });
  });
});
