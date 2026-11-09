/**
 * Formatting & Display Helpers for Koncoku POS UI
 */

export function formatRupiah(amount: number): string {
  return 'Rp ' + Math.round(amount).toLocaleString('id-ID');
}

export function getProductInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const second = parts[1];
  if (!first) return 'KP';
  if (!second) return first.slice(0, 2).toUpperCase();
  const c1 = first[0] ?? 'K';
  const c2 = second[0] ?? 'P';
  return (c1 + c2).toUpperCase();
}

export const CATEGORY_LABELS: Record<string, string> = {
  ALL: 'Semua',
  COFFEE: 'Kopi',
  NON_COFFEE: 'Non-Kopi',
  MANUAL_BREW: 'Manual Brew',
  SNACK: 'Snack',
  ROASTED_BEANS: 'Roasted Beans',
  RAW_MATERIAL: 'Bahan Baku',
  TOOLS: 'Alat Kopi',
};