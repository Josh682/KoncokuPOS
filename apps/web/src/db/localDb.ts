import Dexie, { type EntityTable, type DexieOptions } from 'dexie';
import type {
  LocalProduct,
  LocalCustomer,
  SyncMeta,
  OfflineTxQueueItem,
} from '@koncoku/shared';

export type { LocalProduct, LocalCustomer, SyncMeta, OfflineTxQueueItem };

export class KoncokuLocalDB extends Dexie {
  products!: EntityTable<LocalProduct, 'id'>;
  customers!: EntityTable<LocalCustomer, 'id'>;
  sync_meta!: EntityTable<SyncMeta, 'key'>;
  offline_tx_queue!: EntityTable<OfflineTxQueueItem, 'idempotency_key'>;

  constructor(dbName = 'KoncokuLocalDB', options?: DexieOptions) {
    super(dbName, options);
    this.version(1).stores({
      products: 'id, &sku, name, category, is_available',
      customers: 'id, &phone, name',
      sync_meta: 'key',
      offline_tx_queue: 'idempotency_key, created_at, status',
    });
  }
}

// Global singleton instance for browser runtime
export const localDb = new KoncokuLocalDB();
