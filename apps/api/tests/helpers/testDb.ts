/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

export interface TestD1Database {
  d1: D1Database;
  sqlite: any;
}

export function createTestDb(): TestD1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  const schemaPath = path.resolve(__dirname, '../../migrations/0001_init_schema.sql');
  const seedPath = path.resolve(__dirname, '../../migrations/seed.sql');

  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const seedSql = fs.readFileSync(seedPath, 'utf8');

  sqlite.exec(schemaSql);
  sqlite.exec(seedSql);

  const d1: D1Database = {
    prepare(query: string) {
      let boundValues: unknown[] = [];
      const prepared = {
        bind(...values: unknown[]) {
          boundValues = values.map((v) => (v === undefined ? null : v));
          return prepared;
        },
        async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
          const stmt = sqlite.prepare(query);
          const row = stmt.get(...boundValues) as Record<string, unknown> | undefined;
          if (!row) return null;
          return (colName ? row[colName] : row) as T;
        },
        async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
          const stmt = sqlite.prepare(query);
          const results = stmt.all(...boundValues) as T[];
          return {
            results,
            success: true,
            meta: {} as any,
          };
        },
        async run(): Promise<D1Response> {
          const stmt = sqlite.prepare(query);
          const info = stmt.run(...boundValues);
          return {
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: Number(info.lastInsertRowid),
              duration: 0,
              served_by: 'local-test-sqlite',
            } as any,
          };
        },
        _executeInternal(): { success: boolean; meta: any; results: any[] } {
          const stmt = sqlite.prepare(query);
          const info = stmt.run(...boundValues);
          return {
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: Number(info.lastInsertRowid),
            },
            results: [],
          };
        },
      };
      return prepared as any;
    },
    async batch<T = unknown>(statements: any[]): Promise<D1Result<T>[]> {
      sqlite.exec('BEGIN TRANSACTION;');
      try {
        const results: D1Result<T>[] = [];
        for (const s of statements) {
          const r = s._executeInternal();
          results.push(r);
        }
        sqlite.exec('COMMIT;');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK;');
        throw err;
      }
    },
    async exec(query: string): Promise<D1ExecResult> {
      sqlite.exec(query);
      return { count: 1, duration: 0 };
    },
    dump(): Promise<ArrayBuffer> {
      throw new Error('Not implemented');
    },
  };

  return { d1, sqlite };
}
