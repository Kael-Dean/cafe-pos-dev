import { NextRequest, NextResponse } from 'next/server';
import net from 'net';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'printer-config.json');

// If PRINT_BRIDGE_URL is set (e.g. Cloudflare Tunnel), forward requests there instead of direct TCP
const BRIDGE_URL = process.env.PRINT_BRIDGE_URL?.replace(/\/$/, '');

function loadConfig(): { ip: string; port: number; storeName: string } {
  const base = (() => {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
  })();
  return {
    storeName: base.storeName ?? 'ร้านของฉัน',
    ip:   process.env.PRINTER_IP ?? base.ip  ?? '192.168.1.129',
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
      bytes.push(0x3f);
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
    cmd(ESC, 0x40),
    cmd(ESC, 0x74, 0x15),
    cmd(ESC, 0x61, 0x01),
    cmd(GS,  0x21, 0x10),
    line(data.storeName),
    cmd(GS,  0x21, 0x00),
    line(`ออเดอร์ #${data.orderNumber}`),
    line(new Date().toLocaleString('th-TH')),
    line(dash),
    cmd(ESC, 0x61, 0x00),
  ];

  for (const item of data.items) {
    parts.push(line(leftRight(item.name, fmt(item.qty * item.unitPrice))));
    parts.push(line(`  ${item.qty} x ${fmt(item.unitPrice)}`));
    for (const mod of item.mods ?? []) parts.push(line(`  + ${mod}`));
  }

  parts.push(
    line(dash),
    line(leftRight('รวม', fmt(data.subtotal))),
    cmd(ESC, 0x45, 0x01),
    line(leftRight('รวมทั้งสิ้น', fmt(data.total))),
    cmd(ESC, 0x45, 0x00),
    line(`ชำระ: ${data.paymentLabel}`),
    line(dash),
    cmd(ESC, 0x61, 0x01),
    line('ขอบคุณที่ใช้บริการ'),
    Buffer.from([LF, LF, LF]),
    cmd(GS,  0x56, 0x42, 0x03),
  );

  return Buffer.concat(parts);
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Forward to Cloudflare Tunnel bridge if configured
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
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
  }

  const { ip, port, storeName } = loadConfig();
  try {
    const receipt = buildESCPOS({ ...body, storeName });

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
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
