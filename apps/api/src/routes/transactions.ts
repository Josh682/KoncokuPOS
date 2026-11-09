import { Hono } from 'hono';
import {
  CreateTransactionSchema,
  generateUUIDv7,
  type ProductEntity,
  type TransactionEntity,
  type PublicReceiptData,
  type PublicReceiptItemData,
} from '@koncoku/shared';
import type { AppContext } from '../types';
import { errorResponse } from '../utils/errors';
import { generateUniqueInvoiceNumber } from '../utils/invoice';
import { getNotificationProvider } from '../providers/notification';

export const transactionsRouter = new Hono<AppContext>();

transactionsRouter.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, 'VALIDATION_ERROR', 'Format JSON request tidak valid');
  }

  const parseResult = CreateTransactionSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(
      c,
      400,
      'VALIDATION_ERROR',
      parseResult.error.errors[0]?.message || 'Payload transaksi tidak valid',
      { errors: parseResult.error.flatten() as unknown as Record<string, unknown> }
    );
  }

  const payload = parseResult.data;
  const user = c.get('user');
  const cashierId = user?.id || '01931000-0000-7000-8000-000000000002';
  const cashierName = user?.name || 'Kasir Utama';

  // 1. IDEMPOTENCY CHECK: If idempotency_key already exists, return existing receipt without re-processing
  const existingTx = await c.env.DB
    .prepare(
      `SELECT t.*, u.name as cashier_name
       FROM transactions t
       LEFT JOIN users u ON u.id = t.cashier_id
       WHERE t.idempotency_key = ?`
    )
    .bind(payload.idempotency_key)
    .first<TransactionEntity & { cashier_name?: string }>();

  if (existingTx) {
    const existingItems = await c.env.DB
      .prepare(
        `SELECT product_id, product_name_snapshot, category_snapshot, qty, sell_price_snapshot, subtotal
         FROM transaction_items
         WHERE transaction_id = ?`
      )
      .bind(existingTx.id)
      .all<PublicReceiptItemData>();

    const receipt: PublicReceiptData = {
      invoice_number: existingTx.invoice_number,
      created_at: existingTx.created_at,
      status: existingTx.status,
      payment_method: existingTx.payment_method,
      payment_reference: existingTx.payment_reference,
      total_amount: existingTx.total_amount,
      cash_received: existingTx.cash_received,
      change_amount: existingTx.change_amount,
      customer_name_snapshot: existingTx.customer_name_snapshot,
      customer_phone_snapshot: existingTx.customer_phone_snapshot,
      cashier_name: existingTx.cashier_name || cashierName,
      items: existingItems.results || [],
    };

    return c.json(receipt, 200);
  }

  // 2. ZERO-TRUST CLIENT PRICING & STOCK CHECK
  // Fetch fresh product records from D1 for all items
  const productMap = new Map<string, ProductEntity>();

  for (const item of payload.items) {
    if (!productMap.has(item.product_id)) {
      const product = await c.env.DB
        .prepare('SELECT * FROM products WHERE id = ?')
        .bind(item.product_id)
        .first<ProductEntity>();

      if (!product) {
        return errorResponse(
          c,
          404,
          'NOT_FOUND',
          `Produk dengan ID '${item.product_id}' tidak ditemukan di katalog`,
          { product_id: item.product_id }
        );
      }

      productMap.set(item.product_id, product);
    }
  }

  // Aggregate quantity per product (if client repeats product in cart)
  const qtyPerProduct = new Map<string, number>();
  for (const item of payload.items) {
    const current = qtyPerProduct.get(item.product_id) || 0;
    qtyPerProduct.set(item.product_id, current + item.qty);
  }

  // Validate availability and stock constraints
  for (const [productId, totalQty] of qtyPerProduct.entries()) {
    const product = productMap.get(productId)!;

    if (product.is_available !== 1) {
      return errorResponse(
        c,
        409,
        'PRODUCT_UNAVAILABLE',
        `Produk '${product.name}' sedang tidak tersedia`,
        { product_id: product.id }
      );
    }

    if (product.inventory_type === 'TRACKED_STOCK' && product.stock_qty < totalQty) {
      return errorResponse(
        c,
        409,
        'INSUFFICIENT_STOCK',
        `Stok ${product.name} tidak mencukupi (Sisa: ${product.stock_qty}, Diminta: ${totalQty})`,
        { product_id: product.id, available_qty: product.stock_qty }
      );
    }
  }

  // Recalculate price & HPP strictly on server (Integer currency only)
  let totalAmount = 0;
  let totalCostAmount = 0;

  interface ItemCalculation {
    id: string;
    product_id: string;
    product_name_snapshot: string;
    category_snapshot: string;
    qty: number;
    sell_price_snapshot: number;
    cost_price_snapshot: number;
    subtotal: number;
  }

  const calculatedItems: ItemCalculation[] = [];
  const receiptItems: PublicReceiptItemData[] = [];

  for (const item of payload.items) {
    const product = productMap.get(item.product_id)!;
    const sellPrice = Math.round(product.sell_price);
    const costPrice = Math.round(product.cost_price);
    const subtotal = Math.round(item.qty * sellPrice);
    const costSubtotal = Math.round(item.qty * costPrice);

    totalAmount += subtotal;
    totalCostAmount += costSubtotal;

    const itemId = generateUUIDv7();

    calculatedItems.push({
      id: itemId,
      product_id: product.id,
      product_name_snapshot: product.name,
      category_snapshot: product.category,
      qty: item.qty,
      sell_price_snapshot: sellPrice,
      cost_price_snapshot: costPrice,
      subtotal,
    });

    receiptItems.push({
      product_id: product.id,
      product_name_snapshot: product.name,
      category_snapshot: product.category,
      qty: item.qty,
      sell_price_snapshot: sellPrice,
      subtotal,
    });
  }

  // Payment method validation and change calculation
  let cashReceived: number | null = null;
  let changeAmount: number | null = null;

  if (payload.payment_method === 'CASH') {
    if (payload.cash_received === undefined || payload.cash_received < totalAmount) {
      return errorResponse(
        c,
        400,
        'VALIDATION_ERROR',
        `Nominal uang tunai (Rp ${(payload.cash_received || 0).toLocaleString('id-ID')}) kurang dari total tagihan (Rp ${totalAmount.toLocaleString('id-ID')})`
      );
    }
    cashReceived = payload.cash_received;
    changeAmount = payload.cash_received - totalAmount;
  } else {
    cashReceived = totalAmount;
    changeAmount = 0;
  }

  const now = Date.now();
  const transactionId = generateUUIDv7();
  const invoiceNumber = await generateUniqueInvoiceNumber(c.env.DB);

  // 3. PREPARE ATOMIC D1 BATCH
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const statements: any[] = [];

  // Customer CRM Upsert
  let customerId: string | null = null;
  if (payload.customer) {
    const existingCustomer = await c.env.DB
      .prepare('SELECT id FROM customers WHERE phone = ?')
      .bind(payload.customer.phone)
      .first<{ id: string }>();

    customerId = existingCustomer?.id || generateUUIDv7();

    statements.push(
      c.env.DB
        .prepare(
          `INSERT INTO customers (id, phone, name, visit_count, total_spent, last_visit_at, created_at)
           VALUES (?, ?, ?, 1, ?, ?, ?)
           ON CONFLICT(phone) DO UPDATE SET
             name = excluded.name,
             visit_count = visit_count + 1,
             total_spent = total_spent + excluded.total_spent,
             last_visit_at = excluded.last_visit_at`
        )
        .bind(
          customerId,
          payload.customer.phone,
          payload.customer.name,
          totalAmount,
          now,
          now
        )
    );
  }

  // Insert Transaction Header
  statements.push(
    c.env.DB
      .prepare(
        `INSERT INTO transactions (
           id, idempotency_key, invoice_number, cashier_id, customer_id,
           customer_name_snapshot, customer_phone_snapshot, payment_method,
           payment_reference, total_amount, total_cost_amount, cash_received,
           change_amount, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?)`
      )
      .bind(
        transactionId,
        payload.idempotency_key,
        invoiceNumber,
        cashierId,
        customerId,
        payload.customer?.name || null,
        payload.customer?.phone || null,
        payload.payment_method,
        payload.payment_reference || null,
        totalAmount,
        totalCostAmount,
        cashReceived,
        changeAmount,
        now
      )
  );

  // Insert Transaction Items
  for (const item of calculatedItems) {
    statements.push(
      c.env.DB
        .prepare(
          `INSERT INTO transaction_items (
             id, transaction_id, product_id, product_name_snapshot,
             category_snapshot, qty, sell_price_snapshot, cost_price_snapshot, subtotal
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          item.id,
          transactionId,
          item.product_id,
          item.product_name_snapshot,
          item.category_snapshot,
          item.qty,
          item.sell_price_snapshot,
          item.cost_price_snapshot,
          item.subtotal
        )
    );
  }

  // Stock deduction & Inventory logs for TRACKED_STOCK
  let hasTrackedStockSold = false;

  for (const [productId, soldQty] of qtyPerProduct.entries()) {
    const product = productMap.get(productId)!;
    if (product.inventory_type === 'TRACKED_STOCK') {
      hasTrackedStockSold = true;
      const stockAfter = product.stock_qty - soldQty;

      // Conditional atomic update
      statements.push(
        c.env.DB
          .prepare(
            `UPDATE products
             SET stock_qty = stock_qty - ?,
                 version = version + 1,
                 updated_at = ?
             WHERE id = ?`
          )
          .bind(soldQty, now, productId)
      );

      // Append-Only Inventory Log
      statements.push(
        c.env.DB
          .prepare(
            `INSERT INTO inventory_logs (
               id, product_id, transaction_id, change_type, qty_delta,
               stock_after, notes, created_by, created_at
             ) VALUES (?, ?, ?, 'SALE', ?, ?, ?, ?, ?)`
          )
          .bind(
            generateUUIDv7(),
            productId,
            transactionId,
            -soldQty,
            stockAfter,
            `Penjualan kasir (${invoiceNumber})`,
            cashierId,
            now
          )
      );
    }
  }

  // Increment global catalog_version if tracked stock modified
  if (hasTrackedStockSold) {
    statements.push(
      c.env.DB
        .prepare(
          `UPDATE system_meta
           SET meta_value = CAST(CAST(meta_value AS INTEGER) + 1 AS TEXT),
               updated_at = ?
           WHERE meta_key = 'catalog_version'`
        )
        .bind(now)
    );
  }

  // 4. ATOMIC EXECUTION VIA env.DB.batch
  try {
    await c.env.DB.batch(statements);
  } catch (err: unknown) {
    const errMsg = (err as Error)?.message || '';
    if (errMsg.includes('INSUFFICIENT_STOCK')) {
      return errorResponse(
        c,
        409,
        'INSUFFICIENT_STOCK',
        'Stok tidak mencukupi untuk memproses pesanan akibat perubahan stok konkuren'
      );
    }
    console.error('Failed to execute checkout batch in D1:', err);
    return errorResponse(c, 500, 'INTERNAL_ERROR', 'Gagal memproses transaksi di database');
  }

  // 5. CONSTRUCT RECEIPT & ASYNC OWNER AUDIT
  const publicReceipt: PublicReceiptData = {
    invoice_number: invoiceNumber,
    created_at: now,
    status: 'COMPLETED',
    payment_method: payload.payment_method,
    payment_reference: payload.payment_reference || null,
    total_amount: totalAmount,
    cash_received: cashReceived,
    change_amount: changeAmount,
    customer_name_snapshot: payload.customer?.name || null,
    customer_phone_snapshot: payload.customer?.phone || null,
    cashier_name: cashierName,
    items: receiptItems,
  };

  const auditPayload = {
    ...publicReceipt,
    totalCostAmount,
    grossProfit: totalAmount - totalCostAmount,
  };

  const notificationProvider =
    c.get('notificationProvider') || getNotificationProvider(c.env);

  const backgroundTask = notificationProvider
    .sendOwnerAuditReceipt(auditPayload)
    .catch((err) => {
      console.error('Safe background audit notification error:', err);
    });

  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(backgroundTask);
  }

  return c.json(publicReceipt, 200);
});

/**
 * GET /api/transactions
 * Mengambil daftar riwayat transaksi kasir (hari ini / terbaru)
 */
transactionsRouter.get('/', async (c) => {
  const limitParam = c.req.query('limit');
  const limit = Math.min(100, Math.max(1, parseInt(limitParam || '50', 10) || 50));

  const rows = await c.env.DB
    .prepare(
      `SELECT t.id, t.invoice_number, t.created_at, t.status, t.payment_method,
              t.total_amount, t.cash_received, t.change_amount, t.voided_at,
              t.void_reason, t.void_approved_by,
              COALESCE(u.name, 'Kasir') as cashier_name,
              t.customer_name_snapshot, t.customer_phone_snapshot,
              (SELECT COUNT(*) FROM transaction_items WHERE transaction_id = t.id) as items_count,
              (SELECT id FROM void_requests WHERE transaction_id = t.id AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1) as active_void_request_id,
              (SELECT expires_at FROM void_requests WHERE transaction_id = t.id AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1) as void_expires_at
       FROM transactions t
       LEFT JOIN users u ON u.id = t.cashier_id
       ORDER BY t.created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all();

  return c.json({
    transactions: rows.results || [],
  });
});
