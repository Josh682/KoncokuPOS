# 02 — Katalog 8 Kategori, Kalkulasi Keranjang, & Checkout Atomik

## 1. Modul Katalog & Pencarian Lokal ($< 10\text{ ms}$)
1. **8 Kategori Produk:**
   - Filter UI menyajikan `ALL` (filter virtual untuk menampilkan seluruh produk) diikuti 7 nilai `category` database: `COFFEE`, `NON_COFFEE`, `MANUAL_BREW`, `SNACK`, `ROASTED_BEANS`, `RAW_MATERIAL`, `TOOLS`.
2. **Pencarian Instan Bebas API:**
   - Input pencarian di-debounce $50\text{ ms}$ dan memfilter koleksi `db.products` di `Dexie.js` dengan pencocokan *case-insensitive substring* pada kolom `name` atau `sku`.
3. **Sinkronisasi Katalog Hemat Kuota (`Zero-Read Sync`):**
   - Saat aplikasi dibuka, setelah transaksi berhasil, atau ketika kasir menekan tombol *Sync*, klien membaca `catalog_version` lokal dari tabel `sync_meta` di `Dexie.js` lalu memanggil `GET /api/catalog/sync?version=X`.
   - Server hanya menjalankan 1 pembacaan baris pada `system_meta`. Jika `X == catalog_version`, server langsung mengembalikan status `304 Not Modified` tanpa membaca tabel `products`.
   - Jika berbeda, server mengembalikan daftar produk terbaru dan nilai `catalog_version` baru untuk di-*bulkPut* ke dalam `Dexie.js`.

---

## 2. Manajemen Keranjang (`Zustand`) & Idempotency
1. **Siklus Hidup `idempotency_key`:**
   - Begitu item pertama dimasukkan ke keranjang kosong, `Zustand` langsung men-*generate* `idempotency_key` baru berformat **UUIDv7**.
   - Kunci ini dipertahankan selama keranjang yang sama dicoba untuk dibayar (termasuk saat *retry* akibat sinyal terputus), dan baru diganti dengan UUIDv7 baru setelah transaksi `COMPLETED` atau saat kasir mengosongkan keranjang (`Clear Cart`).
2. **Validasi Kuantitas Keranjang di Klien:**
   - Untuk produk `TRACKED_STOCK`, penambahan kuantitas di keranjang dibatasi hingga $\text{qty} \le \text{stock\_qty}$.
   - Untuk produk `AVAILABILITY_ONLY`, produk dapat ditambahkan selama `is_available == 1`.

---

## 3. Metode Pembayaran & Validasi Nominal
1. **`CASH` (Tunai):**
   - Wajib menyertakan `cash_received >= total_amount`.
   - `change_amount = cash_received - total_amount`.
2. **`QRIS`:**
   - `cash_received = total_amount` dan `change_amount = 0`.
   - `payment_reference` bersifat opsional (menyimpan 4 digit terakhir RRN QRIS jika diisi kasir).
3. **`TRANSFER`:**
   - `cash_received = total_amount` dan `change_amount = 0`.
   - `payment_reference` bersifat opsional (menyimpan nama pengirim atau catatan mutasi rekening).

---

## 4. Urutan Eksekusi Checkout Atomik di Server (`POST /api/transactions`)
Saat menerima *request* *checkout*, *backend* wajib menjalankan langkah berikut secara berurutan:

1. **Cek Idempotensi:**
   - Periksa apakah `idempotency_key` sudah ada di tabel `transactions`. Jika sudah ada, langsung kembalikan data transaksi tersebut (`200 OK`) tanpa memotong stok dua kali.
2. **Zero-Trust Recalculation & Validasi Stok:**
   - Ambil seluruh baris `products` dari D1 berdasarkan daftar `product_id` yang dikirim klien.
   - Tolak transaksi (`409 Conflict` — `PRODUCT_UNAVAILABLE` atau `INSUFFICIENT_STOCK`) jika ada produk dengan `is_available == 0` atau jika produk bertipe `TRACKED_STOCK` memiliki `stock_qty < item.qty`.
   - Hitung ulang untuk setiap item:
     - $\text{subtotal}_i = \text{ round}(\text{qty}_i \times \text{product.sell\_price})$ (sebagai `INTEGER`)
     - $\text{cost\_subtotal}_i = \text{ round}(\text{qty}_i \times \text{product.cost\_price})$ (sebagai `INTEGER`)
   - Hitung $\text{total\_amount} = \sum \text{subtotal}_i$ dan $\text{total\_cost\_amount} = \sum \text{cost\_subtotal}_i$.
   - Jika `payment_method == 'CASH'`, pastikan `cash_received >= total_amount`.
3. **Penomoran Invoice (`KCK-YYMMDD-XXXX`):**
   - Buat nomor invoice unik berdasarkan tanggal hari ini (zona waktu `Asia/Jakarta` / WIB) diikuti 4 karakter urut atau alfanumerik unik.
4. **Eksekusi `db.batch()` Atomik di D1:**
   - *Upsert* data `customers` (jika pelanggan mengisi nomor WA: normalkan ke `628...`, jika nomor sudah ada maka tambahkan `visit_count = visit_count + 1`, `total_spent = total_spent + total_amount`, dan perbarui `last_visit_at`).
   - Kurangi `stock_qty` untuk setiap item bertipe `TRACKED_STOCK` dan catat baris `SALE` ($\text{qty\_delta} = -\text{qty}$) ke `inventory_logs`.
   - Simpan header ke `transactions` (`status = 'COMPLETED'`) dan rincian baris ke `transaction_items`.
   - Naikkan `catalog_version` di `system_meta` jika ada perubahan stok `TRACKED_STOCK`.
5. **Pengiriman Audit Owner Asinkron:**
   - Gunakan `c.executionCtx.waitUntil()` untuk memanggil `notificationProvider.sendOwnerAuditReceipt()` agar pengiriman pesan Telegram/WA ke *Owner* tidak menambah latensi respons API kasir.