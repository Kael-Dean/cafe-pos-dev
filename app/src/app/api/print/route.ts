import { NextRequest, NextResponse } from 'next/server';
import net from 'net';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'printer-config.json');

const BRIDGE_URL = process.env.PRINT_BRIDGE_URL?.replace(/\/$/, '');

function loadConfig(): {
  ip: string; port: number;
  storeName: string; storeAddress?: string; storeTaxId?: string; storeBranch?: string;
} {
  const base = (() => {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
  })();
  return {
    storeName:    base.storeName    ?? 'ร้านของฉัน',
    storeAddress: base.storeAddress,
    storeTaxId:   base.storeTaxId,
    storeBranch:  base.storeBranch,
    ip:   process.env.PRINTER_IP   ?? base.ip   ?? '192.168.1.129',
    port: Number(process.env.PRINTER_PORT ?? base.port ?? 9100),
  };
}

function checkPrinter(ip: string, port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.connect(port, ip, () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error',   () => { socket.destroy(); resolve(false); });
  });
}

export async function GET() {
  if (BRIDGE_URL) {
    try {
      const res  = await fetch(`${BRIDGE_URL}/status`, { signal: AbortSignal.timeout(4000) });
      const data = await res.json();
      return NextResponse.json({ ok: true, printer: data.printer ?? false, ip: data.ip ?? '—', bridge: BRIDGE_URL });
    } catch {
      return NextResponse.json({ ok: false, printer: false, bridge: BRIDGE_URL });
    }
  }
  const { ip, port } = loadConfig();
  const online = await checkPrinter(ip, port);
  return NextResponse.json({ ok: true, printer: online, ip });
}

// Thai Unicode (U+0E00–U+0E7F) → TIS-620 (0xA0–0xFF)
function toTIS620(text: string): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.charCodeAt(0);
    if (cp >= 0x0e00 && cp <= 0x0e7f) {
      bytes.push(cp - 0x0e00 + 0xa0);
    } else if (cp < 0x80) {
      bytes.push(cp);
    } else {
      bytes.push(0x3f); // '?'
    }
  }
  return Buffer.from(bytes);
}

const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;

const cmd  = (...b: number[]) => Buffer.from(b);
const line = (s: string)      => Buffer.concat([toTIS620(s), Buffer.from([LF])]);

const W = 42;
const dash = '-'.repeat(W);

const leftRight = (l: string, r: string) => {
  const left = l.substring(0, W - r.length - 1);
  return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r;
};
const center = (s: string) => {
  const pad = Math.max(0, Math.floor((W - s.length) / 2));
  return ' '.repeat(pad) + s;
};

const fmt2 = (n: number) => n.toFixed(2);

interface PrintBody {
  storeName: string;
  storeAddress?: string;
  storeTaxId?: string;
  storeBranch?: string;
  invoiceNo?: string;
  orderNumber: string;
  buyerName?: string;
  buyerAddress?: string;
  buyerTaxId?: string;
  buyerBranch?: string;
  items: { name: string; qty: number; unitPrice: number; mods?: string[] }[];
  subtotal: number;
  vat?: number;
  total: number;
  paymentLabel: string;
  cashGiven?: number;
}

function buildESCPOS(data: PrintBody): Buffer {
  const hasTaxInfo = !!(data.buyerName || data.invoiceNo || data.storeTaxId);
  const preVat  = data.subtotal;
  const vatAmt  = data.vat ?? Math.round(data.subtotal * 0.07);

  const parts: Buffer[] = [
    cmd(ESC, 0x40),        // init
    cmd(ESC, 0x74, 0x15),  // TIS-620
    cmd(ESC, 0x61, 0x01),  // center
    cmd(GS,  0x21, 0x10),  // double-height
    line(data.storeName),
    cmd(GS,  0x21, 0x00),
    line(hasTaxInfo ? 'ใบเสร็จรับเงิน/ใบกำกับภาษี' : 'ใบเสร็จรับเงิน'),
    line(center('ต้นฉบับ')),
    line(dash),
    cmd(ESC, 0x61, 0x00),  // left
  ];

  // Store info
  if (data.storeAddress) parts.push(line(data.storeAddress));
  if (data.storeTaxId)   parts.push(line(`ผู้เสียภาษี: ${data.storeTaxId}`));
  if (data.storeBranch)  parts.push(line(data.storeBranch));

  // Buyer info
  if (data.buyerName) {
    parts.push(line(dash));
    parts.push(line('ผู้ซื้อ:'));
    parts.push(line(data.buyerName));
    if (data.buyerAddress) parts.push(line(data.buyerAddress));
    if (data.buyerTaxId)   parts.push(line(`ผู้เสียภาษี: ${data.buyerTaxId}`));
    if (data.buyerBranch)  parts.push(line(data.buyerBranch));
  }

  parts.push(line(dash));
  if (data.invoiceNo) parts.push(line(`เลขที่: ${data.invoiceNo}`));
  parts.push(line(`ออเดอร์: #${data.orderNumber}`));
  parts.push(line(new Date().toLocaleString('th-TH')));
  parts.push(line(dash));

  // Items header
  parts.push(line(leftRight('รายการ', 'จำนวนเงิน')));
  parts.push(line(dash));

  // Items
  for (const item of data.items) {
    parts.push(line(leftRight(item.name, fmt2(item.qty * item.unitPrice))));
    parts.push(line(`  ${item.qty} x ${fmt2(item.unitPrice)}`));
    for (const mod of item.mods ?? []) parts.push(line(`  + ${mod}`));
  }

  // Summary
  parts.push(line(dash));
  parts.push(line(leftRight('มูลค่าก่อนภาษี', fmt2(preVat))));
  parts.push(line(leftRight('ภาษีมูลค่าเพิ่ม 7%', fmt2(vatAmt))));
  parts.push(line(dash));
  parts.push(cmd(ESC, 0x45, 0x01)); // bold on
  parts.push(line(leftRight('รวมทั้งสิ้น', `${fmt2(data.total)} B`)));
  parts.push(cmd(ESC, 0x45, 0x00)); // bold off
  parts.push(line(`ชำระ: ${data.paymentLabel}`));

  if (data.cashGiven != null) {
    parts.push(line(leftRight('รับเงิน', fmt2(data.cashGiven))));
    parts.push(line(leftRight('เงินทอน', fmt2(data.cashGiven - data.total))));
  }

  // Footer
  parts.push(line(dash));
  parts.push(cmd(ESC, 0x61, 0x01)); // center
  parts.push(line('ลงชื่อผู้รับเงิน ......................'));
  parts.push(line(''));
  parts.push(line('ขอบคุณที่ใช้บริการ'));
  parts.push(Buffer.from([LF, LF, LF]));
  parts.push(cmd(GS, 0x56, 0x42, 0x03)); // cut

  return Buffer.concat(parts);
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (BRIDGE_URL) {
    try {
      const res = await fetch(`${BRIDGE_URL}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      return NextResponse.json(data, { status: res.ok ? 200 : 500 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'bridge error';
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  const { ip, port, storeName, storeAddress, storeTaxId, storeBranch } = loadConfig();
  try {
    const receipt = buildESCPOS({
      storeName, storeAddress, storeTaxId, storeBranch,
      ...body,
    });

    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(5000);
      socket.connect(port, ip, () => {
        socket.write(receipt, (err) => {
          socket.destroy();
          err ? reject(err) : resolve();
        });
      });
      socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
      socket.on('error',   reject);
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'print error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
