'use client';

import { useCallback } from 'react';
import type { BuyerInfo } from '@/components/screens/receipt-modal';

const PAY_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  card: 'บัตรเครดิต',
  qr: 'QR PromptPay',
  line: 'LINE Pay',
};

export interface PrintReceiptArgs {
  orderNumber: string;
  invoiceNo?: string;
  items: Array<{ name: string; qty: number; unitPrice: number; mods?: string[] }>;
  subtotal: number;
  vat?: number;
  total: number;
  paymentMethod: string;
  cashGiven?: number;
  buyerInfo?: BuyerInfo;
}

export function usePrinter() {
  const printReceipt = useCallback(async (args: PrintReceiptArgs): Promise<void> => {
    const body: Record<string, unknown> = {
      orderNumber:  args.orderNumber,
      items:        args.items,
      subtotal:     args.subtotal,
      vat:          args.vat,
      total:        args.total,
      paymentLabel: PAY_LABEL[args.paymentMethod] ?? args.paymentMethod,
    };

    if (args.invoiceNo)         body.invoiceNo    = args.invoiceNo;
    if (args.cashGiven != null) body.cashGiven    = args.cashGiven;
    if (args.buyerInfo?.name) {
      body.buyerName    = args.buyerInfo.name;
      body.buyerAddress = args.buyerInfo.address;
      body.buyerTaxId   = args.buyerInfo.taxId;
      body.buyerBranch  = args.buyerInfo.branch;
    }

    const res = await fetch('/api/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? 'print failed');
    }
  }, []);

  return { printReceipt };
}
