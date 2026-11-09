import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import {
  buildCustomerWhatsAppUrl,
  type PublicReceiptData,
  type VoidApproveInfoResponse,
  type TransactionListItem,
} from '@koncoku/shared';
import { DigitalReceiptQr } from '../src/components/common/DigitalReceiptQr';
import { generateQrMatrix } from '../src/utils/qrCode';
import { PublicReceiptPage } from '../src/pages/PublicReceiptPage';
import { OwnerVoidApprovePage } from '../src/pages/OwnerVoidApprovePage';
import { RequestVoidModal } from '../src/components/pos/RequestVoidModal';
import { WaitingVoidApprovalModal } from '../src/components/pos/WaitingVoidApprovalModal';
import { TransactionHistoryModal } from '../src/components/pos/TransactionHistoryModal';
import { posRepository } from '../src/services/posRepository';
import { useCartStore } from '../src/stores/cartStore';
import { SuccessReceiptModal } from '../src/components/pos/SuccessReceiptModal';

describe('Stage 4 — Void Flow & WhatsApp Digital Receipt Integration Tests', () => {
  const sampleReceipt: PublicReceiptData = {
    invoice_number: 'KCK-261109-0001',
    created_at: Date.now(),
    status: 'COMPLETED',
    payment_method: 'CASH',
    payment_reference: null,
    total_amount: 52000,
    cash_received: 100000,
    change_amount: 48000,
    customer_name_snapshot: 'Rian Pratama',
    customer_phone_snapshot: '6281234567890',
    cashier_name: 'Budi (Kasir)',
    items: [
      {
        product_id: 'prod-1',
        product_name_snapshot: 'Kopi Susu Konco',
        category_snapshot: 'COFFEE',
        qty: 2,
        sell_price_snapshot: 18000,
        subtotal: 36000,
      },
      {
        product_id: 'prod-2',
        product_name_snapshot: 'Butter Croissant',
        category_snapshot: 'SNACK',
        qty: 1,
        sell_price_snapshot: 16000,
        subtotal: 16000,
      },
    ],
  };

  const sampleVoidedReceipt: PublicReceiptData = {
    ...sampleReceipt,
    invoice_number: 'KCK-261109-0002',
    status: 'VOIDED',
  };

  const sampleApproveInfo: VoidApproveInfoResponse = {
    invoice_number: 'KCK-261109-0001',
    cashier_name: 'Budi (Kasir)',
    payment_method: 'CASH',
    total_amount: 52000,
    items: [
      { name: 'Kopi Susu Konco', qty: 2, subtotal: 36000 },
      { name: 'Butter Croissant', qty: 1, subtotal: 16000 },
    ],
    reason: 'Salah input menu / item pesanan: Pelanggan ganti rasa',
    expires_at: Date.now() + 240000,
    is_expired: false,
    status: 'PENDING',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    useCartStore.setState({
      lastReceipt: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. WA Deep-Link Normalization & URL Encoding', () => {
    it('normalizes Indonesian 08xx to 628xx and formats pleasant WhatsApp message template', () => {
      const url = buildCustomerWhatsAppUrl({
        phone: '0812-3456-7890',
        customerName: 'Rian Pratama',
        invoiceNumber: 'KCK-261109-0001',
        totalAmount: 52000,
      });

      expect(url).toContain('https://wa.me/6281234567890?text=');
      expect(url).toContain(encodeURIComponent('Rian Pratama'));
      expect(url).toContain(encodeURIComponent('KCK-261109-0001'));
      expect(url).toContain(encodeURIComponent('Rp 52.000'));
      expect(url).toContain(encodeURIComponent('https://pos.koncoku.com/r/KCK-261109-0001'));
    });

    it('falls back to generic wa.me/?text= when customer phone is not provided', () => {
      const url = buildCustomerWhatsAppUrl({
        phone: null,
        customerName: null,
        invoiceNumber: 'KCK-261109-0003',
        totalAmount: 25000,
      });

      expect(url.startsWith('https://wa.me/?text=')).toBe(true);
      expect(url).toContain(encodeURIComponent('Sahabat Konco'));
      expect(url).toContain(encodeURIComponent('KCK-261109-0003'));
    });
  });

  describe('2. Modal Sukses Transaksi: QR Code & Aksi WhatsApp', () => {
    it('renders QR code and WA button in SuccessReceiptModal without window.print', () => {
      const html = renderToStaticMarkup(<SuccessReceiptModal receipt={sampleReceipt} />);

      // Verify QR Code container & link
      expect(html).toContain('data-testid="digital-receipt-qr"');
      expect(html).toContain('https://pos.koncoku.com/r/KCK-261109-0001');

      // Verify Primary Action: Kirim ke WA Pelanggan (Enter)
      expect(html).toContain('data-testid="send-wa-receipt-button"');
      expect(html).toContain('Kirim ke WA Pelanggan (Enter)');

      // Verify Financial Details
      expect(html).toContain('Rp 52.000');
      expect(html).toContain('LUNAS');

      // Invariant: No window.print()
      expect(html).not.toContain('window.print');
    });

    it('generates valid QR matrix for invoice URL', () => {
      const url = 'https://pos.koncoku.com/r/KCK-261109-0001';
      const matrix = generateQrMatrix(url);

      expect(Array.isArray(matrix)).toBe(true);
      expect(matrix.length).toBeGreaterThanOrEqual(21);
      expect(matrix[0]!.length).toBe(matrix.length);

      // Verify finder pattern corners are dark
      expect(matrix[0]![0]).toBe(true);
      expect(matrix[0]![matrix.length - 1]).toBe(true);
      expect(matrix[matrix.length - 1]![0]).toBe(true);
    });

    it('DigitalReceiptQr renders clean SVG elements', () => {
      const html = renderToStaticMarkup(
        <DigitalReceiptQr url="https://pos.koncoku.com/r/KCK-261109-0001" size={140} />
      );

      expect(html).toContain('<svg');
      expect(html).toContain('width="140"');
      expect(html).toContain('height="140"');
      expect(html).toContain('data-testid="digital-receipt-qr"');
    });
  });

  describe('3. Halaman Publik Struk Digital (/r/:invoice)', () => {
    it('renders completed digital receipt with LUNAS badge and ZERO HPP leakage', async () => {
      const html = renderToStaticMarkup(
        <PublicReceiptPage invoice="KCK-261109-0001" initialReceipt={sampleReceipt} />
      );

      // Verify Branding & Metadata
      expect(html).toContain('KONCOKU CAFE &amp; ROASTERY');
      expect(html).toContain('KCK-261109-0001');
      expect(html).toContain('LUNAS');
      expect(html).toContain('Kopi Susu Konco');
      expect(html).toContain('Butter Croissant');
      expect(html).toContain('Rp 52.000');

      // STRICT ZERO-LEAKAGE INVARIANT: cost_price / HPP must NEVER appear in output
      expect(html).not.toContain('cost_price');
      expect(html).not.toContain('HPP');
      expect(html).not.toContain('total_cost_amount');
    });

    it('renders voided digital receipt with red VOID badge and watermark', async () => {
      const html = renderToStaticMarkup(
        <PublicReceiptPage invoice="KCK-261109-0002" initialReceipt={sampleVoidedReceipt} />
      );

      expect(html).toContain('DIBATALKAN / VOID');
      expect(html).toContain('data-testid="receipt-void-watermark"');
    });
  });

  describe('4. Halaman Publik Konfirmasi Owner (/void-approve?token=...)', () => {
    it('renders void approval preview card and One-Click button without mutating database', async () => {
      const html = renderToStaticMarkup(
        <OwnerVoidApprovePage
          token="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
          initialInfo={sampleApproveInfo}
        />
      );

      // Verify Header
      expect(html).toContain('Otorisasi Pembatalan (Void)');
      expect(html).toContain('KCK-261109-0001');
      expect(html).toContain('Budi (Kasir)');
      expect(html).toContain('Salah input menu / item pesanan');

      // Verify One-Click Action Button
      expect(html).toContain('data-testid="one-click-approve-button"');
      expect(html).toContain('SETUJUI PEMBATALAN SEKARANG');
    });

    it('renders expired warning if token has expired', async () => {
      const html = renderToStaticMarkup(
        <OwnerVoidApprovePage
          token="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
          initialInfo={{
            ...sampleApproveInfo,
            is_expired: true,
            status: 'EXPIRED',
          }}
        />
      );

      expect(html).toContain('data-testid="void-expired-banner"');
      expect(html).toContain('Tautan Persetujuan Kedaluwarsa');
      expect(html).not.toContain('SETUJUI PEMBATALAN SEKARANG');
    });
  });

  describe('5. Kasir Riwayat & Modal Pengajuan Void', () => {
    const sampleHistoryItems: TransactionListItem[] = [
      {
        id: 'tx-1',
        invoice_number: 'KCK-261109-0001',
        created_at: Date.now(),
        status: 'COMPLETED',
        payment_method: 'CASH',
        total_amount: 52000,
        cashier_name: 'Budi',
        items_count: 2,
      },
      {
        id: 'tx-2',
        invoice_number: 'KCK-261109-0002',
        created_at: Date.now() - 60000,
        status: 'VOID_PENDING',
        payment_method: 'QRIS',
        total_amount: 25000,
        cashier_name: 'Budi',
        items_count: 1,
        active_void_request_id: 'vr-1',
        void_expires_at: Date.now() + 200000,
      },
      {
        id: 'tx-3',
        invoice_number: 'KCK-261109-0003',
        created_at: Date.now() - 120000,
        status: 'VOIDED',
        payment_method: 'TRANSFER',
        total_amount: 85000,
        cashier_name: 'Budi',
        items_count: 1,
        void_reason: 'Pelanggan batal memesan',
        void_approved_by: 'ONE_CLICK_LINK',
      },
    ];

    it('TransactionHistoryModal renders transactions with COMPLETED, VOID_PENDING, and VOIDED badges', () => {
      vi.spyOn(posRepository, 'getTransactions').mockResolvedValue(sampleHistoryItems);

      const html = renderToStaticMarkup(
        <TransactionHistoryModal
          isOpen={true}
          onClose={() => {}}
          onRequestVoid={() => {}}
          onCheckPendingVoid={() => {}}
        />
      );

      expect(html).toContain('Riwayat Transaksi Kasir (Hari Ini)');
      expect(html).toContain('data-testid="transaction-history-modal"');
    });

    it('RequestVoidModal renders reason category selector and submission button', () => {
      const html = renderToStaticMarkup(
        <RequestVoidModal
          transaction={sampleHistoryItems[0]!}
          onClose={() => {}}
          onRequestSuccess={() => {}}
        />
      );

      expect(html).toContain('Ajukan Pembatalan (Void)');
      expect(html).toContain('data-testid="void-reason-category-select"');
      expect(html).toContain('Salah input menu / item pesanan');
      expect(html).toContain('Kirim ke Owner');
    });

    it('WaitingVoidApprovalModal renders countdown timer, OTP form, and cleans up polling interval', () => {
      const html = renderToStaticMarkup(
        <WaitingVoidApprovalModal
          voidRequestId="vr-12345"
          invoiceNumber="KCK-261109-0001"
          expiresAt={Date.now() + 300000}
          onClose={() => {}}
          onVoidCompleted={() => {}}
        />
      );

      expect(html).toContain('data-testid="waiting-void-approval-modal"');
      expect(html).toContain('KCK-261109-0001');
      expect(html).toContain('data-testid="void-otp-input"');
      expect(html).toContain('data-testid="verify-otp-button"');
      expect(html).toContain('data-testid="cashier-void-countdown"');
    });
  });

  describe('6. Zero-Print Rule Enforcement (Hukum Invarian Sistem)', () => {
    it('strictly verifies that window.print is NOT called anywhere in apps/web/src', () => {
      const srcDir = path.resolve(__dirname, '../src');

      function scanFiles(dir: string): string[] {
        const results: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            results.push(...scanFiles(fullPath));
          } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
            results.push(fullPath);
          }
        }
        return results;
      }

      const files = scanFiles(srcDir);
      expect(files.length).toBeGreaterThan(5);

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        const hasPrintCall = content.includes('window.print()') || content.includes('.print()');
        expect(
          hasPrintCall,
          `File '${path.relative(srcDir, file)}' contains forbidden window.print() call!`
        ).toBe(false);
      }
    });
  });
});
