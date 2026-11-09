import React, { useEffect, useCallback } from 'react';
import { useCartStore } from '../../stores/cartStore';
import { formatRupiah } from '../../utils/format';
import { buildCustomerWhatsAppUrl, type PublicReceiptData } from '@koncoku/shared';
import { DigitalReceiptQr } from '../common/DigitalReceiptQr';

interface SuccessReceiptModalProps {
  receipt?: PublicReceiptData | null;
  onClose?: () => void;
}

export const SuccessReceiptModal: React.FC<SuccessReceiptModalProps> = ({
  receipt: propReceipt,
  onClose,
}) => {
  const storeReceipt = useCartStore((s) => s.lastReceipt);
  const storeReset = useCartStore((s) => s.resetCheckout);

  const receipt = propReceipt !== undefined ? propReceipt : storeReceipt;
  const resetCheckout = onClose || storeReset;

  const receiptUrl = receipt
    ? `https://pos.koncoku.com/r/${receipt.invoice_number}`
    : '';

  const waUrl = receipt
    ? buildCustomerWhatsAppUrl({
        phone: receipt.customer_phone_snapshot,
        customerName: receipt.customer_name_snapshot,
        invoiceNumber: receipt.invoice_number,
        totalAmount: receipt.total_amount,
      })
    : '';

  const handleSendWhatsApp = useCallback(() => {
    if (!waUrl) return;
    if (typeof window !== 'undefined') {
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    }
  }, [waUrl]);

  // Keyboard listener: Pressing 'Enter' sends WhatsApp receipt, 'Escape' resets/closes
  useEffect(() => {
    if (!receipt) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleSendWhatsApp();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        resetCheckout();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [receipt, handleSendWhatsApp, resetCheckout]);

  if (!receipt) return null;

  return (
    <div
      data-testid="success-receipt-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-stone-200 animate-in fade-in zoom-in-95 duration-150 my-auto">
        {/* Header with Green Stamp */}
        <div className="flex items-center justify-between border-b border-stone-100 pb-3">
          <div>
            <span className="text-[11px] font-bold text-stone-600 tracking-wider uppercase">
              Transaksi Berhasil
            </span>
            <h2 className="text-base font-black text-stone-900 font-mono tracking-tight">
              {receipt.invoice_number}
            </h2>
          </div>
          <span className="rounded-lg bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 border border-emerald-300">
            LUNAS
          </span>
        </div>

        {/* Customer & Payment Info */}
        <div className="mt-3 space-y-1.5 text-xs text-stone-600">
          <div className="flex justify-between">
            <span>Waktu Transaksi</span>
            <span className="font-medium text-stone-900">
              {new Date(receipt.created_at).toLocaleString('id-ID')}
            </span>
          </div>

          <div className="flex justify-between">
            <span>Kasir</span>
            <span className="font-medium text-stone-900">
              {receipt.cashier_name || 'Kasir Koncoku'}
            </span>
          </div>

          {receipt.customer_name_snapshot && (
            <div className="flex justify-between">
              <span>Pelanggan</span>
              <span className="font-medium text-stone-900">
                {receipt.customer_name_snapshot} ({receipt.customer_phone_snapshot || '-'})
              </span>
            </div>
          )}

          <div className="flex justify-between">
            <span>Metode Bayar</span>
            <span className="font-bold text-stone-900">
              {receipt.payment_method}
              {receipt.payment_reference ? ` (${receipt.payment_reference})` : ''}
            </span>
          </div>
        </div>

        {/* Items List */}
        <div className="mt-3 max-h-36 overflow-y-auto rounded-lg bg-stone-50 p-2.5 border border-stone-100 divide-y divide-stone-200/60">
          {receipt.items.map((item, idx) => (
            <div key={idx} className="flex justify-between py-1 text-xs text-stone-800">
              <div className="truncate pr-2">
                <span className="font-medium">{item.product_name_snapshot}</span>
                <span className="text-stone-600 ml-1">x{item.qty}</span>
              </div>
              <span className="font-semibold shrink-0">{formatRupiah(item.subtotal)}</span>
            </div>
          ))}
        </div>

        {/* Financial Calculation */}
        <div className="mt-3 space-y-1 border-t border-stone-100 pt-2.5 text-xs">
          <div className="flex justify-between font-bold text-stone-900 text-sm">
            <span>Total Bayar</span>
            <span>{formatRupiah(receipt.total_amount)}</span>
          </div>

          {receipt.payment_method === 'CASH' && (
            <>
              <div className="flex justify-between text-stone-600">
                <span>Tunai Diterima</span>
                <span>{formatRupiah(receipt.cash_received || 0)}</span>
              </div>
              <div className="flex justify-between font-bold text-emerald-700">
                <span>Kembalian</span>
                <span>{formatRupiah(receipt.change_amount || 0)}</span>
              </div>
            </>
          )}
        </div>

        {/* QR Code Struk Digital (Langsung di-scan pelanggan di meja kasir) */}
        <div className="mt-3 flex flex-col items-center justify-center rounded-xl border border-stone-200 bg-stone-50 p-3 text-center">
          <div className="text-[11px] font-bold text-stone-700 mb-1.5">
            QR Code Struk Digital (Scan di Meja Kasir)
          </div>
          <DigitalReceiptQr url={receiptUrl} size={130} />
          <a
            href={receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="receipt-public-link"
            className="mt-1.5 text-[11px] font-mono text-stone-600 hover:text-stone-900 underline truncate max-w-full"
          >
            {receiptUrl}
          </a>
        </div>

        {/* Action Buttons */}
        <div className="mt-4 flex flex-col gap-2">
          {/* Primary Action Button: WhatsApp Deep-Link with Enter Shortcut */}
          <button
            type="button"
            data-testid="send-wa-receipt-button"
            onClick={handleSendWhatsApp}
            className="w-full rounded-xl bg-emerald-700 py-3 text-xs font-bold text-white shadow-md hover:bg-emerald-800 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.301-.15-1.78-.878-2.056-.978-.276-.1-.476-.15-.677.15-.2.301-.777.978-.953 1.178-.175.2-.351.226-.652.075-.301-.15-1.272-.469-2.423-1.496-.896-.799-1.5-1.786-1.676-2.087-.175-.301-.019-.464.132-.614.136-.135.301-.351.452-.527.15-.175.201-.301.301-.501.1-.2.05-.376-.025-.527-.075-.15-.677-1.632-.928-2.234-.244-.587-.492-.507-.677-.516-.175-.008-.376-.01-.577-.01-.2 0-.527.075-.803.376-.276.301-1.054 1.03-1.054 2.511s1.079 2.912 1.229 3.113c.15.2 2.123 3.242 5.143 4.547.718.311 1.279.497 1.716.636.722.23 1.378.197 1.897.12.578-.087 1.78-.727 2.031-1.43.251-.703.251-1.305.176-1.43-.075-.125-.276-.201-.577-.351z" />
            </svg>
            <span>Kirim ke WA Pelanggan (Enter)</span>
          </button>

          {/* Secondary Action: Transaksi Baru */}
          <button
            type="button"
            data-testid="new-transaction-button"
            onClick={resetCheckout}
            className="w-full rounded-xl border border-stone-300 bg-white py-2.5 text-xs font-bold text-stone-700 hover:bg-stone-50 active:scale-[0.99] transition-all"
          >
            Transaksi Baru (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
