import React, { useState, useEffect, useRef } from 'react';
import { posRepository } from '../../services/posRepository';

interface WaitingVoidApprovalModalProps {
  voidRequestId: string;
  invoiceNumber: string;
  expiresAt: number;
  onClose: () => void;
  onVoidCompleted: () => void;
}

export const WaitingVoidApprovalModal: React.FC<WaitingVoidApprovalModalProps> = ({
  voidRequestId,
  invoiceNumber,
  expiresAt,
  onClose,
  onVoidCompleted,
}) => {
  const [otpCode, setOtpCode] = useState<string>('');
  const [isVerifyingOtp, setIsVerifyingOtp] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState<boolean>(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  });

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Countdown Timer (5 minutes)
  useEffect(() => {
    timerIntervalRef.current = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          setIsExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  // 2. Lightweight Polling Every 3 Seconds (Requirement: cleanup clearInterval on unmount)
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await posRepository.pollVoidStatus(voidRequestId);

        if (res.status === 'APPROVED') {
          // Owner approved via phone (One-Click)
          setStatusMessage('Struk Dibatalkan atas Persetujuan Owner');

          // Immediately sync catalog so returned stock is refreshed in local Dexie & UI
          await posRepository.syncCatalog();

          // Wait brief moment to display success toast then notify parent
          setTimeout(() => {
            onVoidCompleted();
          }, 1000);
        } else if (res.status === 'EXPIRED') {
          setIsExpired(true);
        }
      } catch (err) {
        console.warn('Poll void status check notice:', err);
      }
    };

    pollIntervalRef.current = setInterval(checkStatus, 3000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [voidRequestId, onVoidCompleted]);

  // 3. Manual OTP verification by cashier
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otpCode)) {
      setError('Kode OTP harus 6 digit angka');
      return;
    }

    setIsVerifyingOtp(true);
    setError(null);

    try {
      await posRepository.verifyVoidOtp(voidRequestId, otpCode);
      setStatusMessage('Struk Dibatalkan atas Persetujuan Owner');

      // Immediately sync catalog so returned stock is refreshed in local Dexie & UI
      await posRepository.syncCatalog();

      setTimeout(() => {
        onVoidCompleted();
      }, 1000);
    } catch (err) {
      setError((err as Error)?.message || 'Kode OTP tidak sesuai');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  return (
    <div
      data-testid="waiting-void-approval-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-stone-200 animate-in fade-in zoom-in-95 duration-150 my-auto text-center">
        {/* Success toast if approved */}
        {statusMessage ? (
          <div
            data-testid="void-success-banner"
            className="rounded-xl bg-emerald-50 p-6 border border-emerald-300 text-center animate-in zoom-in-95"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white font-bold text-xl mb-3">
              ✓
            </div>
            <h3 className="text-sm font-black text-emerald-900">
              {statusMessage}
            </h3>
            <p className="mt-1 text-xs text-emerald-700">
              Stok inventori telah dikembalikan ke katalog kasir.
            </p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-stone-100 pb-3 text-left">
              <div>
                <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">
                  Menunggu Persetujuan Owner
                </span>
                <h2 className="text-base font-black text-stone-900 font-mono">
                  {invoiceNumber}
                </h2>
              </div>

              {/* Countdown badge */}
              <div
                data-testid="cashier-void-countdown"
                className="rounded-lg bg-stone-100 px-2.5 py-1 font-mono text-xs font-bold text-stone-700"
              >
                {Math.floor(secondsRemaining / 60)}:
                {(secondsRemaining % 60).toString().padStart(2, '0')}
              </div>
            </div>

            {/* Spinner and Instructions */}
            <div className="my-5 flex flex-col items-center justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-500 border-t-transparent mb-3" />
              <p className="text-xs font-bold text-stone-900">
                Permohonan telah dikirim ke WhatsApp / Telegram Owner.
              </p>
              <p className="mt-1 text-[11px] text-stone-600 max-w-xs">
                Owner dapat menyetujui langsung melalui tombol di ponsel mereka, atau mendiktekan kode OTP di bawah ini.
              </p>
            </div>

            {/* Expired alert */}
            {isExpired && (
              <div
                data-testid="cashier-void-expired-alert"
                className="mb-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 border border-amber-300 font-semibold"
              >
                Batas waktu 5 menit telah habis. Permohonan void kedaluwarsa.
              </div>
            )}

            {/* Manual OTP Entry Form */}
            {!isExpired && (
              <form
                onSubmit={handleVerifyOtp}
                className="rounded-xl bg-stone-50 p-4 border border-stone-200 text-left"
              >
                <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-700 mb-1">
                  Masukkan 6-Digit OTP (Jalur Dikte Owner):
                </label>

                <div className="flex gap-2">
                  <input
                    type="text"
                    data-testid="void-otp-input"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '');
                      setOtpCode(digits);
                    }}
                    placeholder="Contoh: 482910"
                    className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-center font-mono text-sm font-bold tracking-widest text-stone-900 focus:border-stone-900 focus:outline-none"
                  />

                  <button
                    type="submit"
                    data-testid="verify-otp-button"
                    disabled={isVerifyingOtp || otpCode.length !== 6}
                    className="rounded-xl bg-stone-900 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-stone-800 active:scale-95 transition-all disabled:opacity-40"
                  >
                    {isVerifyingOtp ? '...' : 'Verifikasi'}
                  </button>
                </div>

                {error && (
                  <p
                    data-testid="void-otp-error"
                    className="mt-2 text-[11px] font-semibold text-red-600"
                  >
                    {error}
                  </p>
                )}
              </form>
            )}

            {/* Close / Cancel Button */}
            <div className="mt-4">
              <button
                type="button"
                data-testid="cancel-waiting-void-button"
                onClick={onClose}
                className="w-full rounded-xl border border-stone-300 bg-white py-2 text-xs font-bold text-stone-700 hover:bg-stone-50"
              >
                Tutup Jendela
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
