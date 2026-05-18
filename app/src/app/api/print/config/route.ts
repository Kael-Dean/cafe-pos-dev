import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'printer-config.json');

export async function GET() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return NextResponse.json(config);
  } catch {
    return NextResponse.json({ ip: '192.168.1.129', port: 9100 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { ip, port } = await req.json();
    if (!ip || typeof ip !== 'string') {
      return NextResponse.json({ ok: false, error: 'IP ไม่ถูกต้อง' }, { status: 400 });
    }
    const config = { ip: ip.trim(), port: port ?? 9100 };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    return NextResponse.json({ ok: true, ...config });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
