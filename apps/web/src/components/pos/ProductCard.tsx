import React from 'react';
import type { LocalProduct } from '@koncoku/shared';
import { formatRupiah, getProductInitials } from '../../utils/format';
import { useCartStore } from '../../stores/cartStore';

interface ProductCardProps {
  product: LocalProduct;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const addItem = useCartStore((s) => s.addItem);
  const cartItem = useCartStore((s) => s.items.find((i) => i.product.id === product.id));

  // 1. Stock & Availability Calculation
  const isAvailable = product.is_available === 1;
  const isTracked = product.inventory_type === 'TRACKED_STOCK';
  const isOutOfStock = isTracked ? product.stock_qty <= 0 : !isAvailable;
  const isCardDisabled = !isAvailable || isOutOfStock;

  // Check if current cart quantity has reached maximum available tracked stock
  const currentCartQty = cartItem?.qty || 0;
  const isMaxInCart = isTracked && currentCartQty >= product.stock_qty;

  // 2. Badge Status Determination
  let badgeText = '';
  let badgeColorClass = '';

  if (!isAvailable || (isTracked && product.stock_qty <= 0)) {
    badgeText = 'Habis';
    badgeColorClass = 'bg-red-100 text-red-700 border-red-200';
  } else if (!isTracked) {
    badgeText = 'Ready';
    badgeColorClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
  } else if (product.stock_qty <= 3) {
    badgeText = `Sisa ${product.stock_qty}`;
    badgeColorClass = 'bg-amber-100 text-amber-800 border-amber-300 font-semibold';
  } else {
    badgeText = `Stok: ${product.stock_qty} ${product.unit}`;
    badgeColorClass = 'bg-blue-100 text-blue-800 border-blue-200';
  }

  const handleClick = () => {
    if (isCardDisabled || isMaxInCart) return;
    addItem(product);
  };

  const initials = getProductInitials(product.name);

  return (
    <div
      data-testid={`product-card-${product.id}`}
      onClick={handleClick}
      role="button"
      tabIndex={isCardDisabled ? -1 : 0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !isCardDisabled) {
          e.preventDefault();
          handleClick();
        }
      }}
      className={`relative flex flex-col justify-between rounded-xl border bg-white p-3 shadow-sm transition-all select-none
        ${
          isCardDisabled
            ? 'opacity-50 cursor-not-allowed border-stone-200 bg-stone-50'
            : isMaxInCart
              ? 'border-amber-300 ring-1 ring-amber-300 cursor-not-allowed'
              : 'hover:border-stone-400 hover:shadow-md active:scale-[0.98] cursor-pointer border-stone-200'
        }
      `}
    >
      {/* Thumbnail or Initial Box */}
      <div className="relative mb-2.5 h-28 w-full overflow-hidden rounded-lg bg-stone-100 flex items-center justify-center">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-stone-100 text-stone-700 font-bold text-2xl tracking-wider">
            {initials}
          </div>
        )}

        {/* In-cart count badge */}
        {currentCartQty > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-xs font-bold text-white shadow">
            {currentCartQty}
          </span>
        )}
      </div>

      {/* Product Details */}
      <div className="flex flex-col flex-grow justify-between">
        <div>
          <div className="text-xs text-stone-600 font-mono tracking-tight">{product.sku}</div>
          <h3 className="line-clamp-2 text-sm font-semibold text-stone-900 leading-snug">
            {product.name}
          </h3>
        </div>

        <div className="mt-3 flex items-center justify-between pt-1">
          <span className="text-sm font-bold text-stone-900">
            {formatRupiah(product.sell_price)}
          </span>

          <span
            data-testid={`stock-badge-${product.id}`}
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${badgeColorClass}`}
          >
            {badgeText}
          </span>
        </div>
      </div>
    </div>
  );
};