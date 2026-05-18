import { NextResponse } from 'next/server';
import net from 'net';
import fs from 'fs';
import path from 'path';

const PRINTER_PORT = 9100;
const SCAN_TIMEOUT = 400;

function probeHost(ip: string): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(SCAN_TIMEOUT);
    socket.connect(PRINTER_PORT, ip, () => { socket.destroy(); resolve(ip); });
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
    socket.on('error',   () => { socket.destroy(); resolve(null); });
  });
}

function guessSubnet(): string {
  // Read saved config IP to guess the right subnet
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'printer-config.json'), 'utf8'));
    const parts = (cfg.ip as string).split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}`;
  } catch {}
  return '192.168.1';
}

export async function GET() {
  const subnet = guessSubnet();
  const candidates = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);

  // Scan in batches of 30 to avoid overwhelming the network stack
  const found: string[] = [];
  for (let i = 0; i < candidates.length; i += 30) {
    const batch = candidates.slice(i, i + 30);
    const results = await Promise.all(batch.map(probeHost));
    found.push(...results.filter((r): r is string => r !== null));
  }

  return NextResponse.json({ found, subnet });
}
