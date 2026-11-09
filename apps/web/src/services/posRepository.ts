/**
 * Frontend Repository Port & Implementation
 * References:
 * - docs/ARCHITECTURE.md (Section 3.1)
 * - docs/specs/01-schema-and-dexie.md
 * - docs/specs/02-catalog-and-checkout.md
 */

import {
  type ProductCategory,
  type LocalProduct,
  type LocalCustomer,
  type CreateTransactionInput,
  type PublicReceiptData,
  type CreateVoidRequestInput,
  type VoidRequestStatus,
  type CatalogSyncResponse,
  type LoginResponse,
  type VoidApproveInfoResponse,
  type TransactionListItem,
  normalizeIndonesianPhone,
  generateUUIDv7,
} from '@koncoku/shared';
import { KoncokuLocalDB, localDb } from '../db/localDb';

export type ProductFilterCategory = ProductCategory | 'ALL';

export interface SyncCatalogResult {
  updated: boolean;
  version: number;
}

export interface VoidRequestResult {
  voidRequestId: string;
  expiresAt: number;
}

export interface AuthUserInfo {
  id: string;
  name: string;
  role: 'OWNER' | 'CASHIER';
}

export interface IPosRepository {
  // Katalog & Sinkronisasi Lokal (<10ms read dari Dexie.js)
  syncCatalogIfNeeded(): Promise<SyncCatalogResult>;
  syncCatalog(): Promise<SyncCatalogResult>;
  searchProductsLocal(query: string, category: ProductFilterCategory): Promise<LocalProduct[]>;

  // CRM Lokal & Auto-complete Pelanggan
  searchCustomersByPhonePrefix(partialPhone: string): Promise<LocalCustomer[]>;

  // Transaksi & Checkout
  submitTransaction(payload: CreateTransactionInput): Promise<PublicReceiptData>;
  submitCheckout(payload: CreateTransactionInput): Promise<PublicReceiptData>;
  getTransactions(limit?: number): Promise<TransactionListItem[]>;
  getPublicReceipt(invoice: string): Promise<PublicReceiptData>;

  // Alur Pembatalan (Void)
  requestVoid(payload: CreateVoidRequestInput): Promise<VoidRequestResult>;
  verifyVoidOtp(voidRequestId: string, otpCode: string): Promise<{ status: 'VOIDED' }>;
  pollVoidStatus(voidRequestId: string): Promise<{ status: VoidRequestStatus; invoiceNumber?: string }>;
  getVoidApproveInfo(token: string): Promise<VoidApproveInfoResponse>;
  approveVoidOneClick(token: string): Promise<{ status: 'VOIDED'; message: string }>;

  // Autentikasi Kasir & Sesi
  loginWithPin(pin: string, userId?: string): Promise<{ token: string; user: AuthUserInfo }>;
  getAuthToken(): string | null;
  setAuthToken(token: string | null): void;
  getCurrentUser(): AuthUserInfo | null;
  setCurrentUser(user: AuthUserInfo | null): void;
  logout(): void;
}

const STORAGE_KEY_TOKEN = 'koncoku_auth_token';
const STORAGE_KEY_USER = 'koncoku_auth_user';

/**
 * PosRepository Implementation
 * Mengabstraksikan penyimpanan Dexie.js dan komunikasi REST ke Cloudflare Workers
 */
export class PosRepository implements IPosRepository {
  public readonly db: KoncokuLocalDB;
  public readonly apiBaseUrl: string;
  private authToken: string | null = null;
  private currentUser: AuthUserInfo | null = null;

  constructor(db: KoncokuLocalDB = localDb, apiBaseUrl = '/api') {
    this.db = db;
    this.apiBaseUrl = apiBaseUrl;
    this.loadPersistedAuth();
  }

  private loadPersistedAuth(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const savedToken = window.localStorage.getItem(STORAGE_KEY_TOKEN);
        const savedUser = window.localStorage.getItem(STORAGE_KEY_USER);
        if (savedToken) {
          this.authToken = savedToken;
        }
        if (savedUser) {
          this.currentUser = JSON.parse(savedUser) as AuthUserInfo;
        }
      } catch {
        // Safe fallback in restricted environments
      }
    }
  }

  public getAuthToken(): string | null {
    return this.authToken;
  }

  public setAuthToken(token: string | null): void {
    this.authToken = token;
    if (typeof window !== 'undefined' && window.localStorage) {
      if (token) {
        window.localStorage.setItem(STORAGE_KEY_TOKEN, token);
      } else {
        window.localStorage.removeItem(STORAGE_KEY_TOKEN);
      }
    }
  }

  public getCurrentUser(): AuthUserInfo | null {
    return this.currentUser;
  }

  public setCurrentUser(user: AuthUserInfo | null): void {
    this.currentUser = user;
    if (typeof window !== 'undefined' && window.localStorage) {
      if (user) {
        window.localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
      } else {
        window.localStorage.removeItem(STORAGE_KEY_USER);
      }
    }
  }

  public logout(): void {
    this.setAuthToken(null);
    this.setCurrentUser(null);
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  /**
   * Fast 6-digit PIN login
   */
  async loginWithPin(pin: string, userId?: string): Promise<{ token: string; user: AuthUserInfo }> {
    const response = await fetch(`${this.apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, userId }),
    });

    if (!response.ok) {
      let message = 'Login gagal';
      try {
        const errJson = await response.json();
        message = errJson?.error?.message || message;
      } catch {
        // use default message
      }
      throw new Error(message);
    }

    const data = (await response.json()) as LoginResponse;
    const authData = {
      token: data.token,
      user: {
        id: data.user.id,
        name: data.user.name,
        role: data.user.role as 'OWNER' | 'CASHIER',
      },
    };

    this.setAuthToken(authData.token);
    this.setCurrentUser(authData.user);
    return authData;
  }

  /**
   * Zero-Read Catalog Sync
   * Mengirim catalog_version lokal ke GET /api/catalog/sync?version=X.
   * Jika 304 Not Modified, jangan ubah Dexie.js.
   * Jika 200 OK, perbarui tabel products, customers, dan sync_meta di Dexie.js secara atomik.
   */
  async syncCatalogIfNeeded(): Promise<SyncCatalogResult> {
    const currentMeta = await this.db.sync_meta.get('catalog_version');
    const localVersion = currentMeta ? parseInt(currentMeta.value, 10) : 0;

    try {
      const response = await fetch(
        `${this.apiBaseUrl}/catalog/sync?version=${encodeURIComponent(localVersion)}`,
        {
          headers: this.getAuthHeaders(),
        }
      );

      // 1. Zero-Read 304 Not Modified
      if (response.status === 304) {
        return { updated: false, version: localVersion };
      }

      if (!response.ok) {
        throw new Error(`Catalog sync failed with HTTP status ${response.status}`);
      }

      // 2. 200 OK — Atomic bulk update to Dexie.js
      const data = (await response.json()) as CatalogSyncResponse;

      await this.db.transaction('rw', [this.db.products, this.db.customers, this.db.sync_meta], async () => {
        if (data.products && Array.isArray(data.products)) {
          await this.db.products.clear();
          if (data.products.length > 0) {
            const sanitizedProducts: LocalProduct[] = data.products.map((p) => ({
              ...p,
              image_url: p.image_url ?? null,
            }));
            await this.db.products.bulkPut(sanitizedProducts);
          }
        }

        if (data.customers && Array.isArray(data.customers) && data.customers.length > 0) {
          await this.db.customers.bulkPut(data.customers);
        }

        await this.db.sync_meta.put({
          key: 'catalog_version',
          value: String(data.version),
          updated_at: Date.now(),
        });
      });

      return { updated: true, version: data.version };
    } catch (err) {
      // Offline fallback: don't crash UI, keep working with local Dexie
      console.warn('Sync catalog notice (offline or unreachable):', err);
      return { updated: false, version: localVersion };
    }
  }

  async syncCatalog(): Promise<SyncCatalogResult> {
    return this.syncCatalogIfNeeded();
  }

  /**
   * Zero-Latency Local Product Search (<10ms)
   * 0 HTTP calls — strictly from Dexie.js in IndexedDB
   */
  async searchProductsLocal(query: string, category: ProductFilterCategory): Promise<LocalProduct[]> {
    const trimmed = query.trim().toLowerCase();

    return this.db.products
      .filter((product) => {
        const matchesCategory = category === 'ALL' || product.category === category;
        const matchesQuery =
          !trimmed ||
          product.name.toLowerCase().includes(trimmed) ||
          product.sku.toLowerCase().includes(trimmed);
        return Boolean(matchesCategory && matchesQuery);
      })
      .toArray();
  }

  /**
   * Local CRM Auto-Complete (<10ms)
   * 0 HTTP calls — strictly from Dexie.js customers cache
   */
  async searchCustomersByPhonePrefix(partialPhone: string): Promise<LocalCustomer[]> {
    const trimmed = partialPhone.trim();
    if (!trimmed) return [];

    const cleanDigits = trimmed.replace(/\D/g, '');
    const normalizedDigits = normalizeIndonesianPhone(trimmed);

    return this.db.customers
      .filter((customer) => {
        const matchesPhone =
          (cleanDigits.length > 0 && customer.phone.includes(cleanDigits)) ||
          (normalizedDigits.length > 0 && customer.phone.includes(normalizedDigits));
        const matchesName = customer.name.toLowerCase().includes(trimmed.toLowerCase());
        return Boolean(matchesPhone || matchesName);
      })
      .limit(10)
      .toArray();
  }

  /**
   * Submit Checkout Transaction to Backend API
   * Zero-Trust Pricing is recalculated on server.
   * On success:
   * - Optimistically update Dexie.js product stock for TRACKED_STOCK
   * - Save/update customer in Dexie.js
   * - Trigger background sync
   */
  async submitTransaction(payload: CreateTransactionInput): Promise<PublicReceiptData> {
    const response = await fetch(`${this.apiBaseUrl}/transactions`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errorMessage = 'Gagal memproses transaksi';
      try {
        const errJson = await response.json();
        errorMessage = errJson?.error?.message || errorMessage;
      } catch {
        // use default message
      }
      throw new Error(errorMessage);
    }

    const receipt = (await response.json()) as PublicReceiptData;

    // 1. Optimistic local updates in Dexie.js
    try {
      await this.db.transaction('rw', [this.db.products, this.db.customers], async () => {
        // Optimistic stock reduction for TRACKED_STOCK
        for (const item of payload.items) {
          const product = await this.db.products.get(item.product_id);
          if (product && product.inventory_type === 'TRACKED_STOCK') {
            const nextStock = Math.max(0, product.stock_qty - item.qty);
            await this.db.products.update(product.id, {
              stock_qty: nextStock,
            });
          }
        }

        // Customer cache upsert
        if (payload.customer) {
          const normPhone = normalizeIndonesianPhone(payload.customer.phone);
          const existing = await this.db.customers.where('phone').equals(normPhone).first();
          if (existing) {
            await this.db.customers.update(existing.id, {
              name: payload.customer.name,
              visit_count: existing.visit_count + 1,
              last_visit_at: Date.now(),
            });
          } else {
            await this.db.customers.put({
              id: generateUUIDv7(),
              phone: normPhone,
              name: payload.customer.name,
              visit_count: 1,
              last_visit_at: Date.now(),
            });
          }
        }
      });
    } catch (localErr) {
      console.warn('Optimistic local update warning:', localErr);
    }

    // 2. Trigger non-blocking background catalog sync to reconcile version
    this.syncCatalogIfNeeded().catch(() => {
      // background reconcile ignored if fails
    });

    return receipt;
  }

  async submitCheckout(payload: CreateTransactionInput): Promise<PublicReceiptData> {
    return this.submitTransaction(payload);
  }

  /**
   * Void flow methods (Stubs for Stage 4)
   */
  async requestVoid(payload: CreateVoidRequestInput): Promise<VoidRequestResult> {
    const response = await fetch(`${this.apiBaseUrl}/void/request`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errorMessage = 'Gagal mengajukan permohonan void';
      try {
        const errJson = await response.json();
        errorMessage = errJson?.error?.message || errorMessage;
      } catch {
        // fallback
      }
      throw new Error(errorMessage);
    }

    return (await response.json()) as VoidRequestResult;
  }

  async verifyVoidOtp(voidRequestId: string, otpCode: string): Promise<{ status: 'VOIDED' }> {
    const response = await fetch(`${this.apiBaseUrl}/void/verify-otp`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ void_request_id: voidRequestId, otp_code: otpCode }),
    });

    if (!response.ok) {
      let errorMessage = 'Kode OTP tidak valid atau kedaluwarsa';
      try {
        const errJson = await response.json();
        errorMessage = errJson?.error?.message || errorMessage;
      } catch {
        // fallback
      }
      throw new Error(errorMessage);
    }

    return (await response.json()) as { status: 'VOIDED' };
  }

  async pollVoidStatus(voidRequestId: string): Promise<{ status: VoidRequestStatus; invoiceNumber?: string }> {
    const response = await fetch(`${this.apiBaseUrl}/void/status/${encodeURIComponent(voidRequestId)}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error('Gagal memeriksa status void');
    }

    return (await response.json()) as { status: VoidRequestStatus; invoiceNumber?: string };
  }

  /**
   * Mengambil riwayat transaksi kasir
   */
  async getTransactions(limit = 50): Promise<TransactionListItem[]> {
    const response = await fetch(`${this.apiBaseUrl}/transactions?limit=${limit}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error('Gagal memuat daftar riwayat transaksi');
    }

    const data = (await response.json()) as { transactions: TransactionListItem[] };
    return data.transactions || [];
  }

  /**
   * Mengambil data struk publik (tanpa login dan tanpa HPP)
   */
  async getPublicReceipt(invoice: string): Promise<PublicReceiptData> {
    const response = await fetch(`${this.apiBaseUrl}/receipts/${encodeURIComponent(invoice)}`);

    if (!response.ok) {
      let message = 'Struk tidak ditemukan';
      try {
        const errJson = await response.json();
        message = errJson?.error?.message || message;
      } catch {
        // fallback
      }
      throw new Error(message);
    }

    return (await response.json()) as PublicReceiptData;
  }

  /**
   * Mengambil ringkasan void approval untuk Owner (Anti-Prefetch preview)
   */
  async getVoidApproveInfo(token: string): Promise<VoidApproveInfoResponse> {
    const response = await fetch(`${this.apiBaseUrl}/void/approve-info?token=${encodeURIComponent(token)}`);

    if (!response.ok) {
      let message = 'Tautan persetujuan void tidak valid atau kedaluwarsa';
      try {
        const errJson = await response.json();
        message = errJson?.error?.message || message;
      } catch {
        // fallback
      }
      throw new Error(message);
    }

    return (await response.json()) as VoidApproveInfoResponse;
  }

  /**
   * Mengeksekusi persetujuan void oleh Owner via tombol One-Click
   */
  async approveVoidOneClick(token: string): Promise<{ status: 'VOIDED'; message: string }> {
    const response = await fetch(`${this.apiBaseUrl}/void/approve-one-click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      let message = 'Gagal menyetujui pembatalan transaksi';
      try {
        const errJson = await response.json();
        message = errJson?.error?.message || message;
      } catch {
        // fallback
      }
      throw new Error(message);
    }

    return (await response.json()) as { status: 'VOIDED'; message: string };
  }
}

// Singleton repository instance for app-wide use
export const posRepository = new PosRepository();