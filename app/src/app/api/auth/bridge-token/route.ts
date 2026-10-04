import { NextResponse, type NextRequest } from 'next/server';
import { hasValidSession, jsonError } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET → `{ token }` for the local print bridge (audit M3). The bridge requires
 * this shop-wide token in `x-bridge-token`; only a logged-in user (access
 * cookie accepted by the backend) can read it. `token: null` when the server
 * has no BRIDGE_TOKEN configured, so the app falls back to token-less calls
 * that only an un-upgraded bridge still accepts.
 */
export async function GET(request: NextRequest) {
  if (!(await hasValidSession(request))) {
    return jsonError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');
  }
  const token = process.env.BRIDGE_TOKEN?.trim() || null;
  return NextResponse.json({ token }, { headers: { 'Cache-Control': 'no-store, private' } });
}
