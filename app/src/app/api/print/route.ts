import { NextRequest, NextResponse } from 'next/server';
import net from 'net';

const PRINTER_IP = '192.168.1.129';
const PRINTER_PORT = 9100;

function checkPrinter(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.connect(PRINTER_PORT, PRINTER_IP, () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error',   () => { socket.destroy(); resolve(false); });
  });
}

export async function GET() {
  const online = await checkPrinter();
  return NextResponse.json({ ok: true, printer: online, ip: PRINTER_IP });
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

const cmd   = (...b: number[]) => Buffer.from(b);
const line  = (s: string)      => Buffer.concat([toTIS620(s), Buffer.from([LF])]);

function buildESCPOS(data: {
  storeName: string;
  orderNumber: string;
  items: { name: string; qty: number; unitPrice: number; mods?: string[] }[];
  subtotal: number;
  total: number;
  paymentLabel: string;
}): Buffer {
  const W = 32;
  const dash = '-'.repeat(W);

  const fmt = (n: number) => n.toFixed(2);
  const leftRight = (l: string, r: string) => {
    const left = l.substring(0, W - r.length - 1);
    return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r;
  };

  const parts: Buffer[] = [
    cmd(ESC, 0x40),        // ESC @ initialize
    cmd(ESC, 0x74, 0x15),  // Thai Code 2 (TIS-620)
    cmd(ESC, 0x61, 0x01),  // center
    cmd(GS,  0x21, 0x10),  // double height
    line(data.storeName),
    cmd(GS,  0x21, 0x00),  // normal
    line(`ออเดอร์ #${data.orderNumber}`),
    line(new Date().toLocaleString('th-TH')),
    line(dash),
    cmd(ESC, 0x61, 0x00),  // left
  ];

  for (const item of data.items) {
    parts.push(line(leftRight(item.name, fmt(item.qty * item.unitPrice))));
    parts.push(line(`  ${item.qty} x ${fmt(item.unitPrice)}`));
    for (const mod of item.mods ?? []) parts.push(line(`  + ${mod}`));
  }

  parts.push(
    line(dash),
    line(leftRight('รวม', fmt(data.subtotal))),
    cmd(ESC, 0x45, 0x01),  // bold on
    line(leftRight('รวมทั้งสิ้น', fmt(data.total))),
    cmd(ESC, 0x45, 0x00),  // bold off
    line(`ชำระ: ${data.paymentLabel}`),
    line(dash),
    cmd(ESC, 0x61, 0x01),  // center
    line('ขอบคุณที่ใช้บริการ'),
    Buffer.from([LF, LF, LF]),
    cmd(GS,  0x56, 0x42, 0x03),  // full cut
  );

  return Buffer.concat(parts);
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const receipt = buildESCPOS(data);

    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(5000);
      socket.connect(PRINTER_PORT, PRINTER_IP, () => {
        socket.write(receipt, (err) => {
          socket.destroy();
          err ? reject(err) : resolve();
        });
      });
      socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
      socket.on('error',   reject);
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
