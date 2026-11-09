/**
 * Core domain types and enums for Koncoku POS
 */

export const PRODUCT_CATEGORIES = [
  'COFFEE',
  'NON_COFFEE',
  'MANUAL_BREW',
  'SNACK',
  'ROASTED_BEANS',
  'RAW_MATERIAL',
  'TOOLS',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type ProductCategoryFilter = ProductCategory | 'ALL';

export const INVENTORY_TYPES = ['TRACKED_STOCK', 'AVAILABILITY_ONLY'] as const;
export type InventoryType = (typeof INVENTORY_TYPES)[number];

export const PAYMENT_METHODS = ['QRIS', 'CASH', 'TRANSFER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const USER_ROLES = ['OWNER', 'CASHIER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TRANSACTION_STATUSES = ['COMPLETED', 'VOID_PENDING', 'VOIDED'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const VOID_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'EXPIRED', 'REJECTED'] as const;
export type VoidRequestStatus = (typeof VOID_REQUEST_STATUSES)[number];

export const VOID_APPROVAL_TYPES = ['OTP_ENTRY', 'ONE_CLICK_LINK'] as const;
export type VoidApprovalType = (typeof VOID_APPROVAL_TYPES)[number];

export const INVENTORY_CHANGE_TYPES = ['SALE', 'VOID_RETURN', 'RESTOCK', 'OPNAME_ADJUST'] as const;
export type InventoryChangeType = (typeof INVENTORY_CHANGE_TYPES)[number];

// Database entities (Cloudflare D1 / SQLite)
export interface UserEntity {
  id: string; // UUIDv7
  name: string;
  role: UserRole;
  pin_hash: string;
  is_active: 0 | 1;
  created_at: number; // Unix ms
}

export interface ProductEntity {
  id: string; // UUIDv7
  sku: string;
  name: string;
  category: ProductCategory;
  inventory_type: InventoryType;
  sell_price: number; // Integer (Rupiah)
  cost_price: number; // Integer (HPP - Owner Only)
  stock_qty: number; // Float for raw materials, int for units
  unit: string;
  is_available: 0 | 1;
  image_url: string | null;
  version: number;
  updated_at: number;
}

export interface SystemMetaEntity {
  meta_key: string;
  meta_value: string;
  updated_at: number;
}

export interface CustomerEntity {
  id: string; // UUIDv7
  phone: string; // 628xxxxxxxxxx
  name: string;
  visit_count: number;
  total_spent: number; // Integer (Rupiah)
  last_visit_at: number;
  created_at: number;
}

export interface TransactionEntity {
  id: string; // UUIDv7
  idempotency_key: string;
  invoice_number: string;
  cashier_id: string;
  customer_id: string | null;
  customer_name_snapshot: string | null;
  customer_phone_snapshot: string | null;
  payment_method: PaymentMethod;
  payment_reference: string | null;
  total_amount: number; // Integer
  total_cost_amount: number; // Integer (HPP)
  cash_received: number | null; // Integer
  change_amount: number | null; // Integer
  status: TransactionStatus;
  voided_at: number | null;
  void_reason: string | null;
  void_approved_by: VoidApprovalType | null;
  created_at: number;
}

export interface TransactionItemEntity {
  id: string; // UUIDv7
  transaction_id: string;
  product_id: string;
  product_name_snapshot: string;
  category_snapshot: string;
  qty: number;
  sell_price_snapshot: number; // Integer
  cost_price_snapshot: number; // Integer (HPP)
  subtotal: number; // Integer
}

export interface VoidRequestEntity {
  id: string; // UUIDv7
  transaction_id: string;
  requested_by: string;
  reason: string;
  otp_hash: string;
  token_hash: string;
  status: VoidRequestStatus;
  expires_at: number;
  resolved_at: number | null;
  created_at: number;
}

export interface InventoryLogEntity {
  id: string; // UUIDv7
  product_id: string;
  transaction_id: string | null;
  change_type: InventoryChangeType;
  qty_delta: number;
  stock_after: number;
  notes: string | null;
  created_by: string;
  created_at: number;
}

// Client-Safe Types (Dexie.js and Public responses without HPP)
export interface LocalProduct {
  id: string;
  sku: string;
  name: string;
  category: ProductCategory;
  inventory_type: InventoryType;
  sell_price: number;
  stock_qty: number;
  unit: string;
  is_available: 0 | 1;
  image_url: string | null;
  version: number;
}

export interface LocalCustomer {
  id: string;
  phone: string;
  name: string;
  visit_count: number;
  last_visit_at: number;
}

export interface SyncMeta {
  key: string;
  value: string;
  updated_at: number;
}

export interface OfflineTxQueueItem {
  idempotency_key: string;
  payload: unknown;
  created_at: number;
  status: 'PENDING' | 'SYNCING' | 'FAILED_CONFLICT';
  error_message?: string;
}

export interface PublicReceiptItem {
  product_id: string;
  product_name_snapshot: string;
  category_snapshot: string;
  qty: number;
  sell_price_snapshot: number;
  subtotal: number;
}

export interface PublicReceipt {
  invoice_number: string;
  created_at: number;
  status: TransactionStatus;
  payment_method: PaymentMethod;
  payment_reference: string | null;
  total_amount: number;
  cash_received: number | null;
  change_amount: number | null;
  customer_name_snapshot: string | null;
  customer_phone_snapshot: string | null;
  cashier_name?: string;
  items: PublicReceiptItem[];
}
