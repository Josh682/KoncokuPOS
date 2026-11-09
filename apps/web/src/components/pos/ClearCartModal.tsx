import React from 'react';
import { useCartStore } from '../../stores/cartStore';

export const ClearCartModal: React.FC = () => {
  const isOpen = useCartStore((s) => s.isConfirmationOpen);
  const setOpen = useCartStore((s) => s.setConfirmationOpen);
  const clearCart = useCartStore((s) => s.clearCart);

  if (!isOpen) return null;

  const handleConfirm = () => {
    clearCart();
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div
        data-testid="clear-cart-modal"
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl border border-stone-200 animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-bold text-stone-900">Kosongkan Keranjang?</h3>
            <p className="text-xs text-stone-600">Alur Cancel Sebelum Struk (Draft)</p>
          </div>
        </div>

        <p className="mt-3 text-sm text-stone-600 leading-relaxed">
          Semua item dalam keranjang kasir akan dibatalkan. Kunci transaksi (<code className="font-mono text-xs">idempotency_key</code>) akan di-reset tanpa memanggil API ke server.
        </p>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            data-testid="cancel-clear-cart"
            onClick={() => setOpen(false)}
            className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors"
          >
            Batal
          </button>
          <button
            type="button"
            data-testid="confirm-clear-cart"
            onClick={handleConfirm}
            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 transition-colors"
          >
            Ya, Kosongkan
          </button>
        </div>
      </div>
    </div>
  );
};