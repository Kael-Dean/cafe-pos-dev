'use client';

import { useCallback } from 'react';

const PAY_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  card: 'บัตรเครดิต',
  qr: 'QR PromptPay',
  line: 'LINE Pay',
};

export interface PrintReceiptArgs {
  orderNumber: string;
  items: Array<{ name: string; qty: number; unitPrice: number; mods?: string[] }>;
  subtotal: number;
  total: number;
  paymentMethod: string;
}

export function usePrinter() {
  const printReceipt = useCallback(async (args: PrintReceiptArgs): Promise<void> => {
    const res = await fetch('/api/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeName:    'ร้านตะวันอ้อมข้าว',
        orderNumber:  args.orderNumber,
        items:        args.items,
        subtotal:     args.subtotal,
        total:        args.total,
        paymentLabel: PAY_LABEL[args.paymentMethod] ?? args.paymentMethod,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? 'print failed');
    }
  }, []);

  return { printReceipt };
}
