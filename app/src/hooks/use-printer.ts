'use client';

import { useCallback } from 'react';
import { DEFAULT_STORE, type StoreInfo } from '@/components/screens/receipt-modal';
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
  memberName?: string;
  /** Optional store-header override (only defined fields win); defaults to DEFAULT_STORE. */
  store?: Partial<StoreInfo>;
}

// Receipt running number, mirrors the on-screen receipt modal.
function makeInvoiceNo(orderNumber: string): string {
  const now = new Date();
  const buddhistYear = now.getFullYear() + 543;
  return `IV${buddhistYear}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${orderNumber.padStart(4, '0')}`;
}

export function usePrinter() {
  const printReceipt = useCallback(async (args: PrintReceiptArgs): Promise<void> => {
    // Store info — single source of truth shared with the on-screen receipt.
    // `args.store` may override individual fields (e.g. Hardware test print); empty/undefined
    // fields fall back to DEFAULT_STORE so we never print a blank header.
    const o = args.store;
    const store: StoreInfo = {
      name:    o?.name?.trim()    || DEFAULT_STORE.name,
      address: o?.address?.trim() || DEFAULT_STORE.address,
      taxId:   o?.taxId?.trim()   || DEFAULT_STORE.taxId,
      branch:  o?.branch?.trim()  || DEFAULT_STORE.branch,
      phone:   o?.phone?.trim()   || DEFAULT_STORE.phone,
    };
    const body: Record<string, unknown> = {
      storeName:    store.name,
      storeAddress: store.address,
      storeTaxId:   store.taxId,
      storeBranch:  store.branch,
      storePhone:   store.phone,
      invoiceNo:    makeInvoiceNo(args.orderNumber),
      orderNumber:  args.orderNumber,
      items:        args.items,
      subtotal:     args.subtotal,
      total:        args.total,
      paymentLabel: PAY_LABEL[args.paymentMethod] ?? args.paymentMethod,
    };

    if (args.cashGiven != null) body.cashGiven = args.cashGiven;
    if (args.memberName) body.memberName = args.memberName;

    await sendPrintJob(body);
  }, []);

  return { printReceipt };
}
