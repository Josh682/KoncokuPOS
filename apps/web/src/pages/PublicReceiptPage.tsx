import React, { useState, useEffect } from 'react';
import type { PublicReceiptData } from '@koncoku/shared';
import { posRepository } from '../services/posRepository';
import { formatRupiah } from '../utils/format';
import { DigitalReceiptQr } from '../components/common/DigitalReceiptQr';

interface PublicReceiptPageProps {
  invoice?: string;
  initialReceipt?: PublicReceiptData | null;
}

export const PublicReceiptPage: React.FC<PublicReceiptPageProps> = ({
  invoice,
  initialReceipt = null,
}) => {
  const [receipt, setReceipt] = useState<PublicReceiptData | null>(initialReceipt);
  const [loading, setLoading] = useState(initialReceipt === null);
  const [error, setError] = useState<string | null>(null);

  // Extract invoice number from prop or URL pathname (/r/:invoice)
  const resolvedInvoice =
    invoice ||
    (typeof window !== 'undefined'
      ? window.location.pathname.replace(/^\/r\//, '').trim()
      : '');

  useEffect(() => {
    if (!resolvedInvoice) {
      setError('Nomor invoice tidak ditemukan pada URL');
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);

    posRepository
      .getPublicReceipt(resolvedInvoice)
      .then((data) => {
        if (isMounted) {
          setReceipt(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError((err as Error)?.message || 'Gagal memuat struk digital');
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [resolvedInvoice]);

  if (loading) {
    return (
      <div
        data-testid="public-receipt-loading"
        className="flex min-h-screen items-center justify-center bg-stone-100 p-4 font-sans text-stone-900"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-stone-900 border-t-transparent" />
          <p className="text-xs font-semibold text-stone-600">Memuat Struk Digital...</p>
        </div>
      </div>
    );
  }

  if (error || !receipt) {
    return (
      <div
        data-testid="public-receipt-error"
        className="flex min-h-screen items-center justify-center bg-stone-100 p-4 font-sans text-stone-900"
      >
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-lg border border-stone-200">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 font-bold text-lg mb-3">
            !
          </div>
          <h2 className="text-base font-bold text-stone-900">Struk Tidak Ditemukan</h2>
          <p className="mt-1 text-xs text-stone-600">{error || 'Data struk tidak tersedia'}</p>
        </div>
      </div>
    );
  }

  const isVoided = receipt.status === 'VOIDED';
  const isPending = receipt.status === 'VOID_PENDING';
  const currentUrl = typeof window !== 'undefined' ? window.location.href : `https://pos.koncoku.com/r/${receipt.invoice_number}`;

  return (
    <div
      data-testid="public-receipt-container"
      className="flex min-h-screen items-center justify-center bg-stone-100 p-4 font-sans text-stone-900"
    >
      <div className="w-full max-w-[420px] rounded-3xl bg-white p-6 shadow-xl border border-stone-200 relative overflow-hidden">
        {/* Void Watermark if Voided */}
        {isVoided && (
          <div
            data-testid="receipt-void-watermark"
            className="absolute -right-8 top-10 rotate-45 bg-red-600 px-10 py-1 text-center text-xs font-black tracking-widest text-white shadow-md uppercase select-none pointer-events-none"
          >
            VOID / BATAL
          </div>
        )}

        {/* Brand Header */}
        <div className="flex flex-col items-center text-center border-b border-dashed border-stone-200 pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-stone-900 text-sm font-black text-white shadow-md font-mono">
            KC
          </div>
          <h1 className="mt-2 text-base font-black tracking-tight text-stone-900">
            KONCOKU CAFE & ROASTERY
          </h1>
          <p className="text-[11px] text-stone-600 font-medium">
            Kopi Asli & Ruang Berbagi
          </p>

          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1 font-mono text-[11px] font-bold text-stone-800">
            <span>Struk #{receipt.invoice_number}</span>
          </div>
        </div>

        {/* Status Stamp */}
        <div className="my-3 flex justify-center">
          {isVoided ? (
            <span
              data-testid="receipt-status-badge"
              className="rounded-xl bg-red-100 px-4 py-1 text-xs font-black tracking-wider text-red-700 border border-red-300 uppercase"
            >
              DIBATALKAN / VOID
            </span>
          ) : isPending ? (
            <span
              data-testid="receipt-status-badge"
              className="rounded-xl bg-amber-100 px-4 py-1 text-xs font-black tracking-wider text-amber-800 border border-amber-300 uppercase"
            >
              DALAM PROSES VOID
            </span>
          ) : (
            <span
              data-testid="receipt-status-badge"
              className="rounded-xl bg-emerald-100 px-4 py-1 text-xs font-black tracking-wider text-emerald-800 border border-emerald-300 uppercase"
            >
              LUNAS
            </span>
          )}
        </div>

        {/* Transaction Metadata */}
        <div className="space-y-1 border-b border-dashed border-stone-200 pb-3 text-xs text-stone-600">
          <div className="flex justify-between">
            <span>Waktu:</span>
            <span className="font-medium text-stone-900">
              {new Date(receipt.created_at).toLocaleString('id-ID')}
            </span>
          </div>

          <div className="flex justify-between">
            <span>Kasir:</span>
            <span className="font-medium text-stone-900">
              {receipt.cashier_name || 'Kasir Koncoku'}
            </span>
          </div>

          {receipt.customer_name_snapshot && (
            <div className="flex justify-between">
              <span>Pelanggan:</span>
              <span className="font-medium text-stone-900">
                {receipt.customer_name_snapshot} ({receipt.customer_phone_snapshot || '-'})
              </span>
            </div>
          )}

          <div className="flex justify-between">
            <span>Metode Bayar:</span>
            <span className="font-bold text-stone-900">
              {receipt.payment_method}
              {receipt.payment_reference ? ` (${receipt.payment_reference})` : ''}
            </span>
          </div>
        </div>

        {/* Items List */}
        <div className="py-3 border-b border-dashed border-stone-200">
          <div className="text-[11px] font-bold uppercase tracking-wider text-stone-600 mb-2">
            Rincian Pesanan
          </div>

          <div className="space-y-2">
            {receipt.items.map((item, idx) => (
              <div key={idx} className="flex justify-between text-xs text-stone-800">
                <div>
                  <div className="font-medium">{item.product_name_snapshot}</div>
                  <div className="text-[11px] text-stone-600">
                    {item.qty} x {formatRupiah(item.sell_price_snapshot)}
                  </div>
                </div>
                <div className="font-bold">{formatRupiah(item.subtotal)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Financial Summary */}
        <div className="py-3 border-b border-dashed border-stone-200 space-y-1.5 text-xs">
          <div className="flex justify-between font-black text-stone-900 text-sm">
            <span>Total Tagihan</span>
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

        {/* QR Code Validation */}
        <div className="pt-4 text-center flex flex-col items-center">
          <DigitalReceiptQr url={currentUrl} size={110} />
          <p className="mt-2 text-[10px] text-stone-600">
            Pindai untuk memverifikasi keaslian struk digital ini
          </p>
          <p className="text-[10px] text-stone-600 mt-0.5">
            Terima kasih telah berkunjung ke Koncoku!
          </p>
        </div>
      </div>
    </div>
  );
};
