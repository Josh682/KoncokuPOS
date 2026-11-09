import React, { useState, useEffect } from 'react';
import type { LocalCustomer, PaymentMethod } from '@koncoku/shared';
import { useCartStore } from '../../stores/cartStore';
import { posRepository } from '../../services/posRepository';
import { formatRupiah } from '../../utils/format';

export const ActiveCartPanel: React.FC = () => {
  const items = useCartStore((s) => s.items);
  const removeItem = useCartStore((s) => s.removeItem);
  const updateQty = useCartStore((s) => s.updateQty);
  const setConfirmationOpen = useCartStore((s) => s.setConfirmationOpen);

  const customerPhone = useCartStore((s) => s.customerPhone);
  const customerName = useCartStore((s) => s.customerName);
  const setCustomerPhone = useCartStore((s) => s.setCustomerPhone);
  const setCustomerName = useCartStore((s) => s.setCustomerName);

  const paymentMethod = useCartStore((s) => s.paymentMethod);
  const cashReceived = useCartStore((s) => s.cashReceived);
  const paymentReference = useCartStore((s) => s.paymentReference);
  const setPaymentMethod = useCartStore((s) => s.setPaymentMethod);
  const setCashReceived = useCartStore((s) => s.setCashReceived);
  const setPaymentReference = useCartStore((s) => s.setPaymentReference);

  const isSubmitting = useCartStore((s) => s.isSubmitting);
  const error = useCartStore((s) => s.error);
  const resetError = useCartStore((s) => s.resetError);
  const submitCheckout = useCartStore((s) => s.submitCheckout);

  const totalAmount = useCartStore((s) => s.getTotalAmount)();
  const totalItemsCount = useCartStore((s) => s.getTotalItemsCount)();
  const changeAmount = useCartStore((s) => s.getChangeAmount)();
  const isCashSufficient = useCartStore((s) => s.isCashSufficient)();
  const canCheckout = useCartStore((s) => s.canCheckout)();

  // Local state for raw phone input to allow natural typing before normalization
  const [rawPhone, setRawPhone] = useState(customerPhone);
  const [customerSuggestions, setCustomerSuggestions] = useState<LocalCustomer[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Synchronize when store customerPhone changes externally (e.g. on clearCart)
  useEffect(() => {
    setRawPhone(customerPhone);
  }, [customerPhone]);

  // CRM Search: When cashier types >= 4 digits, search Dexie.js customers cache (<10ms)
  useEffect(() => {
    const cleanDigits = rawPhone.replace(/\D/g, '');
    if (cleanDigits.length >= 4) {
      posRepository.searchCustomersByPhonePrefix(cleanDigits).then((results) => {
        setCustomerSuggestions(results);
        setShowSuggestions(results.length > 0);
      });
    } else {
      setCustomerSuggestions([]);
      setShowSuggestions(false);
    }
  }, [rawPhone]);

  const handlePhoneChange = (val: string) => {
    setRawPhone(val);
    setCustomerPhone(val);
    resetError();
  };

  const handleSelectCustomer = (customer: LocalCustomer) => {
    setRawPhone(customer.phone);
    setCustomerPhone(customer.phone);
    setCustomerName(customer.name);
    setShowSuggestions(false);
  };

  const handleCheckout = async () => {
    if (!canCheckout || isSubmitting) return;
    try {
      await submitCheckout(posRepository);
    } catch {
      // Error handled in store and displayed in UI
    }
  };

  return (
    <div
      data-testid="active-cart-panel"
      className="flex h-full w-full flex-col justify-between rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
    >
      {/* 1. Panel Header: Cart Title, Draft Badge, Item Count, Clear Button */}
      <div className="flex items-center justify-between border-b border-stone-100 pb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-black tracking-tight text-stone-900 uppercase">
            Keranjang
          </h2>
          <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-stone-600">
            #KCK-Draft
          </span>
          <span className="rounded-full bg-stone-900 px-2 py-0.5 text-[11px] font-bold text-white">
            {totalItemsCount}
          </span>
        </div>

        {items.length > 0 && (
          <button
            type="button"
            data-testid="clear-cart-button"
            onClick={() => setConfirmationOpen(true)}
            className="text-xs font-semibold text-red-600 hover:text-red-700 hover:underline"
          >
            Batal / Kosongkan
          </button>
        )}
      </div>

      {/* 2. Scrollable Cart Items List */}
      <div className="flex-grow overflow-y-auto py-3 scrollbar-none space-y-2.5 min-h-[160px] max-h-[30vh]">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center py-8 text-stone-600">
            <svg
              className="h-10 w-10 text-stone-300 mb-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
              />
            </svg>
            <p className="text-xs font-medium">Keranjang masih kosong</p>
            <p className="text-[11px] text-stone-600 mt-0.5">
              Pilih produk di panel sebelah kiri
            </p>
          </div>
        ) : (
          items.map((item) => {
            const isTracked = item.product.inventory_type === 'TRACKED_STOCK';
            const isAtMax = isTracked && item.qty >= item.product.stock_qty;

            return (
              <div
                key={item.product.id}
                data-testid={`cart-item-${item.product.id}`}
                className="flex items-center justify-between rounded-xl bg-stone-50 p-2.5 border border-stone-100"
              >
                <div className="min-w-0 flex-grow pr-2">
                  <div className="truncate text-xs font-bold text-stone-900">
                    {item.product.name}
                  </div>
                  <div className="text-[11px] text-stone-600 font-medium">
                    {formatRupiah(item.product.sell_price)}
                  </div>
                </div>

                {/* Qty Controls: - [qty] + */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid={`cart-decrease-${item.product.id}`}
                    onClick={() => updateQty(item.product.id, -1)}
                    className="flex h-6 w-6 items-center justify-center rounded-lg border border-stone-300 bg-white text-xs font-bold text-stone-700 hover:bg-stone-100 active:scale-95"
                  >
                    -
                  </button>

                  <span
                    data-testid={`cart-qty-${item.product.id}`}
                    className="w-6 text-center text-xs font-bold text-stone-900"
                  >
                    {item.qty}
                  </span>

                  <button
                    type="button"
                    data-testid={`cart-increase-${item.product.id}`}
                    disabled={isAtMax}
                    onClick={() => updateQty(item.product.id, 1)}
                    className="flex h-6 w-6 items-center justify-center rounded-lg border border-stone-300 bg-white text-xs font-bold text-stone-700 hover:bg-stone-100 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    +
                  </button>

                  <div className="w-16 text-right text-xs font-bold text-stone-900">
                    {formatRupiah(item.subtotal)}
                  </div>

                  <button
                    type="button"
                    data-testid={`cart-remove-${item.product.id}`}
                    onClick={() => removeItem(item.product.id)}
                    className="ml-1 text-stone-600 hover:text-red-600"
                    title="Hapus item"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 3. CRM Customer Quick Form */}
      <div className="border-t border-stone-100 pt-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-stone-600 mb-1.5">
          Data Pelanggan (Struk Digital WA)
        </div>

        <div className="grid grid-cols-2 gap-2">
          {/* WhatsApp input with auto-complete */}
          <div className="relative">
            <input
              type="text"
              data-testid="customer-phone-input"
              value={rawPhone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="No. WhatsApp (08xx)"
              className="w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs text-stone-900 placeholder-stone-600 focus:border-stone-900 focus:outline-none"
            />

            {/* Suggestions dropdown */}
            {showSuggestions && customerSuggestions.length > 0 && (
              <div
                data-testid="customer-autocomplete-dropdown"
                className="absolute z-20 mt-1 max-h-36 w-56 overflow-y-auto rounded-xl border border-stone-200 bg-white p-1 shadow-lg text-xs"
              >
                {customerSuggestions.map((cust) => (
                  <button
                    key={cust.id}
                    data-testid={`customer-option-${cust.phone}`}
                    type="button"
                    onClick={() => handleSelectCustomer(cust)}
                    className="flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-left hover:bg-stone-100"
                  >
                    <span className="font-bold text-stone-900">{cust.name}</span>
                    <span className="font-mono text-[10px] text-stone-600">{cust.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Customer Name */}
          <input
            type="text"
            data-testid="customer-name-input"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Nama Pelanggan"
            className="w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs text-stone-900 placeholder-stone-600 focus:border-stone-900 focus:outline-none"
          />
        </div>
      </div>

      {/* 4. Payment Method Selector */}
      <div className="border-t border-stone-100 pt-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-stone-600 mb-1.5">
          Metode Pembayaran
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {(['CASH', 'QRIS', 'TRANSFER'] as PaymentMethod[]).map((method) => {
            const isSelected = paymentMethod === method;
            return (
              <button
                key={method}
                type="button"
                data-testid={`payment-method-${method}`}
                onClick={() => {
                  setPaymentMethod(method);
                  resetError();
                }}
                className={`rounded-lg py-1.5 text-xs font-bold transition-all ${
                  isSelected
                    ? 'bg-stone-900 text-white shadow-sm ring-1 ring-stone-900'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                {method}
              </button>
            );
          })}
        </div>

        {/* CASH Details */}
        {paymentMethod === 'CASH' && (
          <div className="mt-2.5 space-y-2 rounded-xl bg-stone-50 p-2.5 border border-stone-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-stone-700">Uang Diterima:</span>
              <input
                type="number"
                data-testid="cash-received-input"
                value={cashReceived || ''}
                onChange={(e) => setCashReceived(Number(e.target.value))}
                placeholder="0"
                className="w-32 rounded-lg border border-stone-300 bg-white px-2 py-1 text-right text-xs font-bold text-stone-900 focus:border-stone-900 focus:outline-none"
              />
            </div>

            {/* Quick cash shortcut presets */}
            <div className="flex gap-1.5 pt-1">
              <button
                type="button"
                data-testid="cash-preset-exact"
                onClick={() => setCashReceived(totalAmount)}
                className="flex-1 rounded-md border border-stone-300 bg-white py-1 text-[11px] font-bold text-stone-700 hover:bg-stone-100"
              >
                Uang Pas
              </button>
              <button
                type="button"
                data-testid="cash-preset-50k"
                onClick={() => setCashReceived(50000)}
                className="flex-1 rounded-md border border-stone-300 bg-white py-1 text-[11px] font-bold text-stone-700 hover:bg-stone-100"
              >
                50.000
              </button>
              <button
                type="button"
                data-testid="cash-preset-100k"
                onClick={() => setCashReceived(100000)}
                className="flex-1 rounded-md border border-stone-300 bg-white py-1 text-[11px] font-bold text-stone-700 hover:bg-stone-100"
              >
                100.000
              </button>
            </div>

            {/* Change calculation */}
            <div className="flex items-center justify-between border-t border-stone-200 pt-1.5 text-xs font-bold">
              <span>Kembalian:</span>
              <span
                data-testid="change-amount-display"
                className={isCashSufficient ? 'text-emerald-700' : 'text-red-600'}
              >
                {isCashSufficient
                  ? formatRupiah(changeAmount)
                  : `Kurang ${formatRupiah(totalAmount - cashReceived)}`}
              </span>
            </div>
          </div>
        )}

        {/* QRIS Details */}
        {paymentMethod === 'QRIS' && (
          <div className="mt-2.5 rounded-xl bg-stone-50 p-2.5 border border-stone-200 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-lg bg-white border border-stone-300 shadow-sm">
              <span className="font-mono text-xs font-bold text-stone-500">QRIS CODE</span>
            </div>
            <div className="mt-2 text-xs font-bold text-stone-900">
              Tagihan: {formatRupiah(totalAmount)}
            </div>
            <input
              type="text"
              data-testid="qris-ref-input"
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="4 Digit Terakhir RRN (Opsional)"
              maxLength={20}
              className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-2 py-1 text-center text-xs text-stone-900 placeholder-stone-600 focus:border-stone-900 focus:outline-none"
            />
          </div>
        )}

        {/* TRANSFER Details */}
        {paymentMethod === 'TRANSFER' && (
          <div className="mt-2.5 rounded-xl bg-stone-50 p-2.5 border border-stone-200 space-y-1.5">
            <div className="rounded-lg bg-white p-2 border border-stone-200 text-xs text-stone-800">
              <div className="text-[10px] font-bold text-stone-600 uppercase">Rekening Owner</div>
              <div className="font-mono font-bold text-stone-900">BCA: 829-012-3456</div>
              <div className="text-[11px] text-stone-600">a.n. Koncoku Coffee Roastery</div>
            </div>
            <input
              type="text"
              data-testid="transfer-ref-input"
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="Nama Pengirim / Catatan Mutasi (Opsional)"
              className="w-full rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs text-stone-900 placeholder-stone-600 focus:border-stone-900 focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* 5. Error Alert (if any) */}
      {error && (
        <div
          data-testid="cart-error-message"
          className="mt-2 rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-600 border border-red-200"
        >
          {error}
        </div>
      )}

      {/* 6. Total Amount & Primary Action Button */}
      <div className="border-t border-stone-200 pt-3 mt-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-stone-600 uppercase">Total Tagihan</span>
          <span
            data-testid="total-amount-display"
            className="text-lg font-black text-stone-900"
          >
            {formatRupiah(totalAmount)}
          </span>
        </div>

        <button
          type="button"
          data-testid="submit-checkout-button"
          disabled={!canCheckout || isSubmitting}
          onClick={handleCheckout}
          className="w-full rounded-xl bg-stone-900 py-3 text-xs font-bold text-white shadow-md hover:bg-stone-800 active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>Memproses...</span>
            </>
          ) : (
            <span>BAYAR & KIRIM STRUK WA (Enter)</span>
          )}
        </button>
      </div>
    </div>
  );
};