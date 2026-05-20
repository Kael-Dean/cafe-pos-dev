import { NextRequest, NextResponse } from 'next/server';
import { db } from './db';

export interface AuthContext {
  userId: string;
  storeId: string;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const [, payload] = token.split('.');
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export async function getAuthContext(req: NextRequest): Promise<AuthContext | null> {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const payload = decodeJwtPayload(token);
  const sub = payload.sub as string | undefined;
  if (!sub) return null;

  const user = await db.user.findUnique({
    where: { id: sub },
    select: { id: true, storeId: true },
  });

  if (!user?.storeId) return null;
  return { userId: user.id, storeId: user.storeId };
}

export function unauthorized() {
  return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
}

export function notFound(entity = 'Resource') {
  return NextResponse.json({ error: { message: `${entity} not found` } }, { status: 404 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: { message } }, { status: 400 });
}
