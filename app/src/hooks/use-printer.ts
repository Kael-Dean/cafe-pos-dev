'use client';

import { useCallback } from 'react';

const PAY_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  card: 'บัตรเครดิต',
  qr: 'QR PromptPay',
  line: 'LINE Pay',
};

export const DEFAULT_BRIDGE = 'http://localhost:3456';

export function getBridgeUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_BRIDGE;
  return localStorage.getItem('print_bridge_url') ?? DEFAULT_BRIDGE;
}

export interface PrintReceiptArgs {
  orderNumber: string;
  items: Array<{ name: string; qty: number; unitPrice: number; mods?: string[] }>;
  subtotal: number;
  total: number;
  paymentMethod: string;
}

export function usePrinter() {
  const printReceipt = useCallback(async (args: PrintReceiptArgs): Promise<void> => {
    const bridge = getBridgeUrl();
    const res = await fetch(`${bridge}/print`, {
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
