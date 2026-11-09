/**
 * Zustand Cart & Checkout Store
 * References:
 * - docs/specs/02-catalog-and-checkout.md
 * - docs/DESIGN_SYSTEM.md (Section 2.2)
 *
 * Enforces:
 * - 0 network calls during cart operations (<16ms instant feedback)
 * - UUIDv7 Idempotency Key Lifecycle (preserved across retries, rotated only on clear/complete)
 * - Hybrid inventory stock validation (TRACKED_STOCK capped at stock_qty)
 * - Integer currency calculations
 */

import { create } from 'zustand';
import {
  generateUUIDv7,
  normalizeIndonesianPhone,
  type LocalProduct,
  type PaymentMethod,
  type PublicReceiptData,
  type CreateTransactionInput,
} from '@koncoku/shared';
import { posRepository, type IPosRepository } from '../services/posRepository';

export interface CartItem {
  product: LocalProduct;
  qty: number;
  subtotal: number; // Integer Rupiah
}

export interface CartState {
  // Idempotency Key (UUIDv7)
  idempotencyKey: string;

  // Active Draft Items
  items: CartItem[];

  // CRM Customer Data
  customerPhone: string;
  customerName: string;

  // Payment Options
  paymentMethod: PaymentMethod;
  cashReceived: number; // Integer Rupiah
  paymentReference: string; // RRN (QRIS) or Sender Note (TRANSFER)

  // Checkout Status & Modals
  isSubmitting: boolean;
  isConfirmationOpen: boolean;
  lastReceipt: PublicReceiptData | null;
  error: string | null;

  // Computed Helpers
  getTotalAmount: () => number;
  getTotalItemsCount: () => number;
  getChangeAmount: () => number;
  isCashSufficient: () => boolean;
  canCheckout: () => boolean;

  // Actions
  addItem: (product: LocalProduct) => boolean;
  removeItem: (productId: string) => void;
  updateQty: (productId: string, delta: number) => boolean;
  setQty: (productId: string, qty: number) => boolean;

  setCustomerPhone: (phone: string) => void;
  setCustomerName: (name: string) => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  setCashReceived: (amount: number) => void;
  setPaymentReference: (ref: string) => void;
  setConfirmationOpen: (open: boolean) => void;

  clearCart: () => void;
  resetError: () => void;
  resetCheckout: () => void;
  submitCheckout: (repo?: IPosRepository) => Promise<PublicReceiptData>;
}

export const useCartStore = create<CartState>((set, get) => ({
  // Initialize with UUIDv7
  idempotencyKey: generateUUIDv7(),
  items: [],
  customerPhone: '',
  customerName: '',
  paymentMethod: 'CASH',
  cashReceived: 0,
  paymentReference: '',
  isSubmitting: false,
  isConfirmationOpen: false,
  lastReceipt: null,
  error: null,

  getTotalAmount: () => {
    return get().items.reduce((sum, item) => sum + item.subtotal, 0);
  },

  getTotalItemsCount: () => {
    return get().items.reduce((sum, item) => sum + item.qty, 0);
  },

  getChangeAmount: () => {
    const { paymentMethod, cashReceived, getTotalAmount } = get();
    if (paymentMethod !== 'CASH') return 0;
    const total = getTotalAmount();
    return cashReceived >= total ? cashReceived - total : 0;
  },

  isCashSufficient: () => {
    const { paymentMethod, cashReceived, getTotalAmount } = get();
    if (paymentMethod !== 'CASH') return true;
    return cashReceived >= getTotalAmount();
  },

  canCheckout: () => {
    const { items, isSubmitting, isCashSufficient } = get();
    return items.length > 0 && !isSubmitting && isCashSufficient();
  },

  /**
   * Add Item to Cart
   * Validates stock constraints:
   * - TRACKED_STOCK cannot exceed stock_qty
   * - Unavailable products (is_available === 0 or stock_qty <= 0) rejected
   */
  addItem: (product: LocalProduct): boolean => {
    // 1. Availability check
    if (product.is_available === 0) {
      set({ error: `Produk '${product.name}' sedang tidak tersedia` });
      return false;
    }

    if (product.inventory_type === 'TRACKED_STOCK' && product.stock_qty <= 0) {
      set({ error: `Stok produk '${product.name}' telah habis` });
      return false;
    }

    const { items } = get();
    const existingIndex = items.findIndex((item) => item.product.id === product.id);

    if (existingIndex >= 0) {
      const existing = items[existingIndex];
      if (!existing) return false;
      const nextQty = existing.qty + 1;

      // 2. Tracked stock limit check
      if (product.inventory_type === 'TRACKED_STOCK' && nextQty > product.stock_qty) {
        set({
          error: `Stok ${product.name} tidak mencukupi (Maksimal: ${product.stock_qty})`,
        });
        return false;
      }

      const updatedItems = [...items];
      updatedItems[existingIndex] = {
        product: existing.product,
        qty: nextQty,
        subtotal: Math.round(nextQty * product.sell_price),
      };

      set({ items: updatedItems, error: null });
      return true;
    } else {
      // 3. New item to cart
      const updatedItems: CartItem[] = [
        ...items,
        {
          product,
          qty: 1,
          subtotal: Math.round(product.sell_price),
        },
      ];

      set({ items: updatedItems, error: null });
      return true;
    }
  },

  removeItem: (productId: string) => {
    const nextItems = get().items.filter((item) => item.product.id !== productId);
    set({ items: nextItems, error: null });
  },

  updateQty: (productId: string, delta: number): boolean => {
    const { items } = get();
    const existingIndex = items.findIndex((item) => item.product.id === productId);
    if (existingIndex < 0) return false;

    const existing = items[existingIndex];
    if (!existing) return false;
    const nextQty = existing.qty + delta;

    if (nextQty <= 0) {
      get().removeItem(productId);
      return true;
    }

    if (
      existing.product.inventory_type === 'TRACKED_STOCK' &&
      nextQty > existing.product.stock_qty
    ) {
      set({
        error: `Stok ${existing.product.name} tidak mencukupi (Maksimal: ${existing.product.stock_qty})`,
      });
      return false;
    }

    const updatedItems = [...items];
    updatedItems[existingIndex] = {
      product: existing.product,
      qty: nextQty,
      subtotal: Math.round(nextQty * existing.product.sell_price),
    };

    set({ items: updatedItems, error: null });
    return true;
  },

  setQty: (productId: string, qty: number): boolean => {
    if (qty <= 0) {
      get().removeItem(productId);
      return true;
    }

    const { items } = get();
    const existingIndex = items.findIndex((item) => item.product.id === productId);
    if (existingIndex < 0) return false;

    const existing = items[existingIndex];
    if (!existing) return false;

    if (
      existing.product.inventory_type === 'TRACKED_STOCK' &&
      qty > existing.product.stock_qty
    ) {
      set({
        error: `Stok ${existing.product.name} tidak mencukupi (Maksimal: ${existing.product.stock_qty})`,
      });
      return false;
    }

    const updatedItems = [...items];
    updatedItems[existingIndex] = {
      product: existing.product,
      qty,
      subtotal: Math.round(qty * existing.product.sell_price),
    };

    set({ items: updatedItems, error: null });
    return true;
  },

  setCustomerPhone: (phone: string) => {
    const normalized = normalizeIndonesianPhone(phone);
    set({ customerPhone: normalized });
  },

  setCustomerName: (name: string) => {
    set({ customerName: name });
  },

  setPaymentMethod: (method: PaymentMethod) => {
    set({ paymentMethod: method });
  },

  setCashReceived: (amount: number) => {
    set({ cashReceived: Math.max(0, Math.round(amount)) });
  },

  setPaymentReference: (ref: string) => {
    set({ paymentReference: ref });
  },

  setConfirmationOpen: (open: boolean) => {
    set({ isConfirmationOpen: open });
  },

  /**
   * Clear Cart (Alur Cancel Sebelum Struk - CART_DRAFT)
   * Resets local Zustand state and generates a brand NEW UUIDv7 idempotency_key
   * 0 network calls!
   */
  clearCart: () => {
    set({
      idempotencyKey: generateUUIDv7(),
      items: [],
      customerPhone: '',
      customerName: '',
      paymentMethod: 'CASH',
      cashReceived: 0,
      paymentReference: '',
      isSubmitting: false,
      isConfirmationOpen: false,
      error: null,
    });
  },

  resetError: () => {
    set({ error: null });
  },

  resetCheckout: () => {
    set({
      lastReceipt: null,
      error: null,
    });
  },

  /**
   * Submit Checkout Transaction
   * - Retains idempotencyKey during network retry
   * - Generates NEW UUIDv7 idempotencyKey only on success
   */
  submitCheckout: async (repo: IPosRepository = posRepository): Promise<PublicReceiptData> => {
    const state = get();

    if (state.items.length === 0) {
      const err = new Error('Keranjang masih kosong');
      set({ error: err.message });
      throw err;
    }

    const totalAmount = state.getTotalAmount();

    if (state.paymentMethod === 'CASH' && state.cashReceived < totalAmount) {
      const err = new Error(
        `Uang tunai kurang (Total: Rp ${totalAmount.toLocaleString('id-ID')}, Diterima: Rp ${state.cashReceived.toLocaleString('id-ID')})`
      );
      set({ error: err.message });
      throw err;
    }

    set({ isSubmitting: true, error: null });

    const payload: CreateTransactionInput = {
      idempotency_key: state.idempotencyKey,
      payment_method: state.paymentMethod,
      payment_reference: state.paymentReference ? state.paymentReference.trim() : undefined,
      cash_received: state.paymentMethod === 'CASH' ? state.cashReceived : undefined,
      customer:
        state.customerPhone && state.customerName
          ? {
              phone: state.customerPhone,
              name: state.customerName.trim(),
            }
          : undefined,
      items: state.items.map((item) => ({
        product_id: item.product.id,
        qty: item.qty,
      })),
    };

    try {
      const receipt = await repo.submitCheckout(payload);

      // On SUCCESS: Save receipt, clear cart, and ROTATE idempotency_key to new UUIDv7
      set({
        idempotencyKey: generateUUIDv7(),
        items: [],
        customerPhone: '',
        customerName: '',
        paymentMethod: 'CASH',
        cashReceived: 0,
        paymentReference: '',
        isSubmitting: false,
        lastReceipt: receipt,
        error: null,
      });

      return receipt;
    } catch (err: unknown) {
      // On FAILURE: DO NOT rotate idempotencyKey! Keep it locked for retry
      const errMsg = (err as Error)?.message || 'Terjadi kesalahan saat memproses pembayaran';
      set({
        isSubmitting: false,
        error: errMsg,
      });
      throw err;
    }
  },
}));