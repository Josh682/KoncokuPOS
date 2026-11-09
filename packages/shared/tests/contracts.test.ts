import { describe, it, expect } from 'vitest';
import {
  RupiahCurrencySchema,
  IndonesianPhoneSchema,
  CheckoutRequestSchema,
  CreateTransactionSchema,
  LocalProductSchema,
  PublicReceiptSchema,
  CreateVoidRequestSchema,
  VerifyVoidOtpSchema,
  buildCustomerWhatsAppUrl,
} from '../src/contracts';
import { generateUUIDv7 } from '../src/uuidv7';

describe('Shared Zod Contracts & Invariants', () => {
  describe('Hukum 4: Integer Currency Only (Rupiah)', () => {
    it('accepts integer currency amounts', () => {
      expect(RupiahCurrencySchema.parse(25000)).toBe(25000);
      expect(RupiahCurrencySchema.parse(0)).toBe(0);
      expect(RupiahCurrencySchema.parse(1000000)).toBe(1000000);
    });

    it('rejects floating-point and decimal amounts', () => {
      expect(() => RupiahCurrencySchema.parse(25000.5)).toThrow();
      expect(() => RupiahCurrencySchema.parse(10.99)).toThrow();
      expect(() => RupiahCurrencySchema.parse(0.01)).toThrow();
    });

    it('rejects negative amounts', () => {
      expect(() => RupiahCurrencySchema.parse(-1000)).toThrow();
    });
  });

  describe('Normalisasi Nomor WhatsApp Indonesia', () => {
    it('converts 08xx to 628xx format accurately', () => {
      expect(IndonesianPhoneSchema.parse('081234567890')).toBe('6281234567890');
      expect(IndonesianPhoneSchema.parse('085712345678')).toBe('6285712345678');
    });

    it('converts 8xx to 628xx format accurately', () => {
      expect(IndonesianPhoneSchema.parse('81234567890')).toBe('6281234567890');
    });

    it('accepts already standard 628xx format', () => {
      expect(IndonesianPhoneSchema.parse('6281234567890')).toBe('6281234567890');
    });

    it('strips dashes and whitespaces correctly', () => {
      expect(IndonesianPhoneSchema.parse(' 0812-3456-7890 ')).toBe('6281234567890');
      expect(IndonesianPhoneSchema.parse('+62 812 3456 7890')).toBe('6281234567890');
    });

    it('rejects invalid or non-Indonesian mobile formats', () => {
      expect(() => IndonesianPhoneSchema.parse('07123456')).toThrow();
      expect(() => IndonesianPhoneSchema.parse('12345')).toThrow();
      expect(() => IndonesianPhoneSchema.parse('not-a-number')).toThrow();
      expect(() => IndonesianPhoneSchema.parse('6281')).toThrow(); // too short
    });
  });

  describe('Hukum 6: Idempotent Mutations & CheckoutRequestSchema', () => {
    const validUUIDv7 = generateUUIDv7();
    const productId1 = generateUUIDv7();
    const productId2 = generateUUIDv7();

    it('accepts valid checkout request with UUIDv7 idempotency_key', () => {
      const payload = {
        idempotency_key: validUUIDv7,
        payment_method: 'CASH',
        cash_received: 50000,
        customer: {
          phone: '081234567890',
          name: 'Pelanggan Setia',
        },
        items: [
          { product_id: productId1, qty: 2 },
          { product_id: productId2, qty: 15.5 }, // gramasi desimal diizinkan
        ],
      };

      const parsed = CheckoutRequestSchema.parse(payload);
      expect(parsed.idempotency_key).toBe(validUUIDv7);
      expect(parsed.customer?.phone).toBe('6281234567890');
      expect(parsed.items[1]?.qty).toBe(15.5);
    });

    it('CreateTransactionSchema and CheckoutRequestSchema are interchangeable', () => {
      expect(CreateTransactionSchema).toBe(CheckoutRequestSchema);
    });

    it('rejects invalid or non-UUIDv7 idempotency_key (e.g. UUIDv4)', () => {
      const v4Id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      const payload = {
        idempotency_key: v4Id,
        payment_method: 'QRIS',
        items: [{ product_id: productId1, qty: 1 }],
      };

      expect(() => CheckoutRequestSchema.parse(payload)).toThrow(/UUIDv7/);
    });

    it('rejects empty items list', () => {
      const payload = {
        idempotency_key: generateUUIDv7(),
        payment_method: 'QRIS',
        items: [],
      };

      expect(() => CheckoutRequestSchema.parse(payload)).toThrow();
    });

    it('rejects non-positive qty (0 or negative)', () => {
      const payload = {
        idempotency_key: generateUUIDv7(),
        payment_method: 'QRIS',
        items: [{ product_id: productId1, qty: 0 }],
      };

      expect(() => CheckoutRequestSchema.parse(payload)).toThrow();
    });

    it('rejects decimal cash_received for CASH payment', () => {
      const payload = {
        idempotency_key: generateUUIDv7(),
        payment_method: 'CASH',
        cash_received: 50000.5,
        items: [{ product_id: productId1, qty: 1 }],
      };

      expect(() => CheckoutRequestSchema.parse(payload)).toThrow();
    });

    it('requires cash_received when payment_method is CASH', () => {
      const payload = {
        idempotency_key: generateUUIDv7(),
        payment_method: 'CASH',
        items: [{ product_id: productId1, qty: 1 }],
      };

      expect(() => CheckoutRequestSchema.parse(payload)).toThrow();
    });
  });

  describe('Zero-Trust / No HPP Leak (LocalProduct & PublicReceipt)', () => {
    it('LocalProductSchema validates cashier products and rejects decimal price', () => {
      const product = {
        id: generateUUIDv7(),
        sku: 'COF-LAT-01',
        name: 'Caffe Latte',
        category: 'COFFEE',
        inventory_type: 'AVAILABILITY_ONLY',
        sell_price: 28000,
        stock_qty: 0,
        unit: 'cup',
        is_available: 1,
        image_url: null,
        version: 1,
      };

      const parsed = LocalProductSchema.parse(product);
      expect(parsed.sell_price).toBe(28000);
      // cost_price is not in LocalProductSchema
      expect('cost_price' in parsed).toBe(false);

      // Decimal price rejected
      expect(() =>
        LocalProductSchema.parse({
          ...product,
          sell_price: 28000.75,
        })
      ).toThrow();
    });

    it('PublicReceiptSchema validates receipt data without leaking HPP', () => {
      const receipt = {
        invoice_number: 'KCK-261109-0001',
        created_at: 1731110400000,
        status: 'COMPLETED',
        payment_method: 'QRIS',
        total_amount: 56000,
        cash_received: null,
        change_amount: null,
        customer_name_snapshot: 'Budi',
        customer_phone_snapshot: '6281234567890',
        items: [
          {
            product_id: generateUUIDv7(),
            product_name_snapshot: 'Caffe Latte',
            category_snapshot: 'COFFEE',
            qty: 2,
            sell_price_snapshot: 28000,
            subtotal: 56000,
          },
        ],
      };

      const parsed = PublicReceiptSchema.parse(receipt);
      expect(parsed.total_amount).toBe(56000);
      expect('total_cost_amount' in parsed).toBe(false);
      expect('cost_price_snapshot' in parsed.items[0]!).toBe(false);
    });
  });

  describe('Void Request Schemas', () => {
    it('CreateVoidRequestSchema validates reason length (min 5 chars)', () => {
      const valid = {
        transaction_id: generateUUIDv7(),
        reason: 'Salah pesanan kopi pelanggan',
      };
      expect(CreateVoidRequestSchema.parse(valid).reason).toBe('Salah pesanan kopi pelanggan');

      const tooShort = {
        transaction_id: generateUUIDv7(),
        reason: 'Bad',
      };
      expect(() => CreateVoidRequestSchema.parse(tooShort)).toThrow();
    });

    it('VerifyVoidOtpSchema requires 6-digit numeric OTP', () => {
      const valid = {
        void_request_id: generateUUIDv7(),
        otp_code: '123456',
      };
      expect(VerifyVoidOtpSchema.parse(valid).otp_code).toBe('123456');

      expect(() =>
        VerifyVoidOtpSchema.parse({
          void_request_id: generateUUIDv7(),
          otp_code: '12345', // 5 digits
        })
      ).toThrow();

      expect(() =>
        VerifyVoidOtpSchema.parse({
          void_request_id: generateUUIDv7(),
          otp_code: 'abcdef', // letters
        })
      ).toThrow();
    });

    it('buildCustomerWhatsAppUrl formats template message and wa.me deep-link properly', () => {
      const url = buildCustomerWhatsAppUrl({
        phone: '081234567890',
        customerName: 'Budi Hartono',
        invoiceNumber: 'KCK-261109-0001',
        totalAmount: 45000,
      });

      expect(url).toContain('https://wa.me/6281234567890?text=');
      expect(url).toContain(encodeURIComponent('Budi Hartono'));
      expect(url).toContain(encodeURIComponent('KCK-261109-0001'));
      expect(url).toContain(encodeURIComponent('Rp 45.000'));
      expect(url).toContain(encodeURIComponent('https://pos.koncoku.com/r/KCK-261109-0001'));
    });
  });
});
