# DESIGN_SYSTEM.md — Ergonomi Layar Kasir, Visual Stok, & Struk Digital

## 1. Prinsip Ergonomi Kasir: Kecepatan Tangan & Zero-Reload
Kasir bekerja dalam kondisi antrean ramai. Antarmuka harus meminimalkan gerakan tangan, mendukung pintasan *keyboard*, dan memberikan umpan balik visual instan ($< 16\text{ ms}$, $1\text{ frame}$) setiap kali produk disentuh tanpa menunggu respons jaringan.

---

## 2. Tata Letak Split-Screen (Desktop & Tablet Landscape $\ge 1024\text{px}$)

```text
+--------------------------------------------------+----------------------------+
| [ / Cari nama kopi, SKU...          ] [Sync OK]  | KERANJANG (#KCK-Draft) [X] |
| (ALL)(COFFEE)(NON_COFFEE)(MANUAL_BREW)(SNACK)... | -------------------------- |
| +--------------+ +--------------+ +------------+ | 1x Kopi Susu Konco  18.000 |
| | [Foto/Inis.] | | [Foto/Inis.] | | [ Sisa 2 ] | |    [-] [1] [+]             |
| | Kopi Susu    | | V60 Gayo     | | V60 Dripper| | 1x Beans Gayo 200g  85.000 |
| | Rp 18.000    | | Rp 25.000    | | Rp 145.000 | | -------------------------- |
| | [  Ready   ] | | [  Ready   ] | | [ Stok: 2] | | No WA : [628123456789    ] |
| +--------------+ +--------------+ +------------+ | Nama  : [Budi (Auto)     ] |
|                                                  | Bayar : (QRIS)(CASH)(TF)   |
|                                                  | [Uang Pas][50.000][100.000]|
|                                                  | TOTAL : Rp 103.000         |
|                                                  | [ BAYAR & STRUK WA (Enter)]|
+--------------------------------------------------+----------------------------+
| <---------------- 65% Lebar Layar -------------> | <----- 35% Lebar Layar --> |
```

### 2.1. Panel Kiri ($65\%$ Lebar): Katalog & Filter Instan
1. **Bar Pencarian Cepat:**
   - Menekan tombol `/` di *keyboard* langsung memfokuskan kursor ke *search bar* (kecuali kursor sedang berada di *input form* lain).
   - Menekan `Esc` mengosongkan kata kunci pencarian.
   - Pencarian menggunakan *debounce* $50\text{ ms}$ langsung ke memori `Dexie.js`.
2. **Horizontal Pill Tabs (8 Kategori):**
   - Urutan tetap: `ALL` (Semua), `COFFEE`, `NON_COFFEE`, `MANUAL_BREW`, `SNACK`, `ROASTED_BEANS`, `RAW_MATERIAL`, `TOOLS`.
3. **Grid Kartu Produk (3–4 Kolom):**
   - **Thumbnail / Placeholder:** Jika `image_url == null`, render kotak berlatar warna hangat dengan **2 huruf inisial nama produk** (misal `KS` untuk *Kopi Susu*). Gambar yang diunggah wajib dikompresi di sisi klien menjadi `.webp` berukuran $< 40\text{ KB}$.
   - **Format Harga:** Gunakan pemisah titik ribuan Rupiah tanpa desimal (contoh: `Rp 25.000`).

### 2.2. Panel Kanan ($35\%$ Lebar): Keranjang Sticky & Checkout
- **Header Keranjang:** Menampilkan jumlah item aktif dan tombol **"Batal / Kosongkan"** (memicu *confirmation modal* ringan untuk mereset keranjang lokal tanpa memanggil API).
- **Form Pelanggan Cepat (CRM):**
  - Input `Nomor WhatsApp` otomatis mengubah awalan `08...` atau `+628...` menjadi `628...`.
  - Begitu kasir mengetik $\ge 4\text{ digit}$, tampilkan *dropdown auto-complete* dari tabel `customers` di `Dexie.js` dan isi otomatis kolom `Nama Pelanggan` saat dipilih.
- **Pemilih Metode Bayar (`CASH`, `QRIS`, `TRANSFER`):**
  - Jika `CASH`: tampilkan tombol nominal cepat (**Uang Pas**, **Rp 50.000**, **Rp 100.000**) dan kalkulasi kembalian (`change_amount`) secara *real-time*.
  - Jika `QRIS`: tampilkan gambar QRIS statis/dinamis toko beserta input opsional 4 digit terakhir RRN.
  - Jika `TRANSFER`: tampilkan info rekening bank *Owner* beserta input opsional nama pengirim/catatan mutasi.

---

## 3. Aturan Indikator Visual Stok (Hybrid Inventory Badges)

| Tipe Inventori | Kondisi Data Produk | Warna & Teks Badge | Perilaku Kartu Produk |
| :--- | :--- | :--- | :--- |
| `AVAILABILITY_ONLY` | `is_available == 1` | Hijau (`#10B981`) — `"Ready"` | Aktif, dapat diklik masuk keranjang. |
| `AVAILABILITY_ONLY` | `is_available == 0` | Merah (`#EF4444`) — `"Habis"` | `opacity-50`, kursor `not-allowed`, klik dinonaktifkan. |
| `TRACKED_STOCK` | `stock_qty > 3` dan `is_available == 1` | Netral/Biru — `"Stok: {stock_qty} {unit}"` | Aktif; jumlah di keranjang tidak boleh melebihi `stock_qty`. |
| `TRACKED_STOCK` | `1 <= stock_qty <= 3` dan `is_available == 1` | Kuning Amber (`#F59E0B`) — `"Sisa {stock_qty}"` | Aktif dengan peringatan stok menipis. |
| `TRACKED_STOCK` | `stock_qty <= 0` atau `is_available == 0` | Merah (`#EF4444`) — `"Habis"` | `opacity-50`, kursor `not-allowed`, klik dinonaktifkan. |

---

## 4. Desain Halaman Khusus (Mobile-First)
1. **Halaman Struk Digital Pelanggan (`/r/:invoice_number`):**
   - Desain bersih menyerupai kartu bukti transaksi modern untuk layar ponsel ($360\text{px}–430\text{px}$).
   - Menampilkan logo/nama **Koncoku Cafe & Roastery**, Nomor Invoice, Waktu Transaksi, Nama Kasir, Nama Pelanggan, rincian item, Metode Bayar, Total Bayar, Uang Diterima/Kembalian, dan stempel status (`LUNAS` berwarna hijau atau `DIBATALKAN / VOID` berwarna merah).
   - **Dilarang keras** memanggil `window.print()` atau menampilkan data HPP (`cost_price`).
2. **Halaman One-Click Void Approval Owner (`/void-approve?token=...`):**
   - Tampilan kartu peringatan kontras tinggi untuk layar HP *Owner*.
   - Menampilkan detail struk yang diajukan batal, alasan kasir, hitung mundur waktu kedaluwarsa token ($5\text{ menit}$), dan **1 tombol besar berwarna merah**: **"SETUJUI PEMBATALAN SEKARANG"** (mengirimkan `POST` ke server).