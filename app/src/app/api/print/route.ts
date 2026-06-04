import { NextRequest, NextResponse } from 'next/server';
import net from 'net';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'printer-config.json');

const BRIDGE_URL   = process.env.PRINT_BRIDGE_URL?.replace(/\/$/, '');
const BRIDGE_TOKEN = process.env.PRINT_BRIDGE_TOKEN;
const bridgeHeaders = (extra: Record<string, string> = {}) => ({
  ...extra,
  ...(BRIDGE_TOKEN ? { 'x-bridge-token': BRIDGE_TOKEN } : {}),
});

function loadConfig(): {
  ip: string; port: number;
  storeName: string; storeAddress?: string; storeTaxId?: string; storeBranch?: string; storePhone?: string;
} {
  const base = (() => {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
  })();
  return {
    storeName:    base.storeName    ?? 'ร้านตะวันอ้อมข้าว',
    storeAddress: base.storeAddress,
    storeTaxId:   base.storeTaxId,
    storeBranch:  base.storeBranch,
    storePhone:   base.storePhone,
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
      const res  = await fetch(`${BRIDGE_URL}/status`, { headers: bridgeHeaders(), signal: AbortSignal.timeout(4000) });
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

const W = 48; // 80mm thermal @ Font A = 48 columns; fills the paper edge-to-edge
const dash = '-'.repeat(W);

// Thai combining marks (above/below vowels + tone marks) stack on the base glyph
// and advance the print head by zero, so they must not count toward column width.
const isZeroWidthThai = (cp: number) =>
  cp === 0x0e31 || (cp >= 0x0e34 && cp <= 0x0e3a) || (cp >= 0x0e47 && cp <= 0x0e4e);
const visualWidth = (s: string) => {
  let w = 0;
  for (const ch of s) if (!isZeroWidthThai(ch.charCodeAt(0))) w++;
  return w;
};

const leftRight = (l: string, r: string) => {
  const rW = visualWidth(r);
  let left = l;
  while (visualWidth(left) > W - rW - 1) left = left.slice(0, -1);
  const pad = Math.max(1, W - visualWidth(left) - rW);
  return left + ' '.repeat(pad) + r;
};
const fmt2 = (n: number) => n.toFixed(2);

interface PrintBody {
  storeName: string;
  storeAddress?: string;
  storeTaxId?: string;
  storeBranch?: string;
  storePhone?: string;
  invoiceNo?: string;
  orderNumber: string;
  items: { name: string; qty: number; unitPrice: number; mods?: string[] }[];
  subtotal: number;
  total: number;
  paymentLabel: string;
  cashGiven?: number;
}

function buildESCPOS(data: PrintBody): Buffer {
  const parts: Buffer[] = [
    cmd(ESC, 0x40),        // init
    cmd(ESC, 0x74, 0x15),  // TIS-620
    cmd(ESC, 0x61, 0x01),  // center
    cmd(GS,  0x21, 0x10),  // double-height
    line(data.storeName),
    cmd(GS,  0x21, 0x00),
    line('ใบเสร็จรับเงิน'),
    line('ต้นฉบับ'),
    line(dash),
    cmd(ESC, 0x61, 0x00),  // left
  ];

  // Store info
  if (data.storeAddress) parts.push(line(data.storeAddress));
  if (data.storeTaxId)   parts.push(line(`ผู้เสียภาษี: ${data.storeTaxId}`));
  if (data.storeBranch)  parts.push(line(data.storeBranch));
  if (data.storePhone)   parts.push(line(`โทร. ${data.storePhone}`));

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
  parts.push(cmd(ESC, 0x45, 0x01)); // bold on
  parts.push(line(leftRight('รวมทั้งสิ้น (บาท)', fmt2(data.total))));
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
        headers: bridgeHeaders({ 'Content-Type': 'application/json' }),
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

  const { ip, port, storeName, storeAddress, storeTaxId, storeBranch, storePhone } = loadConfig();
  try {
    const receipt = buildESCPOS({
      storeName, storeAddress, storeTaxId, storeBranch, storePhone,
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
