import React, { useState, useEffect, useCallback } from 'react';
import type { TransactionListItem } from '@koncoku/shared';
import { posRepository } from '../../services/posRepository';
import { formatRupiah } from '../../utils/format';

interface TransactionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRequestVoid: (tx: TransactionListItem) => void;
  onCheckPendingVoid: (tx: TransactionListItem) => void;
}

export const TransactionHistoryModal: React.FC<TransactionHistoryModalProps> = ({
  isOpen,
  onClose,
  onRequestVoid,
  onCheckPendingVoid,
}) => {
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await posRepository.getTransactions(50);
      setTransactions(items);
    } catch (err) {
      setError((err as Error)?.message || 'Gagal memuat riwayat transaksi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadTransactions();
    }
  }, [isOpen, loadTransactions]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="transaction-history-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="flex flex-col h-[85vh] w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl border border-stone-200 animate-in fade-in zoom-in-95 duration-150 my-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-100 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-stone-900 text-xs text-white font-mono font-bold">
              📜
            </span>
            <div>
              <h2 className="text-sm font-black uppercase tracking-tight text-stone-900">
                Riwayat Transaksi Kasir (Hari Ini)
              </h2>
              <span className="text-[11px] text-stone-600">
                Daftar struk transaksi dan status pembatalan (Void)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="refresh-history-button"
              onClick={loadTransactions}
              disabled={loading}
              className="rounded-lg border border-stone-200 p-1.5 text-stone-600 hover:bg-stone-50 hover:text-stone-900"
              title="Perbarui Riwayat"
            >
              <svg
                className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>

            <button
              type="button"
              data-testid="close-history-button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content list */}
        <div className="flex-grow overflow-y-auto py-3 space-y-2.5">
          {loading && transactions.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-xs text-stone-600">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-stone-900 border-t-transparent mr-2" />
              Memuat transaksi...
            </div>
          ) : error ? (
            <div className="rounded-xl bg-red-50 p-4 text-center text-xs text-red-600 border border-red-200">
              {error}
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-center text-stone-600">
              <p className="text-xs font-semibold">Belum ada transaksi hari ini</p>
              <p className="text-[11px] text-stone-600 mt-0.5">
                Transaksi baru akan otomatis tercatat di sini.
              </p>
            </div>
          ) : (
            transactions.map((tx) => {
              const isVoided = tx.status === 'VOIDED';
              const isVoidPending = tx.status === 'VOID_PENDING';
              const isCompleted = tx.status === 'COMPLETED';

              return (
                <div
                  key={tx.id}
                  data-testid={`transaction-item-${tx.invoice_number}`}
                  className="rounded-xl border border-stone-200 bg-stone-50/70 p-3.5 transition-all hover:bg-stone-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-stone-900">
                          {tx.invoice_number}
                        </span>

                        {/* Status Badge */}
                        {isCompleted && (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-300 uppercase">
                            Lunas
                          </span>
                        )}
                        {isVoidPending && (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-300 uppercase">
                            Menunggu Persetujuan
                          </span>
                        )}
                        {isVoided && (
                          <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800 border border-red-300 uppercase">
                            Dibatalkan / Void
                          </span>
                        )}
                      </div>

                      <div className="mt-1 text-[11px] text-stone-600 space-x-2">
                        <span>{new Date(tx.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>•</span>
                        <span>{tx.items_count} item</span>
                        <span>•</span>
                        <span>{tx.payment_method}</span>
                        {tx.customer_name_snapshot && (
                          <>
                            <span>•</span>
                            <span className="font-medium">{tx.customer_name_snapshot}</span>
                          </>
                        )}
                      </div>

                      {/* Void details if voided */}
                      {isVoided && tx.void_reason && (
                        <div className="mt-1.5 rounded-lg bg-red-50 p-2 text-[11px] text-red-700 border border-red-200">
                          <span className="font-semibold">Alasan Void:</span> {tx.void_reason}
                          {tx.void_approved_by && (
                            <span className="ml-1 text-[10px] text-red-600">
                              (Persetujuan: {tx.void_approved_by})
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right side: Amount and Void Action Button */}
                    <div className="text-right shrink-0">
                      <div className="text-xs font-black text-stone-900">
                        {formatRupiah(tx.total_amount)}
                      </div>

                      <div className="mt-2">
                        {isCompleted && (
                          <button
                            type="button"
                            data-testid={`request-void-btn-${tx.invoice_number}`}
                            onClick={() => onRequestVoid(tx)}
                            className="rounded-lg bg-stone-900 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm hover:bg-red-600 active:scale-95 transition-all"
                          >
                            Ajukan Void
                          </button>
                        )}

                        {isVoidPending && (
                          <button
                            type="button"
                            data-testid={`check-pending-void-btn-${tx.invoice_number}`}
                            onClick={() => onCheckPendingVoid(tx)}
                            className="rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm hover:bg-amber-600 active:scale-95 transition-all"
                          >
                            Cek / Masukkan OTP
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-stone-100 pt-3 text-right shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-xs font-bold text-stone-700 hover:bg-stone-50"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
