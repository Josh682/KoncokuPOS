import { Hono } from 'hono';
import type { AppContext, Env } from './types';
import { authRouter } from './routes/auth';
import { catalogRouter } from './routes/catalog';
import { transactionsRouter } from './routes/transactions';
import { receiptsRouter } from './routes/receipts';
import { customersRouter } from './routes/customers';
import { voidRouter } from './routes/void';
import { errorResponse } from './utils/errors';

export * from './types';
export * from './middleware/auth';
export * from './providers/notification';
export * from './utils/errors';
export * from './utils/invoice';
export * from './routes/void';

export const app = new Hono<AppContext>();

// Global error handler
app.onError((err, c) => {
  console.error('Unhandled API Error:', err);
  return errorResponse(c, 500, 'INTERNAL_ERROR', 'Terjadi kesalahan internal pada server');
});

// Root healthcheck
app.get('/', (c) => c.text('Koncoku POS API Online'));

// Mount routes
app.route('/api/auth', authRouter);
app.route('/api/catalog', catalogRouter);
app.route('/api/transactions', transactionsRouter);
app.route('/api/receipts', receiptsRouter);
app.route('/api/customers', customersRouter);
app.route('/api/void', voidRouter);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return await app.fetch(request, env, ctx);
  },
};
