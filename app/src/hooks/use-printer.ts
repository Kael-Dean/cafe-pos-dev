'use client';

import { useCallback } from 'react';

declare global {
  interface Window { epson: any; }
}

const PRINTER_IP = '192.168.192.168';
const PRINTER_PORT = 8008;
const STORE_NAME = 'ร้านตะวันอ้อมข้าว';
const LINE_WIDTH = 32;

const PAY_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  card: 'บัตรเครดิต',
  qr: 'QR PromptPay',
  line: 'LINE Pay',
};

export interface PrintReceiptArgs {
  orderNumber: string;
  items: Array<{ name: string; qty: number; unitPrice: number; mods?: string[]; }>;
  subtotal: number;
  total: number;
  paymentMethod: string;
}

function leftRight(left: string, right: string, width = LINE_WIDTH): string {
  const maxLeft = width - right.length - 1;
  const l = left.substring(0, maxLeft);
  return l + ' '.repeat(Math.max(1, width - l.length - right.length)) + right;
}

export function usePrinter() {
  const printReceipt = useCallback((args: PrintReceiptArgs): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.epson) {
        reject(new Error('ePOS SDK not loaded'));
        return;
      }

      const epos = new window.epson.ePOSDevice();

      epos.connect(PRINTER_IP, PRINTER_PORT, (status: string) => {
        if (status !== 'OK' && status !== 'SSL_CONNECT_OK') {
          epos.disconnect();
          reject(new Error(`เชื่อมต่อ printer ไม่ได้: ${status}`));
          return;
        }

        epos.createDevice('local_printer', epos.DEVICE_TYPE_PRINTER, { crypto: false, buffer: false }, (p: any, code: string) => {
          if (code !== 'OK') {
            epos.disconnect();
            reject(new Error(`เปิด device ไม่ได้: ${code}`));
            return;
          }

          const fmt = (n: number) => n.toFixed(2);
          const dash = '-'.repeat(LINE_WIDTH);

          p.addTextAlign(p.ALIGN_CENTER);
          p.addTextSize(2, 1);
          p.addText(STORE_NAME + '\n');
          p.addTextSize(1, 1);
          p.addText('ออเดอร์ #' + args.orderNumber + '\n');
          p.addText(new Date().toLocaleString('th-TH') + '\n');
          p.addText(dash + '\n');

          p.addTextAlign(p.ALIGN_LEFT);
          for (const item of args.items) {
            const lineTotal = item.qty * item.unitPrice;
            p.addText(leftRight(item.name, fmt(lineTotal)) + '\n');
            p.addText(`  ${item.qty} x ${fmt(item.unitPrice)}\n`);
            for (const mod of (item.mods ?? [])) {
              p.addText(`  + ${mod}\n`);
            }
          }

          p.addText(dash + '\n');
          p.addText(leftRight('รวม', fmt(args.subtotal)) + '\n');
          p.addTextSize(1, 2);
          p.addText(leftRight('รวมทั้งสิ้น', fmt(args.total)) + '\n');
          p.addTextSize(1, 1);
          p.addText('ชำระ: ' + (PAY_LABEL[args.paymentMethod] ?? args.paymentMethod) + '\n');
          p.addText(dash + '\n');
          p.addTextAlign(p.ALIGN_CENTER);
          p.addText('ขอบคุณที่ใช้บริการ\n');
          p.addFeedLine(3);
          p.addCut(p.CUT_FEED);

          p.onreceive = () => {
            epos.deleteDevice(p, () => epos.disconnect());
            resolve();
          };
          p.onerror = (err: any) => {
            epos.deleteDevice(p, () => epos.disconnect());
            reject(err);
          };

          p.send();
        });
      });
    });
  }, []);

  return { printReceipt };
}
