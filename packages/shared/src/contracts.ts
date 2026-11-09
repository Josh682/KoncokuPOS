import { z } from 'zod';
import { isValidUUIDv7 } from './uuidv7';

// 1. Enums
export const ProductCategorySchema = z.enum([
  'COFFEE',
  'NON_COFFEE',
  'MANUAL_BREW',
  'SNACK',
  'ROASTED_BEANS',
  'RAW_MATERIAL',
  'TOOLS',
]);

export const InventoryTypeSchema = z.enum(['TRACKED_STOCK', 'AVAILABILITY_ONLY']);
export const PaymentMethodSchema = z.enum(['QRIS', 'CASH', 'TRANSFER']);
export const UserRoleSchema = z.enum(['OWNER', 'CASHIER']);
export const TransactionStatusSchema = z.enum(['COMPLETED', 'VOID_PENDING', 'VOIDED']);
export const VoidRequestStatusSchema = z.enum(['PENDING', 'APPROVED', 'EXPIRED', 'REJECTED']);
export const VoidApprovalTypeSchema = z.enum(['OTP_ENTRY', 'ONE_CLICK_LINK']);
export const InventoryChangeTypeSchema = z.enum(['SALE', 'VOID_RETURN', 'RESTOCK', 'OPNAME_ADJUST']);

// 2. Base Validators
// UUIDv7 validator
export const UUIDv7Schema = z.string().refine((val) => isValidUUIDv7(val), {
  message: 'Format ID harus merupakan UUIDv7 yang valid',
});

// Currency (Rupiah) validator: Strictly INTEGER only (no float/decimal)
export const RupiahCurrencySchema = z
  .number({
    required_error: 'Nominal Rupiah wajib diisi',
    invalid_type_error: 'Nominal Rupiah harus berupa angka',
  })
  .int('Nominal Rupiah harus bilangan bulat (integer), tidak boleh desimal')
  .nonnegative('Nominal Rupiah tidak boleh bernilai negatif');

// Normalizer & Validator Nomor WhatsApp Indonesia (628xxxxxxxxxx)
export function normalizeIndonesianPhone(val: string): string {
  const digits = val.replace(/\D/g, '');
  if (digits.startsWith('08')) return '628' + digits.slice(2);
  if (digits.startsWith('8')) return '628' + digits.slice(1);
  return digits;
}

export function formatRupiah(amount: number): string {
  return 'Rp ' + Math.round(amount).toLocaleString('id-ID');
}

export const IndonesianPhoneSchema = z
  .string({
    required_error: 'Nomor WhatsApp wajib diisi',
  })
  .trim()
  .transform((val) => normalizeIndonesianPhone(val))
  .refine((val) => /^628\d{7,12}$/.test(val), {
    message: 'Nomor WhatsApp harus valid (format 08xx atau 628xx)',
  });

// 3. Auth Schemas
export const LoginRequestSchema = z.object({
  userId: z.string().min(1, 'User ID wajib diisi').optional(),
  pin: z.string().regex(/^\d{6}$/, 'PIN harus berupa 6 digit angka'),
});

export const LoginResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    name: z.string(),
    role: UserRoleSchema,
  }),
});

// 4. Catalog Sync Schemas
export const CatalogSyncQuerySchema = z.object({
  version: z.coerce.number().int().nonnegative().default(0),
});

export const LocalProductSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  category: ProductCategorySchema,
  inventory_type: InventoryTypeSchema,
  sell_price: RupiahCurrencySchema,
  stock_qty: z.number(), // allows decimal (e.g. grams)
  unit: z.string().default('pcs'),
  is_available: z.union([z.literal(0), z.literal(1)]),
  image_url: z.string().nullable().optional(),
  version: z.number().int().nonnegative(),
});

export const LocalCustomerSchema = z.object({
  id: z.string(),
  phone: z.string().regex(/^628\d{7,12}$/),
  name: z.string(),
  visit_count: z.number().int().nonnegative(),
  last_visit_at: z.number().int(),
});

export const CatalogSyncResponseSchema = z.object({
  version: z.number().int().nonnegative(),
  products: z.array(LocalProductSchema),
  customers: z.array(LocalCustomerSchema),
});

// 5. Transaction & Checkout Schemas
export const CartItemInputSchema = z.object({
  product_id: z.string().min(1, 'Product ID wajib diisi'),
  qty: z.number().positive('Jumlah pembelian (qty) harus lebih besar dari 0'),
});

export const CustomerInputSchema = z.object({
  phone: IndonesianPhoneSchema,
  name: z.string().trim().min(1, 'Nama pelanggan wajib diisi').max(100),
});

export const CreateTransactionSchema = z
  .object({
    idempotency_key: UUIDv7Schema,
    payment_method: PaymentMethodSchema,
    payment_reference: z.string().max(100).optional(),
    cash_received: RupiahCurrencySchema.optional(),
    customer: CustomerInputSchema.optional(),
    items: z.array(CartItemInputSchema).min(1, 'Keranjang tidak boleh kosong'),
  })
  .refine(
    (data) => {
      if (data.payment_method === 'CASH' && data.cash_received === undefined) {
        return false;
      }
      return true;
    },
    {
      message: 'Uang tunai diterima (cash_received) wajib diisi untuk metode CASH',
      path: ['cash_received'],
    }
  );

// Alias required by spec
export const CheckoutRequestSchema = CreateTransactionSchema;

// 6. Public Receipt Schemas (Strictly NO HPP / cost_price)
export const PublicReceiptItemSchema = z.object({
  product_id: z.string(),
  product_name_snapshot: z.string(),
  category_snapshot: z.string(),
  qty: z.number().positive(),
  sell_price_snapshot: RupiahCurrencySchema,
  subtotal: RupiahCurrencySchema,
});

export const PublicReceiptSchema = z.object({
  invoice_number: z.string(),
  created_at: z.number().int(),
  status: TransactionStatusSchema,
  payment_method: PaymentMethodSchema,
  payment_reference: z.string().nullable().optional(),
  total_amount: RupiahCurrencySchema,
  cash_received: RupiahCurrencySchema.nullable().optional(),
  change_amount: RupiahCurrencySchema.nullable().optional(),
  customer_name_snapshot: z.string().nullable().optional(),
  customer_phone_snapshot: z.string().nullable().optional(),
  cashier_name: z.string().optional(),
  items: z.array(PublicReceiptItemSchema).min(1),
});

// 7. Void Request & Approval Schemas
export const CreateVoidRequestSchema = z.object({
  transaction_id: z.string().min(1, 'Transaction ID wajib diisi'),
  reason: z.string().trim().min(5, 'Alasan pembatalan wajib diisi minimal 5 karakter').max(255),
});

export const VoidRequestResponseSchema = z.object({
  voidRequestId: z.string(),
  expiresAt: z.number().int(),
});

export const VerifyVoidOtpSchema = z.object({
  void_request_id: z.string().min(1, 'Void Request ID wajib diisi'),
  otp_code: z.string().regex(/^\d{6}$/, 'Kode OTP harus 6 digit angka'),
});

export const ApproveOneClickVoidSchema = z.object({
  token: z.string().min(32).max(128),
});

export const VoidStatusResponseSchema = z.object({
  status: VoidRequestStatusSchema,
  invoiceNumber: z.string().optional(),
});

export const VoidApproveInfoResponseSchema = z.object({
  invoice_number: z.string(),
  cashier_name: z.string(),
  payment_method: PaymentMethodSchema,
  total_amount: RupiahCurrencySchema,
  items: z.array(
    z.object({
      name: z.string(),
      qty: z.number(),
      subtotal: RupiahCurrencySchema,
    })
  ),
  reason: z.string(),
  expires_at: z.number().int(),
  is_expired: z.boolean(),
  status: VoidRequestStatusSchema,
});

export const TransactionListItemSchema = z.object({
  id: z.string(),
  invoice_number: z.string(),
  created_at: z.number().int(),
  status: TransactionStatusSchema,
  payment_method: PaymentMethodSchema,
  total_amount: RupiahCurrencySchema,
  cash_received: RupiahCurrencySchema.nullable().optional(),
  change_amount: RupiahCurrencySchema.nullable().optional(),
  cashier_name: z.string(),
  customer_name_snapshot: z.string().nullable().optional(),
  customer_phone_snapshot: z.string().nullable().optional(),
  items_count: z.number().int(),
  voided_at: z.number().int().nullable().optional(),
  void_reason: z.string().nullable().optional(),
  void_approved_by: VoidApprovalTypeSchema.nullable().optional(),
  active_void_request_id: z.string().nullable().optional(),
  void_expires_at: z.number().int().nullable().optional(),
});

// Helper: WhatsApp Deep-Link Builder
export function buildCustomerWhatsAppUrl(params: {
  phone?: string | null;
  customerName?: string | null;
  invoiceNumber: string;
  totalAmount: number;
}): string {
  const name = params.customerName?.trim() || 'Sahabat Konco';
  const totalFormatted = Math.round(params.totalAmount).toLocaleString('id-ID');
  const message = `Halo Kak ${name}, terima kasih sudah mampir ke *Koncoku Cafe & Roastery*! Berikut rincian pesanan Kakak (${params.invoiceNumber}) senilai *Rp ${totalFormatted}*: https://pos.koncoku.com/r/${params.invoiceNumber}`;
  const encodedText = encodeURIComponent(message);

  if (params.phone) {
    const norm = normalizeIndonesianPhone(params.phone);
    return `https://wa.me/${norm}?text=${encodedText}`;
  }
  return `https://wa.me/?text=${encodedText}`;
}

// 8. API Standard Error Schema
export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

// Inferred Types
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type CatalogSyncQuery = z.infer<typeof CatalogSyncQuerySchema>;
export type CatalogSyncResponse = z.infer<typeof CatalogSyncResponseSchema>;
export type CartItemInput = z.infer<typeof CartItemInputSchema>;
export type CustomerInput = z.infer<typeof CustomerInputSchema>;
export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;
export type CheckoutRequestInput = z.infer<typeof CheckoutRequestSchema>;
export type PublicReceiptItemData = z.infer<typeof PublicReceiptItemSchema>;
export type PublicReceiptData = z.infer<typeof PublicReceiptSchema>;
export type CreateVoidRequestInput = z.infer<typeof CreateVoidRequestSchema>;
export type VoidRequestResponse = z.infer<typeof VoidRequestResponseSchema>;
export type VerifyVoidOtpInput = z.infer<typeof VerifyVoidOtpSchema>;
export type ApproveOneClickVoidInput = z.infer<typeof ApproveOneClickVoidSchema>;
export type VoidStatusResponse = z.infer<typeof VoidStatusResponseSchema>;
export type VoidApproveInfoResponse = z.infer<typeof VoidApproveInfoResponseSchema>;
export type TransactionListItem = z.infer<typeof TransactionListItemSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
