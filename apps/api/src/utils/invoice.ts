/**
 * Format invoice number KCK-YYMMDD-XXXX based on WIB timezone (Asia/Jakarta)
 */
export function getWibDateString(date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value || '26';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return `${year}${month}${day}`;
}

export async function generateUniqueInvoiceNumber(db: D1Database, date = new Date()): Promise<string> {
  const dateStr = getWibDateString(date);
  const prefix = `KCK-${dateStr}-`;

  const countRow = await db
    .prepare("SELECT COUNT(*) as count FROM transactions WHERE invoice_number LIKE ? || '%'")
    .bind(prefix)
    .first<{ count: number }>();

  const nextSeq = (countRow?.count || 0) + 1;
  const candidate = `${prefix}${nextSeq.toString().padStart(4, '0')}`;

  const exists = await db
    .prepare('SELECT 1 FROM transactions WHERE invoice_number = ?')
    .bind(candidate)
    .first();

  if (!exists) {
    return candidate;
  }

  // Fallback in case of concurrent sequence collision
  const rand = Math.floor(1000 + Math.random() * 9000).toString();
  return `${prefix}${rand}`;
}
