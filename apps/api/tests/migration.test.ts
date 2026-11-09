import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

describe('D1 SQLite Database Migrations & Constraints Integrity', () => {
  let db: DatabaseSync;

  const schemaPath = path.resolve(__dirname, '../migrations/0001_init_schema.sql');
  const seedPath = path.resolve(__dirname, '../migrations/seed.sql');

  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const seedSql = fs.readFileSync(seedPath, 'utf8');

  beforeEach(() => {
    // In-memory SQLite database
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
  });

  it('successfully applies 0001_init_schema.sql and seed.sql', () => {
    expect(() => {
      db.exec(schemaSql);
      db.exec(seedSql);
    }).not.toThrow();

    // Verify system_meta catalog_version
    const metaStmt = db.prepare("SELECT meta_value FROM system_meta WHERE meta_key = 'catalog_version'");
    const meta = metaStmt.get() as { meta_value: string };
    expect(meta.meta_value).toBe('1');

    // Verify seeded users (Owner & Cashier)
    const usersStmt = db.prepare('SELECT id, name, role, is_active FROM users ORDER BY role ASC');
    const users = usersStmt.all() as Array<{ id: string; name: string; role: string; is_active: number }>;
    expect(users).toHaveLength(2);
    expect(users.find((u) => u.role === 'OWNER')).toBeDefined();
    expect(users.find((u) => u.role === 'CASHIER')).toBeDefined();

    // Verify seeded products across all 7 categories
    const countStmt = db.prepare('SELECT COUNT(DISTINCT category) as cat_count FROM products');
    const result = countStmt.get() as { cat_count: number };
    expect(result.cat_count).toBe(7);

    // Verify both TRACKED_STOCK and AVAILABILITY_ONLY exist
    const typesStmt = db.prepare('SELECT DISTINCT inventory_type FROM products');
    const types = (typesStmt.all() as Array<{ inventory_type: string }>).map((t) => t.inventory_type);
    expect(types).toContain('TRACKED_STOCK');
    expect(types).toContain('AVAILABILITY_ONLY');
  });

  describe('Database CHECK & FOREIGN KEY Constraints Enforcement', () => {
    beforeEach(() => {
      db.exec(schemaSql);
    });

    it('rejects product with invalid category', () => {
      expect(() => {
        db.exec(`
          INSERT INTO products (id, sku, name, category, inventory_type, sell_price, cost_price, stock_qty, unit, is_available, version, updated_at)
          VALUES ('p1', 'SKU-ERR-1', 'Invalid Product', 'INVALID_CATEGORY', 'TRACKED_STOCK', 10000, 5000, 10, 'pcs', 1, 1, 1000);
        `);
      }).toThrow(/constraint/i);
    });

    it('rejects product with invalid inventory_type', () => {
      expect(() => {
        db.exec(`
          INSERT INTO products (id, sku, name, category, inventory_type, sell_price, cost_price, stock_qty, unit, is_available, version, updated_at)
          VALUES ('p2', 'SKU-ERR-2', 'Invalid Type', 'COFFEE', 'UNLIMITED_STOCK', 10000, 5000, 10, 'pcs', 1, 1, 1000);
        `);
      }).toThrow(/constraint/i);
    });

    it('rejects product with negative sell_price', () => {
      expect(() => {
        db.exec(`
          INSERT INTO products (id, sku, name, category, inventory_type, sell_price, cost_price, stock_qty, unit, is_available, version, updated_at)
          VALUES ('p3', 'SKU-ERR-3', 'Negative Price', 'COFFEE', 'AVAILABILITY_ONLY', -5000, 5000, 0, 'pcs', 1, 1, 1000);
        `);
      }).toThrow(/constraint/i);
    });

    it('rejects user with invalid role', () => {
      expect(() => {
        db.exec(`
          INSERT INTO users (id, name, role, pin_hash, is_active, created_at)
          VALUES ('u1', 'Super Admin', 'SUPER_ADMIN', 'dummy_hash', 1, 1000);
        `);
      }).toThrow(/constraint/i);
    });

    it('rejects transaction with invalid payment method', () => {
      db.exec(seedSql);
      expect(() => {
        db.exec(`
          INSERT INTO transactions (
            id, idempotency_key, invoice_number, cashier_id, payment_method,
            total_amount, total_cost_amount, status, created_at
          ) VALUES (
            'tx1', 'idemp-1', 'INV-001', '01931000-0000-7000-8000-000000000002', 'BITCOIN',
            50000, 30000, 'COMPLETED', 1000
          );
        `);
      }).toThrow(/constraint/i);
    });

    it('rejects transaction with invalid status', () => {
      db.exec(seedSql);
      expect(() => {
        db.exec(`
          INSERT INTO transactions (
            id, idempotency_key, invoice_number, cashier_id, payment_method,
            total_amount, total_cost_amount, status, created_at
          ) VALUES (
            'tx2', 'idemp-2', 'INV-002', '01931000-0000-7000-8000-000000000002', 'QRIS',
            50000, 30000, 'CANCELLED_UNOFFICIAL', 1000
          );
        `);
      }).toThrow(/constraint/i);
    });

    it('rejects transaction_item with non-positive qty (0 or negative)', () => {
      db.exec(seedSql);
      // Create valid transaction first
      db.exec(`
        INSERT INTO transactions (
          id, idempotency_key, invoice_number, cashier_id, payment_method,
          total_amount, total_cost_amount, status, created_at
        ) VALUES (
          'tx3', 'idemp-3', 'INV-003', '01931000-0000-7000-8000-000000000002', 'CASH',
          28000, 9000, 'COMPLETED', 1000
        );
      `);

      expect(() => {
        db.exec(`
          INSERT INTO transaction_items (
            id, transaction_id, product_id, product_name_snapshot, category_snapshot,
            qty, sell_price_snapshot, cost_price_snapshot, subtotal
          ) VALUES (
            'ti1', 'tx3', '01931000-0000-7000-8000-000000000011', 'Caffe Latte', 'COFFEE',
            0, 28000, 9000, 0
          );
        `);
      }).toThrow(/constraint/i);
    });

    it('enforces foreign key constraint on cashier_id in transactions', () => {
      expect(() => {
        db.exec(`
          INSERT INTO transactions (
            id, idempotency_key, invoice_number, cashier_id, payment_method,
            total_amount, total_cost_amount, status, created_at
          ) VALUES (
            'tx4', 'idemp-4', 'INV-004', 'non-existent-cashier-id', 'CASH',
            28000, 9000, 'COMPLETED', 1000
          );
        `);
      }).toThrow(/foreign key/i);
    });
  });
});
