# 04 — Kontrak Endpoint API, Skema Zod, & Kode Error

> **Penyelarasan Endpoint:** Dokumen ini menyatukan seluruh nama rute dari *Master Blueprint* menjadi kontrak tunggal yang wajib dipatuhi bersama oleh *frontend* dan *backend*.

## 1. Daftar Lengkap Endpoint REST API (`Hono.js`)

| Method & Path | Aktor | Deskripsi & Perilaku Utama |
| :--- | :--- | :--- |
| `POST /api/auth/login` | Kasir / Owner | Menerima `{ userId, pin }` (6 digit). Mengembalikan token sesi JWT/HMAC beserta `role` (`OWNER` / `CASHIER`). |
| `GET /api/catalog/sync?version=X` | Kasir | Membandingkan query `version` dengan `catalog_version` di `system_meta`. Jika sama, kembalikan `304 Not Modified`. Jika berbeda, kembalikan `200 OK` berisi `{ version, products, customers }`. |
| `POST /api/transactions` | Kasir | Menyimpan transaksi baru secara idempoten (`idempotency_key`), menghitung ulang harga & HPP di server, memotong stok `TRACKED_STOCK`, meng-*upsert* pelanggan, dan memicu notifikasi audit *Owner*. |
| `GET /api/receipts/:invoice` | Publik | Mengembalikan data struk publik berdasarkan `invoice_number` **tanpa** menyertakan `cost_price` atau `total_cost_amount`. |
| `POST /api/void/request` | Kasir | Membuat permohonan *void* untuk transaksi `COMPLETED`, mengubah status transaksi ke `VOID_PENDING`, mengirim OTP 6-digit & tautan *One-Click* ke *Owner*, lalu mengembalikan `{ voidRequestId, expiresAt }`. |
| `GET /api/void/status/:requestId` | Kasir | Di-*polling* setiap $3\text{ detik}$ oleh layar kasir saat menunggu persetujuan *Owner*. Mengembalikan `{ status: 'PENDING' \| 'APPROVED' \| 'EXPIRED' \| 'REJECTED', invoiceNumber }`. |
| `POST /api/void/verify-otp` | Kasir | Menerima `{ voidRequestId, otpCode }`. Memverifikasi *hash* SHA-256 OTP & masa berlaku, lalu mengeksekusi pembatalan transaksi dan pengembalian stok. |
| `GET /api/void/approve-info?token=T` | Owner | Mengambil ringkasan transaksi yang akan di-*void* berdasarkan *hash* `token` untuk ditampilkan di halaman konfirmasi HP *Owner* (**Bebas efek samping/mutasi DB**). |
| `POST /api/void/approve-one-click` | Owner | Menerima `{ token }`. Memverifikasi *hash* `token` & masa berlaku ($5\text{ menit}$), lalu mengeksekusi pembatalan transaksi dan pengembalian stok. |

---

## 2. Kontrak Skema Zod Bersama (`shared/src/contracts.ts`)

```typescript
import { z } from 'zod';

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

// Normalizer & Validator Nomor WhatsApp Indonesia (628xxxxxxxxxx)
export const IndonesianPhoneSchema = z
  .string()
  .trim()
  .transform((val) => {
    const digits = val.replace(/\D/g, '');
    if (digits.startsWith('08')) return '628' + digits.slice(2);
    if (digits.startsWith('8')) return '628' + digits.slice(1);
    return digits;
  })
  .refine((val) => /^628\d{7,12}$/.test(val), {
    message: 'Nomor WhatsApp harus valid (format 08xx atau 628xx)',
  });

// Payload Checkout Transaksi
export const CreateTransactionSchema = z
  .object({
    idempotency_key: z.string().uuid(),
    payment_method: PaymentMethodSchema,
    payment_reference: z.string().max(100).optional(),
    cash_received: z.number().int().nonnegative().optional(),
    customer: z
      .object({
        phone: IndonesianPhoneSchema,
        name: z.string().trim().min(1).max(100),
      })
      .optional(),
    items: z
      .array(
        z.object({
          product_id: z.string().uuid(),
          qty: z.number().positive(),
        })
      )
      .min(1, 'Keranjang tidak boleh kosong'),
  });

// Payload Request Void
export const CreateVoidRequestSchema = z.object({
  transaction_id: z.string().uuid(),
  reason: z.string().trim().min(5, 'Alasan pembatalan wajib diisi minimal 5 karakter').max(255),
});

// Payload Verifikasi OTP Void
export const VerifyVoidOtpSchema = z.object({
  void_request_id: z.string().uuid(),
  otp_code: z.string().regex(/^\d{6}$/, 'Kode OTP harus 6 digit angka'),
});

// Payload One-Click Approve oleh Owner
export const ApproveOneClickVoidSchema = z.object({
  token: z.string().min(32).max(128),
});
```

---

## 3. Standar Format Error API
Seluruh *error response* dari Hono.js wajib menggunakan struktur JSON yang konsisten agar mudah ditangani oleh `IPosRepository`:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Stok V60 Dripper tidak mencukupi (Sisa: 1, Diminta: 2)",
    "details": {
      "product_id": "0192f0...",
      "available_qty": 1
    }
  }
}
```

### Daftar Kode Error Standar:
- `400 VALIDATION_ERROR`: Payload gagal melewati validasi Zod atau `cash_received < total_amount`.
- `401 UNAUTHORIZED`: PIN salah atau sesi kasir kedaluwarsa.
- `404 NOT_FOUND`: Invoice atau `void_request_id` tidak ditemukan.
- `409 INSUFFICIENT_STOCK`: Stok `TRACKED_STOCK` di server kurang dari jumlah yang dibeli.
- `409 PRODUCT_UNAVAILABLE`: Produk sedang disetel `is_available = 0`.
- `409 ALREADY_VOIDED`: Transaksi sudah dibatalkan sebelumnya.
- `410 VOID_TOKEN_EXPIRED`: Kode OTP atau tautan *One-Click Approve* telah melewati batas waktu $5\text{ menit}$.