import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'printer-config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { storeName: 'ร้านของฉัน', ip: '192.168.1.129', port: 9100 };
  }
}

export async function GET() {
  return NextResponse.json(readConfig());
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const current = readConfig();
    const updated = {
      ...current,
      ...(body.ip        !== undefined ? { ip: body.ip.trim() }           : {}),
      ...(body.port      !== undefined ? { port: Number(body.port) }      : {}),
      ...(body.storeName !== undefined ? { storeName: body.storeName.trim() } : {}),
    };
    if (!updated.ip || typeof updated.ip !== 'string') {
      return NextResponse.json({ ok: false, error: 'IP ไม่ถูกต้อง' }, { status: 400 });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf8');
    return NextResponse.json({ ok: true, ...updated });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
