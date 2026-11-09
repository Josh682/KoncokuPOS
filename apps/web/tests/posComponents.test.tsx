import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LocalProduct } from '@koncoku/shared';
import { ProductCard } from '../src/components/pos/ProductCard';
import { CategoryTabs, CATEGORIES } from '../src/components/pos/CategoryTabs';
import { formatRupiah, getProductInitials } from '../src/utils/format';

describe('Stage 3 — POS Components Visual Rules & Badges', () => {
  const trackedProductAdequateStock: LocalProduct = {
    id: '01931000-0000-7000-8000-000000000005',
    sku: 'SNK-CROISS-01',
    name: 'Butter Croissant',
    category: 'SNACK',
    inventory_type: 'TRACKED_STOCK',
    sell_price: 20000,
    stock_qty: 5,
    unit: 'pcs',
    is_available: 1,
    image_url: null,
    version: 1,
  };

  const trackedProductLowStock: LocalProduct = {
    id: '01931000-0000-7000-8000-000000000006',
    sku: 'BNS-GAYO-200G',
    name: 'Roasted Beans Aceh Gayo 200g',
    category: 'ROASTED_BEANS',
    inventory_type: 'TRACKED_STOCK',
    sell_price: 85000,
    stock_qty: 2, // Sisa 2
    unit: 'pack',
    is_available: 1,
    image_url: null,
    version: 1,
  };

  const trackedProductOutOfStock: LocalProduct = {
    id: '01931000-0000-7000-8000-000000000008',
    sku: 'TLS-V60-02',
    name: 'Hario V60 Plastic 02',
    category: 'TOOLS',
    inventory_type: 'TRACKED_STOCK',
    sell_price: 95000,
    stock_qty: 0, // Habis
    unit: 'pcs',
    is_available: 1,
    image_url: null,
    version: 1,
  };

  const availableDrink: LocalProduct = {
    id: '01931000-0000-7000-8000-000000000001',
    sku: 'COF-ESPR-01',
    name: 'Espresso Single Shot',
    category: 'COFFEE',
    inventory_type: 'AVAILABILITY_ONLY',
    sell_price: 15000,
    stock_qty: 0,
    unit: 'cup',
    is_available: 1,
    image_url: null,
    version: 1,
  };

  const unavailableDrink: LocalProduct = {
    id: '01931000-0000-7000-8000-000000000009',
    sku: 'COF-COLD-01',
    name: 'Cold Brew Bottled',
    category: 'COFFEE',
    inventory_type: 'AVAILABILITY_ONLY',
    sell_price: 25000,
    stock_qty: 0,
    unit: 'bottle',
    is_available: 0,
    image_url: null,
    version: 1,
  };

  describe('1. Aturan Indikator Visual Stok (Hybrid Inventory Badges)', () => {
    it('renders green "Ready" badge for AVAILABILITY_ONLY with is_available = 1', () => {
      const html = renderToStaticMarkup(<ProductCard product={availableDrink} />);
      expect(html).toContain('Ready');
      expect(html).toContain('bg-emerald-100');
      expect(html).not.toContain('opacity-50 cursor-not-allowed');
    });

    it('renders red "Habis" badge and opacity-50 for AVAILABILITY_ONLY with is_available = 0', () => {
      const html = renderToStaticMarkup(<ProductCard product={unavailableDrink} />);
      expect(html).toContain('Habis');
      expect(html).toContain('bg-red-100');
      expect(html).toContain('opacity-50 cursor-not-allowed');
    });

    it('renders neutral/blue "Stok: 5 pcs" badge for TRACKED_STOCK with stock_qty > 3', () => {
      const html = renderToStaticMarkup(<ProductCard product={trackedProductAdequateStock} />);
      expect(html).toContain('Stok: 5 pcs');
      expect(html).toContain('bg-blue-100');
      expect(html).not.toContain('opacity-50 cursor-not-allowed');
    });

    it('renders yellow amber "Sisa 2" badge for TRACKED_STOCK with 1 <= stock_qty <= 3', () => {
      const html = renderToStaticMarkup(<ProductCard product={trackedProductLowStock} />);
      expect(html).toContain('Sisa 2');
      expect(html).toContain('bg-amber-100');
      expect(html).not.toContain('opacity-50 cursor-not-allowed');
    });

    it('renders red "Habis" badge and disabled styling for TRACKED_STOCK with stock_qty <= 0', () => {
      const html = renderToStaticMarkup(<ProductCard product={trackedProductOutOfStock} />);
      expect(html).toContain('Habis');
      expect(html).toContain('bg-red-100');
      expect(html).toContain('opacity-50 cursor-not-allowed');
    });
  });

  describe('2. Horizontal Pill Tabs (8 Kategori)', () => {
    it('renders all 8 category pills in fixed order', () => {
      const html = renderToStaticMarkup(
        <CategoryTabs selectedCategory="ALL" onSelectCategory={() => {}} />
      );

      expect(CATEGORIES).toEqual([
        'ALL',
        'COFFEE',
        'NON_COFFEE',
        'MANUAL_BREW',
        'SNACK',
        'ROASTED_BEANS',
        'RAW_MATERIAL',
        'TOOLS',
      ]);

      // Checks Indonesian display labels
      expect(html).toContain('Semua');
      expect(html).toContain('Kopi');
      expect(html).toContain('Non-Kopi');
      expect(html).toContain('Manual Brew');
      expect(html).toContain('Snack');
      expect(html).toContain('Roasted Beans');
      expect(html).toContain('Bahan Baku');
      expect(html).toContain('Alat Kopi');
    });
  });

  describe('3. Formatting & Initial Placeholder Helpers', () => {
    it('extracts two-letter initials cleanly for image placeholder', () => {
      expect(getProductInitials('Kopi Susu')).toBe('KS');
      expect(getProductInitials('Cafe Latte')).toBe('CL');
      expect(getProductInitials('Espresso')).toBe('ES');
      expect(getProductInitials('V60 Gayo Anaerob')).toBe('VG');
      expect(getProductInitials('')).toBe('KP');
    });

    it('formats integer currency Rupiah with dot separator and no decimals', () => {
      expect(formatRupiah(18000)).toBe('Rp 18.000');
      expect(formatRupiah(145000)).toBe('Rp 145.000');
      expect(formatRupiah(0)).toBe('Rp 0');
    });
  });
});