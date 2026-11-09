import { describe, it, expect } from 'vitest';
import { KoncokuLocalDB } from '../src/db/localDb';
import { PosRepository } from '../src/services/posRepository';

describe('Local Database & PosRepository Port', () => {
  it('instantiates KoncokuLocalDB with proper tables and schema definitions', () => {
    const db = new KoncokuLocalDB('TestKoncokuDB');
    expect(db).toBeInstanceOf(KoncokuLocalDB);

    // Verify table definitions exist in Dexie schema
    const tableNames = db.tables.map((t) => t.name);
    expect(tableNames).toContain('products');
    expect(tableNames).toContain('customers');
    expect(tableNames).toContain('sync_meta');
    expect(tableNames).toContain('offline_tx_queue');

    // Verify indexed primary keys and indices
    const productsTable = db.table('products');
    expect(productsTable.schema.primKey.name).toBe('id');

    const customersTable = db.table('customers');
    expect(customersTable.schema.primKey.name).toBe('id');
    const phoneIndex = customersTable.schema.indexes.find((i) => i.name === 'phone');
    expect(phoneIndex?.unique).toBe(true);

    const queueTable = db.table('offline_tx_queue');
    expect(queueTable.schema.primKey.name).toBe('idempotency_key');
  });

  it('instantiates PosRepository with abstraction interface', () => {
    const db = new KoncokuLocalDB('TestRepoDB');
    const repo = new PosRepository(db);

    expect(repo).toBeDefined();
    expect(typeof repo.syncCatalogIfNeeded).toBe('function');
    expect(typeof repo.searchProductsLocal).toBe('function');
    expect(typeof repo.searchCustomersByPhonePrefix).toBe('function');
    expect(typeof repo.submitTransaction).toBe('function');
    expect(typeof repo.requestVoid).toBe('function');
    expect(typeof repo.verifyVoidOtp).toBe('function');
    expect(typeof repo.pollVoidStatus).toBe('function');
  });
});
