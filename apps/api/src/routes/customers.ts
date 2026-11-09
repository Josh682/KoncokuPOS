import { Hono } from 'hono';
import type { LocalCustomer } from '@koncoku/shared';
import type { AppContext } from '../types';

export const customersRouter = new Hono<AppContext>();

customersRouter.get('/search', async (c) => {
  const query = c.req.query('q')?.trim() || '';

  if (!query || query.length < 2) {
    return c.json({ customers: [] }, 200);
  }

  const results = await c.env.DB
    .prepare(
      `SELECT id, phone, name, visit_count, last_visit_at
       FROM customers
       WHERE phone LIKE '%' || ? || '%' OR name LIKE '%' || ? || '%'
       ORDER BY last_visit_at DESC
       LIMIT 20`
    )
    .bind(query, query)
    .all<LocalCustomer>();

  return c.json({ customers: results.results || [] }, 200);
});
