import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isValidUUIDv7, type LocalProduct, type PublicReceiptData } from '@koncoku/shared';
import { useCartStore } from '../src/stores/cartStore';
import type { IPosRepository } from '../src/services/posRepository';

describe('Stage 3 — Zustand Cart & Checkout Store', () => {
  const trackedProductLowStock: LocalProduct = {
    id: '01931000-0000-7000-8000-000000000006',
    sku: 'BNS-GAYO-200G',
    name: 'Roasted Beans Aceh Gayo 200g',
    category: 'ROASTED_BEANS',
    inventory_type: 'TRACKED_STOCK',
    sell_price: 85000,
    stock_qty: 2, // Sisa 2
    unit: 'pack',
    is_available: 1,
    image_url: null,
    version: 1,
  };

  const trackedProductOutOfStock: LocalProduct = {
    id: '01931000-0000-7000-8000-000000000008',
    sku: 'TLS-V60-02',
    name: 'Hario V60 Plastic 02',
    category: 'TOOLS',
    inventory_type: 'TRACKED_STOCK',
    sell_price: 95000,
    stock_qty: 0, // Habis
    unit: 'pcs',
    is_available: 1,
    image_url: null,
    version: 1,
  };

  const unavailableProduct: LocalProduct = {
    id: '01931000-0000-7000-8000-000000000009',
    sku: 'COF-COLD-01',
    name: 'Cold Brew Bottled',
    category: 'COFFEE',
    inventory_type: 'AVAILABILITY_ONLY',
    sell_price: 25000,
    stock_qty: 0,
    unit: 'bottle',
    is_available: 0, // Unavailable
    image_url: null,
    version: 1,
  };

  const availableDrinkProduct: LocalProduct = {
    id: '01931000-0000-7000-8000-000000000002',
    sku: 'COF-LATTE-01',
    name: 'Cafe Latte',
    category: 'COFFEE',
    inventory_type: 'AVAILABILITY_ONLY',
    sell_price: 22000,
    stock_qty: 0,
    unit: 'cup',
    is_available: 1,
    image_url: null,
    version: 1,
  };

  beforeEach(() => {
    // Reset store before each test
    useCartStore.getState().clearCart();
    useCartStore.getState().resetCheckout();
  });

  describe('1. Siklus Hidup Idempotency Key (Hukum Invarian 6)', () => {
    it('initializes with a valid UUIDv7 idempotency_key', () => {
      const key = useCartStore.getState().idempotencyKey;
      expect(isValidUUIDv7(key)).toBe(true);
    });

    it('maintains the same idempotency_key when adding or modifying items', () => {
      const initialKey = useCartStore.getState().idempotencyKey;

      useCartStore.getState().addItem(availableDrinkProduct);
      expect(useCartStore.getState().idempotencyKey).toBe(initialKey);

      useCartStore.getState().updateQty(availableDrinkProduct.id, 1);
      expect(useCartStore.getState().idempotencyKey).toBe(initialKey);

      useCartStore.getState().addItem(trackedProductLowStock);
      expect(useCartStore.getState().idempotencyKey).toBe(initialKey);
    });

    it('locks the SAME idempotency_key during network retry failure', async () => {
      useCartStore.getState().addItem(availableDrinkProduct);
      useCartStore.getState().setPaymentMethod('QRIS');

      const lockedKey = useCartStore.getState().idempotencyKey;

      // Mock repository that simulates a network disconnection error
      const mockRepo = {
        submitCheckout: vi.fn().mockRejectedValue(new Error('Network offline or gateway timeout')),
      } as unknown as IPosRepository;

      // Attempt 1: Fails
      await expect(useCartStore.getState().submitCheckout(mockRepo)).rejects.toThrow(
        'Network offline or gateway timeout'
      );

      // Verify that idempotencyKey was NOT rotated on failure (retained for retry!)
      expect(useCartStore.getState().idempotencyKey).toBe(lockedKey);
      expect(useCartStore.getState().items.length).toBe(1);
      expect(useCartStore.getState().error).toBe('Network offline or gateway timeout');

      // Attempt 2 (Retry): Verifies that same key is passed in payload
      const mockSuccessReceipt: PublicReceiptData = {
        invoice_number: 'KCK-261109-0099',
        created_at: Date.now(),
        status: 'COMPLETED',
        payment_method: 'QRIS',
        total_amount: 22000,
        cash_received: 22000,
        change_amount: 0,
        items: [],
      };

      (mockRepo.submitCheckout as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockSuccessReceipt);

      const receipt = await useCartStore.getState().submitCheckout(mockRepo);
      expect(receipt.invoice_number).toBe('KCK-261109-0099');

      // Check that the retry passed the exact lockedKey
      expect((mockRepo.submitCheckout as ReturnType<typeof vi.fn>).mock.calls[1][0].idempotency_key).toBe(lockedKey);

      // Verify that after SUCCESS, idempotency_key is rotated to a BRAND NEW UUIDv7
      const nextKey = useCartStore.getState().idempotencyKey;
      expect(nextKey).not.toBe(lockedKey);
      expect(isValidUUIDv7(nextKey)).toBe(true);
      expect(useCartStore.getState().items.length).toBe(0);
    });

    it('generates a new UUIDv7 idempotency_key upon clearCart()', () => {
      const keyBefore = useCartStore.getState().idempotencyKey;
      useCartStore.getState().addItem(availableDrinkProduct);

      useCartStore.getState().clearCart();

      const keyAfter = useCartStore.getState().idempotencyKey;
      expect(keyAfter).not.toBe(keyBefore);
      expect(isValidUUIDv7(keyAfter)).toBe(true);
      expect(useCartStore.getState().items.length).toBe(0);
    });
  });

  describe('2. Aturan Stok & Validasi Interaksi (Hukum Invarian 5)', () => {
    it('caps TRACKED_STOCK item addition at stock_qty (rejects 3rd item when stock = 2)', () => {
      // Stock = 2
      const firstAdd = useCartStore.getState().addItem(trackedProductLowStock);
      expect(firstAdd).toBe(true);
      expect(useCartStore.getState().items[0]?.qty).toBe(1);

      const secondAdd = useCartStore.getState().addItem(trackedProductLowStock);
      expect(secondAdd).toBe(true);
      expect(useCartStore.getState().items[0]?.qty).toBe(2);

      // Third addition MUST be rejected
      const thirdAdd = useCartStore.getState().addItem(trackedProductLowStock);
      expect(thirdAdd).toBe(false);
      expect(useCartStore.getState().items[0]?.qty).toBe(2); // Still 2
      expect(useCartStore.getState().error).toContain('tidak mencukupi (Maksimal: 2)');

      // Updating qty via updateQty beyond stock must also be rejected
      const updateResult = useCartStore.getState().updateQty(trackedProductLowStock.id, 1);
      expect(updateResult).toBe(false);
      expect(useCartStore.getState().items[0]?.qty).toBe(2);
    });

    it('rejects adding product with stock_qty <= 0 or is_available === 0', () => {
      // Out of stock tracked product
      const outOfStockAdd = useCartStore.getState().addItem(trackedProductOutOfStock);
      expect(outOfStockAdd).toBe(false);
      expect(useCartStore.getState().items.length).toBe(0);
      expect(useCartStore.getState().error).toContain('telah habis');

      // Unavailable product
      const unavailableAdd = useCartStore.getState().addItem(unavailableProduct);
      expect(unavailableAdd).toBe(false);
      expect(useCartStore.getState().items.length).toBe(0);
      expect(useCartStore.getState().error).toContain('sedang tidak tersedia');
    });

    it('allows repeated addition for AVAILABILITY_ONLY product when is_available === 1', () => {
      useCartStore.getState().addItem(availableDrinkProduct);
      useCartStore.getState().addItem(availableDrinkProduct);
      useCartStore.getState().addItem(availableDrinkProduct);

      expect(useCartStore.getState().items[0]?.qty).toBe(3);
      expect(useCartStore.getState().error).toBeNull();
    });
  });

  describe('3. Normalisasi WhatsApp & CRM Data', () => {
    it('normalizes 08xx and +628xx input to standard 628xx format', () => {
      useCartStore.getState().setCustomerPhone('081234567890');
      expect(useCartStore.getState().customerPhone).toBe('6281234567890');

      useCartStore.getState().setCustomerPhone('+6289876543210');
      expect(useCartStore.getState().customerPhone).toBe('6289876543210');

      useCartStore.getState().setCustomerPhone('85511223344');
      expect(useCartStore.getState().customerPhone).toBe('6285511223344');

      useCartStore.getState().setCustomerName('Budi Santoso');
      expect(useCartStore.getState().customerName).toBe('Budi Santoso');
    });
  });

  describe('4. Metode Bayar & Kalkulasi Kembalian CASH', () => {
    it('calculates total and change accurately in INTEGER Rupiah', () => {
      useCartStore.getState().addItem(availableDrinkProduct); // 22.000
      useCartStore.getState().addItem(trackedProductLowStock); // 85.000

      const total = useCartStore.getState().getTotalAmount();
      expect(total).toBe(107000);
      expect(Number.isInteger(total)).toBe(true);

      // CASH Payment
      useCartStore.getState().setPaymentMethod('CASH');

      // Insufficient cash: 100.000 < 107.000
      useCartStore.getState().setCashReceived(100000);
      expect(useCartStore.getState().isCashSufficient()).toBe(false);
      expect(useCartStore.getState().getChangeAmount()).toBe(0);
      expect(useCartStore.getState().canCheckout()).toBe(false);

      // Sufficient cash: 150.000 >= 107.000 -> change = 43.000
      useCartStore.getState().setCashReceived(150000);
      expect(useCartStore.getState().isCashSufficient()).toBe(true);
      expect(useCartStore.getState().getChangeAmount()).toBe(43000);
      expect(useCartStore.getState().canCheckout()).toBe(true);
    });
  });
});