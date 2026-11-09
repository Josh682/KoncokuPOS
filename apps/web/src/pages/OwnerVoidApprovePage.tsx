import React, { useState, useEffect } from 'react';
import type { VoidApproveInfoResponse } from '@koncoku/shared';
import { posRepository } from '../services/posRepository';
import { formatRupiah } from '../utils/format';

interface OwnerVoidApprovePageProps {
  token?: string;
  initialInfo?: VoidApproveInfoResponse | null;
}

export const OwnerVoidApprovePage: React.FC<OwnerVoidApprovePageProps> = ({
  token: propToken,
  initialInfo = null,
}) => {
  const [token, setToken] = useState<string>('');
  const [info, setInfo] = useState<VoidApproveInfoResponse | null>(initialInfo);
  const [loading, setLoading] = useState(initialInfo === null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isApproved, setIsApproved] = useState(initialInfo?.status === 'APPROVED');
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(() => {
    if (!initialInfo) return null;
    return Math.max(0, Math.floor((initialInfo.expires_at - Date.now()) / 1000));
  });

  // Extract token from prop or URL query parameter
  useEffect(() => {
    const resolved =
      propToken ||
      (typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('token') || ''
        : '');
    setToken(resolved);
  }, [propToken]);

  // Load preview data from GET /api/void/approve-info (Anti-Prefetch safe!)
  useEffect(() => {
    if (!token) {
      setError('Token persetujuan tidak ditemukan pada tautan');
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);

    posRepository
      .getVoidApproveInfo(token)
      .then((data) => {
        if (isMounted) {
          setInfo(data);
          setError(null);
          if (data.status === 'APPROVED') {
            setIsApproved(true);
          }
          const diff = Math.max(0, Math.floor((data.expires_at - Date.now()) / 1000));
          setSecondsRemaining(diff);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError((err as Error)?.message || 'Gagal memuat rincian permohonan void');
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  // Countdown timer
  useEffect(() => {
    if (secondsRemaining === null || secondsRemaining <= 0) return;

    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [secondsRemaining]);

  const handleApprove = async () => {
    if (!token || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await posRepository.approveVoidOneClick(token);
      setIsApproved(true);
    } catch (err) {
      setError((err as Error)?.message || 'Gagal menyetujui pembatalan');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isExpired =
    info?.is_expired ||
    (secondsRemaining !== null && secondsRemaining <= 0) ||
    info?.status === 'EXPIRED';

  if (loading) {
    return (
      <div
        data-testid="void-approve-loading"
        className="flex min-h-screen items-center justify-center bg-stone-900 p-4 font-sans text-stone-100"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-white border-t-transparent" />
          <p className="text-xs font-semibold text-stone-300">Memeriksa Tautan Persetujuan...</p>
        </div>
      </div>
    );
  }

  if (error && !info) {
    return (
      <div
        data-testid="void-approve-error"
        className="flex min-h-screen items-center justify-center bg-stone-900 p-4 font-sans text-stone-100"
      >
        <div className="w-full max-w-sm rounded-3xl bg-stone-800 p-6 text-center shadow-2xl border border-stone-700">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-900/60 text-red-300 font-bold text-lg mb-3">
            !
          </div>
          <h2 className="text-base font-bold text-white">Tautan Tidak Valid</h2>
          <p className="mt-1 text-xs text-stone-300">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="owner-void-approve-container"
      className="flex min-h-screen items-center justify-center bg-stone-900 p-4 font-sans text-stone-100"
    >
      <div className="w-full max-w-[420px] rounded-3xl bg-stone-800 p-6 shadow-2xl border border-stone-700">
        {/* Header */}
        <div className="border-b border-stone-700 pb-4 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-red-600 text-white font-mono font-black text-sm shadow-md">
            ⚠️
          </div>
          <h1 className="mt-2 text-base font-black tracking-tight text-white uppercase">
            Otorisasi Pembatalan (Void)
          </h1>
          <p className="text-xs text-stone-300">
            Halaman Konfirmasi Pemilik (Owner)
          </p>
        </div>

        {/* Success Message if Already Approved */}
        {isApproved ? (
          <div
            data-testid="void-approved-banner"
            className="my-6 rounded-2xl bg-emerald-950/80 p-5 text-center border border-emerald-600/60"
          >
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white text-lg font-bold mb-2">
              ✓
            </div>
            <h3 className="text-sm font-bold text-emerald-300">
              Transaksi Berhasil Dibatalkan
            </h3>
            <p className="mt-1 text-xs text-emerald-200">
              Struk #{info?.invoice_number} telah di-void. Stok inventori dan jurnal pembukuan telah disesuaikan secara otomatis.
            </p>
          </div>
        ) : isExpired ? (
          <div
            data-testid="void-expired-banner"
            className="my-6 rounded-2xl bg-amber-950/80 p-5 text-center border border-amber-600/60"
          >
            <h3 className="text-sm font-bold text-amber-300">
              Tautan Persetujuan Kedaluwarsa
            </h3>
            <p className="mt-1 text-xs text-amber-200">
              Batas waktu 5 menit telah habis. Kasir harus mengajukan permohonan baru dari layar kasir.
            </p>
          </div>
        ) : (
          <>
            {/* Expiration Countdown Bar */}
            {secondsRemaining !== null && (
              <div className="my-3 flex items-center justify-between rounded-xl bg-stone-900/80 px-3 py-2 text-xs">
                <span className="text-stone-300">Batas Waktu Persetujuan:</span>
                <span
                  data-testid="void-countdown-timer"
                  className="font-mono font-bold text-amber-400"
                >
                  {Math.floor(secondsRemaining / 60)}:
                  {(secondsRemaining % 60).toString().padStart(2, '0')}
                </span>
              </div>
            )}

            {/* Transaction Card */}
            <div className="mt-3 space-y-2 rounded-2xl bg-stone-900/60 p-4 border border-stone-700/60 text-xs">
              <div className="flex justify-between">
                <span className="text-stone-300">No. Invoice</span>
                <span className="font-mono font-bold text-white">{info?.invoice_number}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-stone-300">Kasir Pemohon</span>
                <span className="font-semibold text-white">{info?.cashier_name}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-stone-300">Metode Bayar</span>
                <span className="font-semibold text-white">{info?.payment_method}</span>
              </div>

              <div className="flex justify-between border-t border-stone-700/60 pt-2 text-sm font-black">
                <span className="text-stone-200">Total Nominal</span>
                <span className="text-emerald-400">
                  {formatRupiah(info?.total_amount || 0)}
                </span>
              </div>

              {/* Reason */}
              <div className="border-t border-stone-700/60 pt-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-stone-300">
                  Alasan Kasir:
                </span>
                <p className="mt-0.5 rounded-lg bg-stone-950 p-2 text-xs italic text-amber-200">
                  "{info?.reason}"
                </p>
              </div>

              {/* Items Summary */}
              <div className="border-t border-stone-700/60 pt-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-stone-300">
                  Daftar Item:
                </span>
                <div className="mt-1 space-y-1">
                  {info?.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-[11px] text-stone-300">
                      <span>{item.qty}x {item.name}</span>
                      <span className="font-mono text-stone-200">{formatRupiah(item.subtotal)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div
                data-testid="void-approve-action-error"
                className="mt-3 rounded-xl bg-red-900/60 p-2.5 text-xs text-red-200 border border-red-700 text-center font-medium"
              >
                {error}
              </div>
            )}

            {/* 1 Big Red Button: SETUJUI PEMBATALAN SEKARANG */}
            <div className="mt-5">
              <button
                type="button"
                data-testid="one-click-approve-button"
                disabled={isSubmitting || isExpired}
                onClick={handleApprove}
                className="w-full rounded-2xl bg-red-600 py-3.5 text-sm font-black uppercase tracking-wider text-white shadow-xl hover:bg-red-500 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>Memproses Pembatalan...</span>
                  </>
                ) : (
                  <span>SETUJUI PEMBATALAN SEKARANG</span>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
