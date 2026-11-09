import { Hono } from 'hono';
import type { LocalProduct, LocalCustomer } from '@koncoku/shared';
import type { AppContext } from '../types';

export const catalogRouter = new Hono<AppContext>();

catalogRouter.get('/sync', async (c) => {
  const versionParam = c.req.query('version');
  const clientVersion = versionParam !== undefined ? parseInt(versionParam, 10) : null;

  // 1. Read catalog_version from system_meta (Zero-Read optimization)
  const metaRow = await c.env.DB
    .prepare("SELECT meta_value FROM system_meta WHERE meta_key = 'catalog_version'")
    .first<{ meta_value: string }>();

  const currentVersion = parseInt(metaRow?.meta_value || '1', 10);

  // 2. Zero-Read Check: If version is identical, immediately return 304 without touching products table
  if (clientVersion !== null && !isNaN(clientVersion) && clientVersion === currentVersion) {
    return c.body(null, 304);
  }

  // 3. Version mismatch or initial sync: read products WITHOUT cost_price (HPP)
  const productsResult = await c.env.DB
    .prepare(
      `SELECT id, sku, name, category, inventory_type, sell_price, stock_qty, unit, is_available, image_url, version
       FROM products
       ORDER BY category ASC, name ASC`
    )
    .all<LocalProduct>();

  const customersResult = await c.env.DB
    .prepare(
      `SELECT id, phone, name, visit_count, last_visit_at
       FROM customers
       ORDER BY last_visit_at DESC
       LIMIT 1000`
    )
    .all<LocalCustomer>();

  return c.json({
    version: currentVersion,
    products: productsResult.results || [],
    customers: customersResult.results || [],
  });
});
