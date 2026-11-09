import React, { useState, useEffect, useRef } from 'react';

interface SearchBarProps {
  onSearchChange: (query: string) => void;
  onSync: () => Promise<void>;
  syncVersion: number;
  isSyncing: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  onSearchChange,
  onSync,
  syncVersion,
  isSyncing,
}) => {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. Debounce 50ms as required by docs/DESIGN_SYSTEM.md (Zero-Latency Local Search)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      onSearchChange(inputValue);
    }, 50);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [inputValue, onSearchChange]);

  // 2. Global shortcut '/' to focus search bar & 'Esc' to clear
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isInputActive =
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        activeTag === 'select' ||
        (document.activeElement as HTMLElement)?.isContentEditable;

      if (e.key === '/' && !isInputActive) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        setInputValue('');
        inputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex w-full items-center gap-3">
      {/* Search Input Container */}
      <div className="relative flex-grow">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-stone-600">
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        <input
          ref={inputRef}
          data-testid="pos-search-input"
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Cari nama kopi, SKU... (Tekan '/' untuk fokus)"
          className="w-full rounded-xl border border-stone-200 bg-white py-2 pl-9 pr-14 text-sm text-stone-900 placeholder-stone-600 shadow-sm transition-all focus:border-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-900"
        />

        {/* Clear or Shortcut badge */}
        <div className="absolute inset-y-0 right-0 flex items-center pr-2">
          {inputValue ? (
            <button
              type="button"
              onClick={() => {
                setInputValue('');
                inputRef.current?.focus();
              }}
              className="rounded p-1 text-stone-600 hover:text-stone-900"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] font-mono text-stone-600">
              /
            </kbd>
          )}
        </div>
      </div>

      {/* Sync Button & Status Badge */}
      <button
        type="button"
        data-testid="sync-catalog-button"
        onClick={() => onSync()}
        disabled={isSyncing}
        title="Sinkronisasi katalog dengan server"
        className="flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700 shadow-sm transition-all hover:bg-stone-50 active:scale-95 disabled:opacity-50"
      >
        <span
          className={`h-2 w-2 rounded-full ${
            isSyncing ? 'bg-amber-400 animate-ping' : 'bg-emerald-500'
          }`}
        />
        <span>{isSyncing ? 'Syncing...' : `Sync OK (v${syncVersion})`}</span>
      </button>
    </div>
  );
};