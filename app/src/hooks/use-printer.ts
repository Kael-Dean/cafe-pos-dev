'use client';

import { useCallback } from 'react';
import { DEFAULT_STORE } from '@/components/screens/receipt-modal';
import { sendPrintJob } from '@/lib/printer-bridge';

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
  cashGiven?: number;
}

// Receipt running number, mirrors the on-screen receipt modal.
function makeInvoiceNo(orderNumber: string): string {
  const now = new Date();
  const buddhistYear = now.getFullYear() + 543;
  return `IV${buddhistYear}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${orderNumber.padStart(4, '0')}`;
}

export function usePrinter() {
  const printReceipt = useCallback(async (args: PrintReceiptArgs): Promise<void> => {
    const body: Record<string, unknown> = {
      // Store info — single source of truth shared with the on-screen receipt.
      storeName:    DEFAULT_STORE.name,
      storeAddress: DEFAULT_STORE.address,
      storeTaxId:   DEFAULT_STORE.taxId,
      storeBranch:  DEFAULT_STORE.branch,
      storePhone:   DEFAULT_STORE.phone,
      invoiceNo:    makeInvoiceNo(args.orderNumber),
      orderNumber:  args.orderNumber,
      items:        args.items,
      subtotal:     args.subtotal,
      total:        args.total,
      paymentLabel: PAY_LABEL[args.paymentMethod] ?? args.paymentMethod,
    };

    if (args.cashGiven != null) body.cashGiven = args.cashGiven;

    await sendPrintJob(body);
  }, []);

  return { printReceipt };
}
