import React, { useState, useEffect, useCallback } from 'react';
import type { LocalProduct, TransactionListItem } from '@koncoku/shared';
import { posRepository, type ProductFilterCategory } from '../services/posRepository';
import { useAuthStore } from '../stores/authStore';
import { useCartStore } from '../stores/cartStore';

import { SearchBar } from '../components/pos/SearchBar';
import { CategoryTabs } from '../components/pos/CategoryTabs';
import { ProductCard } from '../components/pos/ProductCard';
import { ActiveCartPanel } from '../components/pos/ActiveCartPanel';
import { ClearCartModal } from '../components/pos/ClearCartModal';
import { SuccessReceiptModal } from '../components/pos/SuccessReceiptModal';
import { PinLoginModal } from '../components/pos/PinLoginModal';
import { TransactionHistoryModal } from '../components/pos/TransactionHistoryModal';
import { RequestVoidModal } from '../components/pos/RequestVoidModal';
import { WaitingVoidApprovalModal } from '../components/pos/WaitingVoidApprovalModal';

export const PosPage: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState<ProductFilterCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncVersion, setSyncVersion] = useState(1);

  // History & Void Modals State
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedTxForVoid, setSelectedTxForVoid] = useState<TransactionListItem | null>(null);
  const [activeWaitingVoid, setActiveWaitingVoid] = useState<{
    voidRequestId: string;
    invoiceNumber: string;
    expiresAt: number;
  } | null>(null);

  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useAuthStore((s) => s.logout);

  const canCheckout = useCartStore((s) => s.canCheckout)();
  const isSubmitting = useCartStore((s) => s.isSubmitting);
  const submitCheckout = useCartStore((s) => s.submitCheckout);
  const isConfirmationOpen = useCartStore((s) => s.isConfirmationOpen);
  const lastReceipt = useCartStore((s) => s.lastReceipt);

  // 1. Zero-Latency Read from local Dexie.js (<10ms)
  const refreshProductsFromDexie = useCallback(async () => {
    try {
      const items = await posRepository.searchProductsLocal(searchQuery, selectedCategory);
      setProducts(items);

      const meta = await posRepository.db.sync_meta.get('catalog_version');
      if (meta) {
        setSyncVersion(parseInt(meta.value, 10));
      }
    } catch (err) {
      console.error('Failed to query local Dexie database:', err);
    }
  }, [searchQuery, selectedCategory]);

  // Query Dexie whenever category or query changes
  useEffect(() => {
    refreshProductsFromDexie();
  }, [refreshProductsFromDexie]);

  // 2. Initial catalog sync on mount (Zero-Read Sync)
  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const result = await posRepository.syncCatalogIfNeeded();
      setSyncVersion(result.version);
      await refreshProductsFromDexie();
    } finally {
      setIsSyncing(false);
    }
  }, [refreshProductsFromDexie]);

  useEffect(() => {
    handleSync();
  }, [handleSync]);

  // 3. Global 'Enter' key shortcut to submit checkout when valid
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const activeTag = document.activeElement?.tagName.toLowerCase();
        // Do not intercept Enter if typing inside text input or modal is open
        if (
          !isConfirmationOpen &&
          !lastReceipt &&
          !isSubmitting &&
          !isHistoryOpen &&
          !selectedTxForVoid &&
          !activeWaitingVoid &&
          canCheckout &&
          activeTag !== 'input' &&
          activeTag !== 'textarea'
        ) {
          e.preventDefault();
          submitCheckout(posRepository).catch(() => {});
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    canCheckout,
    isConfirmationOpen,
    lastReceipt,
    isSubmitting,
    isHistoryOpen,
    selectedTxForVoid,
    activeWaitingVoid,
    submitCheckout,
  ]);

  const handleVoidCompleted = useCallback(async () => {
    setActiveWaitingVoid(null);
    setSelectedTxForVoid(null);
    await handleSync();
  }, [handleSync]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-stone-100 font-sans text-stone-900 select-none">
      {/* Fast PIN Login Modal Overlay */}
      {!isAuthenticated && <PinLoginModal />}

      {/* Confirmation & Success Modals */}
      <ClearCartModal />
      <SuccessReceiptModal />

      {/* Cashier History & Void Modals */}
      <TransactionHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onRequestVoid={(tx) => {
          setSelectedTxForVoid(tx);
        }}
        onCheckPendingVoid={(tx) => {
          if (tx.active_void_request_id) {
            setActiveWaitingVoid({
              voidRequestId: tx.active_void_request_id,
              invoiceNumber: tx.invoice_number,
              expiresAt: tx.void_expires_at || Date.now() + 300000,
            });
          }
        }}
      />

      {selectedTxForVoid && (
        <RequestVoidModal
          transaction={selectedTxForVoid}
          onClose={() => setSelectedTxForVoid(null)}
          onRequestSuccess={(voidRequestId, expiresAt) => {
            const invoice = selectedTxForVoid.invoice_number;
            setSelectedTxForVoid(null);
            setActiveWaitingVoid({
              voidRequestId,
              invoiceNumber: invoice,
              expiresAt,
            });
          }}
        />
      )}

      {activeWaitingVoid && (
        <WaitingVoidApprovalModal
          voidRequestId={activeWaitingVoid.voidRequestId}
          invoiceNumber={activeWaitingVoid.invoiceNumber}
          expiresAt={activeWaitingVoid.expiresAt}
          onClose={() => setActiveWaitingVoid(null)}
          onVoidCompleted={handleVoidCompleted}
        />
      )}

      {/* Main Split-Screen Container */}
      <div className="flex h-full w-full flex-col lg:flex-row overflow-hidden p-3 gap-3">
        {/* ========================================================= */}
        {/* PANEL KIRI (65% Lebar Layar) — Katalog & Filter Instan    */}
        {/* ========================================================= */}
        <section
          data-testid="left-catalog-panel"
          className="flex h-full w-full lg:w-[65%] flex-col rounded-2xl border border-stone-200 bg-white p-4 shadow-sm overflow-hidden"
        >
          {/* Header Bar: Brand, History Button, Cashier Info, Logout */}
          <div className="flex items-center justify-between border-b border-stone-100 pb-3 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-stone-900 text-xs font-black text-white shadow-sm font-mono">
                KC
              </div>
              <div>
                <h1 className="text-sm font-black tracking-tight text-stone-900 leading-none">
                  KONCOKU POS
                </h1>
                <span className="text-[10px] font-medium text-stone-600">
                  Cafe & Roastery Edition
                </span>
              </div>
            </div>

            {/* Actions: History, Cashier status & Logout */}
            <div className="flex items-center gap-2.5">
              {/* History Struk Button */}
              <button
                type="button"
                data-testid="open-history-button"
                onClick={() => setIsHistoryOpen(true)}
                className="flex items-center gap-1.5 rounded-xl border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-100 hover:text-stone-900 active:scale-95 transition-all"
              >
                <span>🕒</span>
                <span>Riwayat Struk</span>
              </button>

              <div className="text-right">
                <div className="text-xs font-bold text-stone-900">
                  {user?.name || 'Kasir Koncoku'}
                </div>
                <div className="text-[10px] text-stone-600 font-mono">
                  Role: {user?.role || 'CASHIER'}
                </div>
              </div>

              <button
                type="button"
                data-testid="cashier-logout-button"
                onClick={logout}
                title="Ganti Kasir / Keluar"
                className="rounded-lg border border-stone-200 p-1.5 text-stone-600 hover:bg-stone-50 hover:text-stone-900"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Search Bar with Debounce 50ms & Shortcut '/' */}
          <div className="mb-3">
            <SearchBar
              onSearchChange={setSearchQuery}
              onSync={handleSync}
              syncVersion={syncVersion}
              isSyncing={isSyncing}
            />
          </div>

          {/* Horizontal Pill Tabs for 8 Categories */}
          <div className="mb-3">
            <CategoryTabs
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
            />
          </div>

          {/* Grid Kartu Produk (3–4 Kolom) */}
          <div className="flex-grow overflow-y-auto pr-1">
            {products.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center text-center text-stone-600">
                <p className="text-sm font-semibold">Tidak ada produk ditemukan</p>
                <p className="text-xs text-stone-600 mt-1">
                  Coba ganti kategori atau kata kunci pencarian
                </p>
              </div>
            ) : (
              <div
                data-testid="products-grid"
                className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 pb-4"
              >
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ========================================================= */}
        {/* PANEL KANAN (35% Lebar Layar) — Active Cart & Checkout    */}
        {/* ========================================================= */}
        <section
          data-testid="right-checkout-panel"
          className="flex h-full w-full lg:w-[35%] flex-col overflow-hidden"
        >
          <ActiveCartPanel />
        </section>
      </div>
    </div>
  );
};
