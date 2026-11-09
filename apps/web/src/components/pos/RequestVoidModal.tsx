import React, { useState } from 'react';
import type { TransactionListItem } from '@koncoku/shared';
import { posRepository } from '../../services/posRepository';
import { formatRupiah } from '../../utils/format';

interface RequestVoidModalProps {
  transaction: TransactionListItem | null;
  onClose: () => void;
  onRequestSuccess: (voidRequestId: string, expiresAt: number) => void;
}

const VOID_REASON_CATEGORIES = [
  'Salah input menu / item pesanan',
  'Pelanggan membatalkan pesanan',
  'Salah pilih metode pembayaran',
  'Kendala teknis / struk ganda',
  'Lainnya',
] as const;

export const RequestVoidModal: React.FC<RequestVoidModalProps> = ({
  transaction,
  onClose,
  onRequestSuccess,
}) => {
  const [category, setCategory] = useState<string>(VOID_REASON_CATEGORIES[0]);
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!transaction) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullReason = note.trim()
      ? `${category}: ${note.trim()}`
      : category;

    if (fullReason.length < 5) {
      setError('Alasan pembatalan minimal 5 karakter');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await posRepository.requestVoid({
        transaction_id: transaction.id,
        reason: fullReason,
      });

      onRequestSuccess(result.voidRequestId, result.expiresAt);
    } catch (err) {
      setError((err as Error)?.message || 'Gagal mengajukan permohonan void');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      data-testid="request-void-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-stone-200 animate-in fade-in zoom-in-95 duration-150 my-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-100 text-xs font-bold text-red-600">
              ⚠️
            </span>
            <h2 className="text-sm font-black uppercase text-stone-900 tracking-tight">
              Ajukan Pembatalan (Void)
            </h2>
          </div>

          <button
            type="button"
            data-testid="close-request-void-button"
            onClick={onClose}
            className="rounded-lg p-1 text-stone-600 hover:bg-stone-100 hover:text-stone-900"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Transaction Summary Card */}
        <div className="mt-3 rounded-xl bg-stone-50 p-3 border border-stone-200 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-stone-600">No. Invoice</span>
            <span className="font-mono font-bold text-stone-900">
              {transaction.invoice_number}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-stone-600">Total Nominal</span>
            <span className="font-bold text-stone-900">
              {formatRupiah(transaction.total_amount)}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-stone-600">Metode Bayar</span>
            <span className="font-medium text-stone-900">
              {transaction.payment_method}
            </span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1">
              Kategori Alasan Pembatalan *
            </label>
            <select
              data-testid="void-reason-category-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-900 focus:border-stone-900 focus:outline-none"
            >
              {VOID_REASON_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1">
              Catatan Singkat Tambahan
            </label>
            <textarea
              data-testid="void-reason-note-input"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Contoh: Salah klik ukuran beans 200g jadi 1kg..."
              className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs text-stone-900 placeholder-stone-600 focus:border-stone-900 focus:outline-none"
            />
          </div>

          {error && (
            <div
              data-testid="request-void-error"
              className="rounded-xl bg-red-50 p-2.5 text-xs text-red-600 border border-red-200"
            >
              {error}
            </div>
          )}

          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 rounded-xl border border-stone-300 bg-white py-2.5 text-xs font-bold text-stone-700 hover:bg-stone-50"
            >
              Batal
            </button>

            <button
              type="submit"
              data-testid="submit-request-void-button"
              disabled={isSubmitting}
              className="flex-1 rounded-xl bg-red-600 py-2.5 text-xs font-bold text-white shadow-md hover:bg-red-700 active:scale-[0.99] transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Mengirim...</span>
                </>
              ) : (
                <span>Kirim ke Owner</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
