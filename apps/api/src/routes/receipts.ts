import { Hono } from 'hono';
import type { PublicReceiptData, PublicReceiptItemData, TransactionEntity } from '@koncoku/shared';
import type { AppContext } from '../types';
import { errorResponse } from '../utils/errors';

export const receiptsRouter = new Hono<AppContext>();

receiptsRouter.get('/:invoice', async (c) => {
  const invoice = c.req.param('invoice');

  const tx = await c.env.DB
    .prepare(
      `SELECT t.*, u.name as cashier_name
       FROM transactions t
       LEFT JOIN users u ON u.id = t.cashier_id
       WHERE t.invoice_number = ?`
    )
    .bind(invoice)
    .first<TransactionEntity & { cashier_name?: string }>();

  if (!tx) {
    return errorResponse(
      c,
      404,
      'NOT_FOUND',
      `Struk dengan nomor invoice '${invoice}' tidak ditemukan`,
      { invoice }
    );
  }

  const items = await c.env.DB
    .prepare(
      `SELECT product_id, product_name_snapshot, category_snapshot, qty, sell_price_snapshot, subtotal
       FROM transaction_items
       WHERE transaction_id = ?`
    )
    .bind(tx.id)
    .all<PublicReceiptItemData>();

  // Ensure NO cost_price_snapshot or total_cost_amount is exposed
  const receipt: PublicReceiptData = {
    invoice_number: tx.invoice_number,
    created_at: tx.created_at,
    status: tx.status,
    payment_method: tx.payment_method,
    payment_reference: tx.payment_reference,
    total_amount: tx.total_amount,
    cash_received: tx.cash_received,
    change_amount: tx.change_amount,
    customer_name_snapshot: tx.customer_name_snapshot,
    customer_phone_snapshot: tx.customer_phone_snapshot,
    cashier_name: tx.cashier_name || 'Kasir',
    items: items.results || [],
  };

  return c.json(receipt, 200);
});
