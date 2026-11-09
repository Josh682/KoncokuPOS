import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';

export const PinLoginModal: React.FC = () => {
  const [pin, setPin] = useState('');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const loginWithPin = useAuthStore((s) => s.loginWithPin);
  const resetError = useAuthStore((s) => s.resetError);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        resetError();
      }, 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [error, resetError]);

  // Physical keyboard support for 6-digit PIN
  useEffect(() => {
    if (isAuthenticated) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        if (pin.length < 6) {
          setPin((prev) => prev + e.key);
        }
      } else if (e.key === 'Backspace') {
        setPin((prev) => prev.slice(0, -1));
      } else if (e.key === 'Escape') {
        setPin('');
      } else if (e.key === 'Enter') {
        if (pin.length === 6) {
          submitPin(pin);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAuthenticated, pin]);

  if (isAuthenticated) return null;

  const handleDigit = (digit: string) => {
    if (pin.length < 6) {
      const nextPin = pin + digit;
      setPin(nextPin);
      if (nextPin.length === 6) {
        submitPin(nextPin);
      }
    }
  };

  const handleClear = () => {
    setPin('');
    resetError();
  };

  const submitPin = async (enteredPin: string) => {
    if (enteredPin.length !== 6 || isLoading) return;
    try {
      await loginWithPin(enteredPin);
      setPin('');
    } catch {
      setPin('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/80 backdrop-blur-md p-4">
      <div
        data-testid="pin-login-modal"
        className="w-full max-w-xs rounded-3xl bg-white p-6 shadow-2xl border border-stone-200 text-center animate-in zoom-in-95 duration-200"
      >
        {/* Brand Header */}
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-900 text-white shadow-md">
          <span className="font-mono font-extrabold text-xl tracking-tighter">KC</span>
        </div>

        <h2 className="mt-4 text-lg font-bold text-stone-900">Koncoku POS</h2>
        <p className="text-xs text-stone-500">Masukkan 6-Digit PIN Kasir / Owner</p>

        {/* 6 Dots Indicator */}
        <div className="my-6 flex justify-center gap-3">
          {[0, 1, 2, 3, 4, 5].map((index) => {
            const isFilled = index < pin.length;
            return (
              <span
                key={index}
                data-testid={`pin-dot-${index}`}
                className={`h-4 w-4 rounded-full border transition-all duration-150 ${
                  isFilled
                    ? 'scale-110 bg-stone-900 border-stone-900 shadow-sm'
                    : 'bg-stone-100 border-stone-300'
                }`}
              />
            );
          })}
        </div>

        {/* Error message */}
        {error && (
          <div
            data-testid="pin-error-message"
            className="mb-4 rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-600 border border-red-200"
          >
            {error}
          </div>
        )}

        {/* Numeric Keypad Grid (3 columns) */}
        <div className="grid grid-cols-3 gap-2.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              data-testid={`pin-key-${digit}`}
              type="button"
              disabled={isLoading}
              onClick={() => handleDigit(digit)}
              className="flex h-14 items-center justify-center rounded-2xl bg-stone-100 text-lg font-bold text-stone-900 transition-all hover:bg-stone-200 active:scale-95 disabled:opacity-50"
            >
              {digit}
            </button>
          ))}

          <button
            type="button"
            data-testid="pin-key-clear"
            disabled={isLoading}
            onClick={handleClear}
            className="flex h-14 items-center justify-center rounded-2xl bg-stone-100 text-xs font-semibold text-stone-600 transition-all hover:bg-stone-200 active:scale-95 disabled:opacity-50"
          >
            Hapus
          </button>

          <button
            type="button"
            data-testid="pin-key-0"
            disabled={isLoading}
            onClick={() => handleDigit('0')}
            className="flex h-14 items-center justify-center rounded-2xl bg-stone-100 text-lg font-bold text-stone-900 transition-all hover:bg-stone-200 active:scale-95 disabled:opacity-50"
          >
            0
          </button>

          <button
            type="button"
            data-testid="pin-key-submit"
            disabled={pin.length !== 6 || isLoading}
            onClick={() => submitPin(pin)}
            className="flex h-14 items-center justify-center rounded-2xl bg-stone-900 text-sm font-bold text-white shadow-sm transition-all hover:bg-stone-800 active:scale-95 disabled:opacity-40"
          >
            {isLoading ? '...' : 'OK'}
          </button>
        </div>

        <div className="mt-4 text-[11px] text-stone-500">
          Default Demo Kasir: <code className="font-mono font-bold text-stone-700">123456</code>
        </div>
      </div>
    </div>
  );
};