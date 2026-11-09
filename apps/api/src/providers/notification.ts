import type { PublicReceiptData } from '@koncoku/shared';
import type { Env } from '../types';

export interface VoidApprovalNotificationPayload {
  invoiceNumber: string;
  cashierName: string;
  paymentMethod: 'QRIS' | 'CASH' | 'TRANSFER';
  totalAmount: number;
  itemsSummary: Array<{ name: string; qty: number; subtotal: number }>;
  reason: string;
  plainOtpCode: string;
  oneClickApproveUrl: string;
}

export type OwnerAuditReceiptPayload = PublicReceiptData & {
  totalCostAmount: number;
  grossProfit: number;
};

export interface INotificationProvider {
  sendVoidApprovalRequest(payload: VoidApprovalNotificationPayload): Promise<void>;
  sendOwnerAuditReceipt(receipt: OwnerAuditReceiptPayload): Promise<void>;
}

export class TelegramNotificationProvider implements INotificationProvider {
  constructor(
    private readonly botToken: string,
    private readonly ownerChatId: string
  ) {}

  async sendOwnerAuditReceipt(receipt: OwnerAuditReceiptPayload): Promise<void> {
    try {
      if (!this.botToken || !this.ownerChatId) {
        return;
      }

      const itemsList = receipt.items
        .map((i) => `• ${i.qty}x ${i.product_name_snapshot} = Rp ${i.subtotal.toLocaleString('id-ID')}`)
        .join('\n');

      const message = [
        '☕ <b>AUDIT TRANSAKSI BARU (KONCOKU)</b>',
        `🧾 Invoice: <code>${receipt.invoice_number}</code>`,
        `👤 Kasir: ${receipt.cashier_name || 'Kasir'}`,
        `👥 Pelanggan: ${receipt.customer_name_snapshot || 'Umum'} (${receipt.customer_phone_snapshot || '-'})`,
        `💳 Metode: <b>${receipt.payment_method}</b>`,
        '---------------------------------',
        '<b>Daftar Item:</b>',
        itemsList,
        '---------------------------------',
        `💰 Total Omzet: <b>Rp ${receipt.total_amount.toLocaleString('id-ID')}</b>`,
        `📉 Total HPP: <b>Rp ${receipt.totalCostAmount.toLocaleString('id-ID')}</b>`,
        `✨ Laba Kotor: <b>Rp ${receipt.grossProfit.toLocaleString('id-ID')}</b>`,
      ].join('\n');

      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.ownerChatId,
          text: message,
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Telegram API responded with HTTP ${response.status}: ${errorText}`);
      }
    } catch (err) {
      console.error('Failed to send Telegram audit notification:', err);
    }
  }

  async sendVoidApprovalRequest(payload: VoidApprovalNotificationPayload): Promise<void> {
    try {
      if (!this.botToken || !this.ownerChatId) {
        return;
      }

      const itemsList = payload.itemsSummary
        .map((i) => `• ${i.qty}x ${i.name} = Rp ${i.subtotal.toLocaleString('id-ID')}`)
        .join('\n');

      const message = [
        '⚠️ <b>PERMOHONAN VOID TRANSAKSI</b>',
        `🧾 Invoice: <code>${payload.invoiceNumber}</code>`,
        `👤 Kasir: ${payload.cashierName}`,
        `💰 Nominal: Rp ${payload.totalAmount.toLocaleString('id-ID')}`,
        `❗ Alasan: <i>${payload.reason}</i>`,
        '---------------------------------',
        itemsList,
        '---------------------------------',
        `🔑 <b>Kode OTP Kasir:</b> <code>${payload.plainOtpCode}</code>`,
        `🔗 <a href="${payload.oneClickApproveUrl}">Klik untuk Setujui Langsung (1-Click)</a>`,
        '<i>Berlaku selama 5 menit.</i>',
      ].join('\n');

      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.ownerChatId,
          text: message,
          parse_mode: 'HTML',
        }),
      });
    } catch (err) {
      console.error('Failed to send Telegram void approval notification:', err);
    }
  }
}

export class MockNotificationProvider implements INotificationProvider {
  public sentAuditReceipts: OwnerAuditReceiptPayload[] = [];
  public sentVoidApprovals: VoidApprovalNotificationPayload[] = [];

  async sendOwnerAuditReceipt(receipt: OwnerAuditReceiptPayload): Promise<void> {
    this.sentAuditReceipts.push(receipt);
  }

  async sendVoidApprovalRequest(payload: VoidApprovalNotificationPayload): Promise<void> {
    this.sentVoidApprovals.push(payload);
  }

  clear() {
    this.sentAuditReceipts = [];
    this.sentVoidApprovals = [];
  }
}

export function getNotificationProvider(env: Env): INotificationProvider {
  if (env.NOTIFICATION_PROVIDER_INSTANCE) {
    return env.NOTIFICATION_PROVIDER_INSTANCE;
  }

  if (
    env.NOTIFICATION_PROVIDER !== 'mock' &&
    env.TELEGRAM_BOT_TOKEN &&
    env.TELEGRAM_OWNER_CHAT_ID
  ) {
    return new TelegramNotificationProvider(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_OWNER_CHAT_ID);
  }

  return new MockNotificationProvider();
}
