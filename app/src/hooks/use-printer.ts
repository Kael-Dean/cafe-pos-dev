'use client';

import { useCallback } from 'react';
import { DEFAULT_STORE, type StoreInfo } from '@/components/screens/receipt-modal';
import { sendPrintJob } from '@/lib/printer-bridge';
import { makeInvoiceNo } from '@/lib/receipt-number';
import { buildReceiptLines } from '@/lib/receipt-lines';

const PAY_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  card: 'บัตรเครดิต',
  qr: 'QR PromptPay',
  line: 'LINE Pay',
};

export interface PrintReceiptArgs {
  orderNumber: string;
  /** Backend-generated receipt number, printed verbatim. Falls back to a
   *  client-computed IV string only when absent (pre-backend orders). */
  receiptNo?: string;
  items: Array<{ name: string; qty: number; unitPrice: number; mods?: string[] }>;
  subtotal: number;
  total: number;
  paymentMethod: string;
  cashGiven?: number;
  memberName?: string;
  salesName?: string;
  /** Original order date/time — used on reprinted copies so they show when the
   *  order actually happened (not "now"). Defaults to the current time. */
  issuedAt?: Date;
  /** Marks the printout as a duplicate ("สำเนา") instead of the original. */
  copy?: boolean;
  /** Optional store-header override (only defined fields win); defaults to DEFAULT_STORE. */
  store?: Partial<StoreInfo>;
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
    const invoiceNo    = args.receiptNo ?? makeInvoiceNo(args.orderNumber, args.issuedAt);
    const paymentLabel = PAY_LABEL[args.paymentMethod] ?? args.paymentMethod;
    const dateStr      = (args.issuedAt ?? new Date()).toLocaleString('th-TH');

    // The full receipt layout is built HERE and shipped as a neutral line-list.
    // The bridge just renders it (ESC/POS for LAN, raster for USB) — so future
    // receipt changes are an app-only deploy, never a bridge reinstall.
    const lines = buildReceiptLines({
      storeName:    store.name,
      storeAddress: store.address,
      storeTaxId:   store.taxId,
      storeBranch:  store.branch,
      storePhone:   store.phone,
      invoiceNo,
      orderNumber:  args.orderNumber,
      dateStr,
      copy:         args.copy,
      memberName:   args.memberName,
      salesName:    args.salesName,
      items:        args.items,
      total:        args.total,
      paymentLabel,
      cashGiven:    args.cashGiven,
    });

    const body: Record<string, unknown> = {
      // Neutral layout — the bridge prefers this when present.
      lines,
      // Flat fields kept for backward-compat: an older bridge that doesn't yet
      // understand `lines` falls back to building the receipt from these.
      storeName:    store.name,
      storeAddress: store.address,
      storeTaxId:   store.taxId,
      storeBranch:  store.branch,
      storePhone:   store.phone,
      invoiceNo,
      orderNumber:  args.orderNumber,
      items:        args.items,
      subtotal:     args.subtotal,
      total:        args.total,
      paymentLabel,
    };

    if (args.cashGiven != null) body.cashGiven = args.cashGiven;
    if (args.memberName) body.memberName = args.memberName;
    if (args.salesName) body.salesName = args.salesName;
    if (args.issuedAt) body.issuedAt = args.issuedAt.toISOString();
    if (args.copy) body.copy = true;

    await sendPrintJob(body);
  }, []);

  return { printReceipt };
}
