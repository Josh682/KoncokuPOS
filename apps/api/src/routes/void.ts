import { Hono } from 'hono';
import {
  CreateVoidRequestSchema,
  VerifyVoidOtpSchema,
  ApproveOneClickVoidSchema,
  generateUUIDv7,
  generateOtp6,
  generateSecureToken,
  hashOtp,
  hashToken,
  type VoidRequestEntity,
  type TransactionEntity,
} from '@koncoku/shared';
import type { AppContext } from '../types';
import { errorResponse } from '../utils/errors';
import { getNotificationProvider } from '../providers/notification';

export const voidRouter = new Hono<AppContext>();

interface VoidRequestWithTx extends VoidRequestEntity {
  invoice_number: string;
  tx_status: string;
  tx_id: string;
  payment_method: string;
  total_amount: number;
  customer_id: string | null;
  cashier_id: string;
  cashier_name?: string;
}

/**
 * Common helper to execute atomic void reversal across D1 tables
 * Strictly obeys Hukum Invarian:
 * - Append-Only Financial Ledger (NO DELETE, write VOID_RETURN log)
 * - Returns stock for TRACKED_STOCK items
 * - Increments catalog_version
 * - Reduces customer total_spent
 */
async function executeAtomicVoid(params: {
  db: D1Database;
  voidRequestId: string;
  transactionId: string;
  invoiceNumber: string;
  reason: string;
  approvedBy: 'OTP_ENTRY' | 'ONE_CLICK_LINK';
  cashierId: string;
  customerId: string | null;
  totalAmount: number;
}): Promise<void> {
  const {
    db,
    voidRequestId,
    transactionId,
    invoiceNumber,
    reason,
    approvedBy,
    cashierId,
    customerId,
    totalAmount,
  } = params;

  const now = Date.now();

  // 1. Fetch transaction items with product metadata
  const itemsResult = await db
    .prepare(
      `SELECT ti.product_id, ti.qty, p.inventory_type, p.stock_qty, p.name as product_name
       FROM transaction_items ti
       JOIN products p ON p.id = ti.product_id
       WHERE ti.transaction_id = ?`
    )
    .bind(transactionId)
    .all<{
      product_id: string;
      qty: number;
      inventory_type: 'TRACKED_STOCK' | 'AVAILABILITY_ONLY';
      stock_qty: number;
      product_name: string;
    }>();

  const items = itemsResult.results || [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const statements: any[] = [];

  // 2. Mark void_requests as APPROVED (locking status = 'PENDING')
  statements.push(
    db
      .prepare(
        `UPDATE void_requests
         SET status = 'APPROVED', resolved_at = ?
         WHERE id = ? AND status = 'PENDING'`
      )
      .bind(now, voidRequestId)
  );

  // 3. Mark transactions as VOIDED (locking status = 'VOID_PENDING')
  statements.push(
    db
      .prepare(
        `UPDATE transactions
         SET status = 'VOIDED', voided_at = ?, void_reason = ?, void_approved_by = ?
         WHERE id = ? AND status = 'VOID_PENDING'`
      )
      .bind(now, reason, approvedBy, transactionId)
  );

  // 4. Reversal for TRACKED_STOCK items
  let hasTrackedStock = false;
  const trackedStockMap = new Map<string, { qty: number; currentStock: number }>();

  for (const item of items) {
    if (item.inventory_type === 'TRACKED_STOCK') {
      hasTrackedStock = true;
      const existing = trackedStockMap.get(item.product_id);
      const accumulatedQty = (existing?.qty || 0) + item.qty;
      trackedStockMap.set(item.product_id, {
        qty: accumulatedQty,
        currentStock: item.stock_qty,
      });
    }
  }

  for (const [productId, info] of trackedStockMap.entries()) {
    const stockAfter = info.currentStock + info.qty;

    // Restore stock in products table
    statements.push(
      db
        .prepare(
          `UPDATE products
           SET stock_qty = stock_qty + ?,
               version = version + 1,
               updated_at = ?
           WHERE id = ?`
        )
        .bind(info.qty, now, productId)
    );

    // Append-only reversal entry in inventory_logs (change_type = 'VOID_RETURN', qty_delta = +qty)
    statements.push(
      db
        .prepare(
          `INSERT INTO inventory_logs (
             id, product_id, transaction_id, change_type, qty_delta,
             stock_after, notes, created_by, created_at
           ) VALUES (?, ?, ?, 'VOID_RETURN', ?, ?, ?, ?, ?)`
        )
        .bind(
          generateUUIDv7(),
          productId,
          transactionId,
          info.qty,
          stockAfter,
          `Pembatalan transaksi (${invoiceNumber})`,
          cashierId,
          now
        )
    );
  }

  // 5. Bump global catalog_version if tracked stock was modified
  if (hasTrackedStock) {
    statements.push(
      db
        .prepare(
          `UPDATE system_meta
           SET meta_value = CAST(CAST(meta_value AS INTEGER) + 1 AS TEXT),
               updated_at = ?
           WHERE meta_key = 'catalog_version'`
        )
        .bind(now)
    );
  }

  // 6. Reduce customer total_spent if transaction was associated with CRM customer
  if (customerId) {
    statements.push(
      db
        .prepare(
          `UPDATE customers
           SET total_spent = MAX(0, total_spent - ?)
           WHERE id = ?`
        )
        .bind(totalAmount, customerId)
    );
  }

  // Execute all updates atomically
  const batchResult = await db.batch(statements);

  // Check race condition (if first statement affected 0 rows, it was already resolved concurrently)
  if (batchResult[0]?.meta?.changes === 0) {
    throw new Error('ALREADY_VOIDED_OR_RESOLVED');
  }
}

/**
 * 1. POST /api/void/request (Aktor: Kasir)
 * Mengajukan pembatalan transaksi berstatus COMPLETED.
 * Menghasilkan OTP 6-digit & token persetujuan (berlaku 5 menit).
 * HANYA menyimpan hash SHA-256 di void_requests.
 * DILARANG mengembalikan otp_code atau token mentah di HTTP response body!
 */
voidRouter.post('/request', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, 'VALIDATION_ERROR', 'Format JSON request tidak valid');
  }

  const parseResult = CreateVoidRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(
      c,
      400,
      'VALIDATION_ERROR',
      parseResult.error.errors[0]?.message || 'Payload permohonan void tidak valid'
    );
  }

  const { transaction_id, reason } = parseResult.data;
  const user = c.get('user');
  const cashierId = user?.id || '01931000-0000-7000-8000-000000000002';
  const cashierName = user?.name || 'Kasir Utama';

  // Fetch transaction
  const tx = await c.env.DB
    .prepare(
      `SELECT t.*, u.name as cashier_name
       FROM transactions t
       LEFT JOIN users u ON u.id = t.cashier_id
       WHERE t.id = ?`
    )
    .bind(transaction_id)
    .first<TransactionEntity & { cashier_name?: string }>();

  if (!tx) {
    return errorResponse(
      c,
      404,
      'NOT_FOUND',
      `Transaksi dengan ID '${transaction_id}' tidak ditemukan`,
      { transaction_id }
    );
  }

  if (tx.status === 'VOIDED') {
    return errorResponse(
      c,
      409,
      'ALREADY_VOIDED',
      `Transaksi (${tx.invoice_number}) sudah dibatalkan sebelumnya`
    );
  }

  const now = Date.now();

  // If already VOID_PENDING, check if the previous request has expired
  if (tx.status === 'VOID_PENDING') {
    const existingReq = await c.env.DB
      .prepare(
        `SELECT * FROM void_requests
         WHERE transaction_id = ? AND status = 'PENDING'
         ORDER BY created_at DESC LIMIT 1`
      )
      .bind(transaction_id)
      .first<VoidRequestEntity>();

    if (existingReq) {
      if (now <= existingReq.expires_at) {
        return errorResponse(
          c,
          409,
          'VOID_ALREADY_PENDING',
          `Permohonan pembatalan untuk struk ${tx.invoice_number} sedang menunggu persetujuan Owner`
        );
      } else {
        // Expired: mark old request as EXPIRED and permit creating new request
        await c.env.DB
          .prepare(
            `UPDATE void_requests
             SET status = 'EXPIRED', resolved_at = ?
             WHERE id = ? AND status = 'PENDING'`
          )
          .bind(now, existingReq.id)
          .run();
      }
    }
  } else if (tx.status !== 'COMPLETED') {
    return errorResponse(
      c,
      400,
      'VALIDATION_ERROR',
      `Transaksi dengan status '${tx.status}' tidak dapat dibatalkan`
    );
  }

  // Generate 6-digit numeric OTP and 32-byte approval token
  const otpCode = generateOtp6();
  const approvalToken = generateSecureToken(32);
  const expiresAt = now + 300_000; // 5 minutes (300,000 ms)
  const voidRequestId = generateUUIDv7();

  const otpHash = await hashOtp(otpCode);
  const tokenHash = await hashToken(approvalToken);

  // Save only hashes to database and mark transaction VOID_PENDING
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO void_requests (
           id, transaction_id, requested_by, reason, otp_hash, token_hash,
           status, expires_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`
      )
      .bind(
        voidRequestId,
        transaction_id,
        cashierId,
        reason,
        otpHash,
        tokenHash,
        expiresAt,
        now
      ),
    c.env.DB
      .prepare(`UPDATE transactions SET status = 'VOID_PENDING' WHERE id = ?`)
      .bind(transaction_id),
  ]);

  // Fetch items for notification summary
  const items = await c.env.DB
    .prepare(
      `SELECT product_name_snapshot as name, qty, subtotal
       FROM transaction_items
       WHERE transaction_id = ?`
    )
    .bind(transaction_id)
    .all<{ name: string; qty: number; subtotal: number }>();

  // Send notification to Owner via INotificationProvider in waitUntil()
  const notificationProvider =
    c.get('notificationProvider') || getNotificationProvider(c.env);

  const oneClickApproveUrl = `https://pos.koncoku.com/void-approve?token=${approvalToken}`;

  const notifTask = notificationProvider
    .sendVoidApprovalRequest({
      invoiceNumber: tx.invoice_number,
      cashierName: tx.cashier_name || cashierName,
      paymentMethod: tx.payment_method,
      totalAmount: tx.total_amount,
      itemsSummary: items.results || [],
      reason,
      plainOtpCode: otpCode, // Only sent to Owner channel
      oneClickApproveUrl,
    })
    .catch((err) => {
      console.error('Failed to dispatch void notification to Owner:', err);
    });

  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(notifTask);
  }

  // STRICT INVARIANT: Response contains ONLY voidRequestId & expiresAt.
  // NEVER leak otp_code or approval_token to cashier API response!
  return c.json(
    {
      voidRequestId,
      expiresAt,
    },
    201
  );
});

/**
 * 2. GET /api/void/status/:requestId (Aktor: Kasir)
 * Endpoint ringan yang di-polling setiap 3 detik dari layar kasir.
 * Jika waktu sekarang > expires_at dan status masih 'PENDING':
 * Tandai void_requests sebagai 'EXPIRED' dan kembalikan status transactions ke 'COMPLETED'.
 */
voidRouter.get('/status/:requestId', async (c) => {
  const requestId = c.req.param('requestId');

  const voidReq = await c.env.DB
    .prepare(
      `SELECT vr.*, t.invoice_number, t.id as transaction_id
       FROM void_requests vr
       JOIN transactions t ON t.id = vr.transaction_id
       WHERE vr.id = ?`
    )
    .bind(requestId)
    .first<VoidRequestWithTx>();

  if (!voidReq) {
    return errorResponse(
      c,
      404,
      'NOT_FOUND',
      `Permohonan void dengan ID '${requestId}' tidak ditemukan`
    );
  }

  const now = Date.now();

  // Check expiration if still PENDING
  if (voidReq.status === 'PENDING' && now > voidReq.expires_at) {
    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `UPDATE void_requests
           SET status = 'EXPIRED', resolved_at = ?
           WHERE id = ? AND status = 'PENDING'`
        )
        .bind(now, requestId),
      c.env.DB
        .prepare(
          `UPDATE transactions
           SET status = 'COMPLETED'
           WHERE id = ? AND status = 'VOID_PENDING'`
        )
        .bind(voidReq.transaction_id),
    ]);

    return c.json({
      status: 'EXPIRED',
      invoiceNumber: voidReq.invoice_number,
    });
  }

  return c.json({
    status: voidReq.status,
    invoiceNumber: voidReq.invoice_number,
  });
});

/**
 * 3. GET /api/void/approve-info?token=... (Aktor: Owner — Anti-Prefetch Security)
 * Mengambil ringkasan transaksi berdasarkan approval_token query param.
 * TIDAK MENGUBAH STATUS MENJADI VOIDED (Aman dari link preview crawler Telegram/WhatsApp).
 */
voidRouter.get('/approve-info', async (c) => {
  const token = c.req.query('token');
  if (!token || token.length < 32) {
    return errorResponse(
      c,
      400,
      'VALIDATION_ERROR',
      'Parameter token persetujuan void tidak valid'
    );
  }

  const tokenHash = await hashToken(token);

  const voidReq = await c.env.DB
    .prepare(
      `SELECT vr.*, t.invoice_number, t.payment_method, t.total_amount,
              t.status as tx_status, t.id as tx_id, u.name as cashier_name
       FROM void_requests vr
       JOIN transactions t ON t.id = vr.transaction_id
       LEFT JOIN users u ON u.id = t.cashier_id
       WHERE vr.token_hash = ?`
    )
    .bind(tokenHash)
    .first<VoidRequestWithTx>();

  if (!voidReq) {
    return errorResponse(
      c,
      404,
      'NOT_FOUND',
      'Tautan persetujuan void tidak ditemukan atau tidak valid'
    );
  }

  const now = Date.now();
  let currentStatus = voidReq.status;
  const isExpired = now > voidReq.expires_at || currentStatus === 'EXPIRED';

  // Auto-expire if time passed
  if (currentStatus === 'PENDING' && isExpired) {
    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `UPDATE void_requests
           SET status = 'EXPIRED', resolved_at = ?
           WHERE id = ? AND status = 'PENDING'`
        )
        .bind(now, voidReq.id),
      c.env.DB
        .prepare(
          `UPDATE transactions
           SET status = 'COMPLETED'
           WHERE id = ? AND status = 'VOID_PENDING'`
        )
        .bind(voidReq.tx_id),
    ]);
    currentStatus = 'EXPIRED';
  }

  const items = await c.env.DB
    .prepare(
      `SELECT product_name_snapshot as name, qty, subtotal
       FROM transaction_items
       WHERE transaction_id = ?`
    )
    .bind(voidReq.tx_id)
    .all<{ name: string; qty: number; subtotal: number }>();

  // Return public preview strictly WITHOUT triggering void execution
  return c.json({
    invoice_number: voidReq.invoice_number,
    cashier_name: voidReq.cashier_name || 'Kasir',
    payment_method: voidReq.payment_method,
    total_amount: voidReq.total_amount,
    items: items.results || [],
    reason: voidReq.reason,
    expires_at: voidReq.expires_at,
    is_expired: isExpired,
    status: currentStatus,
  });
});

/**
 * 4. POST /api/void/approve-one-click (Aktor: Owner)
 * Mengeksekusi pembatalan transaksi secara sah melalui One-Click Approve link
 * Mencatat void_approved_by = 'ONE_CLICK_LINK'
 */
voidRouter.post('/approve-one-click', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, 'VALIDATION_ERROR', 'Format JSON request tidak valid');
  }

  const parseResult = ApproveOneClickVoidSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(
      c,
      400,
      'VALIDATION_ERROR',
      parseResult.error.errors[0]?.message || 'Token tidak valid'
    );
  }

  const tokenHash = await hashToken(parseResult.data.token);

  const voidReq = await c.env.DB
    .prepare(
      `SELECT vr.*, t.invoice_number, t.customer_id, t.total_amount,
              t.status as tx_status, t.cashier_id, t.id as transaction_id
       FROM void_requests vr
       JOIN transactions t ON t.id = vr.transaction_id
       WHERE vr.token_hash = ?`
    )
    .bind(tokenHash)
    .first<VoidRequestWithTx>();

  if (!voidReq) {
    return errorResponse(
      c,
      404,
      'NOT_FOUND',
      'Tautan persetujuan void tidak ditemukan atau tidak valid'
    );
  }

  if (voidReq.status === 'APPROVED' || voidReq.tx_status === 'VOIDED') {
    return errorResponse(
      c,
      409,
      'ALREADY_VOIDED',
      `Transaksi (${voidReq.invoice_number}) sudah dibatalkan sebelumnya`
    );
  }

  const now = Date.now();
  if (voidReq.status === 'EXPIRED' || now > voidReq.expires_at) {
    if (voidReq.status === 'PENDING') {
      await c.env.DB.batch([
        c.env.DB
          .prepare(
            `UPDATE void_requests
             SET status = 'EXPIRED', resolved_at = ?
             WHERE id = ? AND status = 'PENDING'`
          )
          .bind(now, voidReq.id),
        c.env.DB
          .prepare(
            `UPDATE transactions
             SET status = 'COMPLETED'
             WHERE id = ? AND status = 'VOID_PENDING'`
          )
          .bind(voidReq.transaction_id),
      ]);
    }
    return errorResponse(
      c,
      410,
      'VOID_TOKEN_EXPIRED',
      'Tautan persetujuan void telah kedaluwarsa (batas waktu 5 menit)'
    );
  }

  if (voidReq.status !== 'PENDING') {
    return errorResponse(
      c,
      400,
      'VALIDATION_ERROR',
      `Permohonan void berstatus '${voidReq.status}' tidak dapat diproses`
    );
  }

  // Execute atomic void reversal
  try {
    await executeAtomicVoid({
      db: c.env.DB,
      voidRequestId: voidReq.id,
      transactionId: voidReq.transaction_id,
      invoiceNumber: voidReq.invoice_number,
      reason: voidReq.reason,
      approvedBy: 'ONE_CLICK_LINK',
      cashierId: voidReq.cashier_id,
      customerId: voidReq.customer_id,
      totalAmount: voidReq.total_amount,
    });
  } catch (err: unknown) {
    if ((err as Error)?.message === 'ALREADY_VOIDED_OR_RESOLVED') {
      return errorResponse(
        c,
        409,
        'ALREADY_VOIDED',
        `Transaksi (${voidReq.invoice_number}) sudah dibatalkan sebelumnya`
      );
    }
    console.error('Failed to execute atomic void reversal:', err);
    return errorResponse(c, 500, 'INTERNAL_ERROR', 'Gagal memproses pembatalan transaksi');
  }

  return c.json({
    status: 'VOIDED',
    message: `Transaksi ${voidReq.invoice_number} berhasil dibatalkan oleh Owner via tautan One-Click`,
  });
});

/**
 * 5. POST /api/void/verify-otp (Aktor: Kasir)
 * Memverifikasi 6-digit angka OTP yang dimasukkan kasir.
 * Mencocokkan SHA-256 hash dengan otp_hash di void_requests.
 * Mencatat void_approved_by = 'OTP_ENTRY'
 */
voidRouter.post('/verify-otp', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, 'VALIDATION_ERROR', 'Format JSON request tidak valid');
  }

  const parseResult = VerifyVoidOtpSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(
      c,
      400,
      'VALIDATION_ERROR',
      parseResult.error.errors[0]?.message || 'Payload verifikasi OTP tidak valid'
    );
  }

  const { void_request_id, otp_code } = parseResult.data;

  const voidReq = await c.env.DB
    .prepare(
      `SELECT vr.*, t.invoice_number, t.customer_id, t.total_amount,
              t.status as tx_status, t.cashier_id, t.id as transaction_id
       FROM void_requests vr
       JOIN transactions t ON t.id = vr.transaction_id
       WHERE vr.id = ?`
    )
    .bind(void_request_id)
    .first<VoidRequestWithTx>();

  if (!voidReq) {
    return errorResponse(
      c,
      404,
      'NOT_FOUND',
      `Permohonan void dengan ID '${void_request_id}' tidak ditemukan`
    );
  }

  if (voidReq.status === 'APPROVED' || voidReq.tx_status === 'VOIDED') {
    return errorResponse(
      c,
      409,
      'ALREADY_VOIDED',
      `Transaksi (${voidReq.invoice_number}) sudah dibatalkan sebelumnya`
    );
  }

  const now = Date.now();
  if (voidReq.status === 'EXPIRED' || now > voidReq.expires_at) {
    if (voidReq.status === 'PENDING') {
      await c.env.DB.batch([
        c.env.DB
          .prepare(
            `UPDATE void_requests
             SET status = 'EXPIRED', resolved_at = ?
             WHERE id = ? AND status = 'PENDING'`
          )
          .bind(now, voidReq.id),
        c.env.DB
          .prepare(
            `UPDATE transactions
             SET status = 'COMPLETED'
             WHERE id = ? AND status = 'VOID_PENDING'`
          )
          .bind(voidReq.transaction_id),
      ]);
    }
    return errorResponse(
      c,
      410,
      'VOID_TOKEN_EXPIRED',
      'Kode OTP telah kedaluwarsa (batas waktu 5 menit)'
    );
  }

  if (voidReq.status !== 'PENDING') {
    return errorResponse(
      c,
      400,
      'VALIDATION_ERROR',
      `Permohonan void berstatus '${voidReq.status}' tidak dapat diproses`
    );
  }

  // Verify OTP SHA-256 hash
  const inputHash = await hashOtp(otp_code);
  if (inputHash !== voidReq.otp_hash) {
    return errorResponse(
      c,
      400,
      'VALIDATION_ERROR',
      'Kode OTP yang dimasukkan tidak sesuai'
    );
  }

  // Execute atomic void reversal
  try {
    await executeAtomicVoid({
      db: c.env.DB,
      voidRequestId: voidReq.id,
      transactionId: voidReq.transaction_id,
      invoiceNumber: voidReq.invoice_number,
      reason: voidReq.reason,
      approvedBy: 'OTP_ENTRY',
      cashierId: voidReq.cashier_id,
      customerId: voidReq.customer_id,
      totalAmount: voidReq.total_amount,
    });
  } catch (err: unknown) {
    if ((err as Error)?.message === 'ALREADY_VOIDED_OR_RESOLVED') {
      return errorResponse(
        c,
        409,
        'ALREADY_VOIDED',
        `Transaksi (${voidReq.invoice_number}) sudah dibatalkan sebelumnya`
      );
    }
    console.error('Failed to execute atomic void reversal:', err);
    return errorResponse(c, 500, 'INTERNAL_ERROR', 'Gagal memproses pembatalan transaksi');
  }

  return c.json({
    status: 'VOIDED',
    message: `Transaksi ${voidReq.invoice_number} berhasil dibatalkan via verifikasi OTP`,
  });
});
