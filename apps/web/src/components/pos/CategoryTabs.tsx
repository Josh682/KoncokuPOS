import React from 'react';
import type { ProductFilterCategory } from '../../services/posRepository';
import { CATEGORY_LABELS } from '../../utils/format';

export const CATEGORIES: ProductFilterCategory[] = [
  'ALL',
  'COFFEE',
  'NON_COFFEE',
  'MANUAL_BREW',
  'SNACK',
  'ROASTED_BEANS',
  'RAW_MATERIAL',
  'TOOLS',
];

interface CategoryTabsProps {
  selectedCategory: ProductFilterCategory;
  onSelectCategory: (category: ProductFilterCategory) => void;
}

export const CategoryTabs: React.FC<CategoryTabsProps> = ({
  selectedCategory,
  onSelectCategory,
}) => {
  return (
    <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 scrollbar-none select-none">
      {CATEGORIES.map((cat) => {
        const isActive = selectedCategory === cat;
        return (
          <button
            key={cat}
            data-testid={`category-tab-${cat}`}
            type="button"
            onClick={() => onSelectCategory(cat)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
              isActive
                ? 'bg-stone-900 text-white shadow-sm ring-1 ring-stone-900'
                : 'bg-white text-stone-600 hover:bg-stone-100 hover:text-stone-900 border border-stone-200'
            }`}
          >
            {CATEGORY_LABELS[cat] || cat}
          </button>
        );
      })}
    </div>
  );
};