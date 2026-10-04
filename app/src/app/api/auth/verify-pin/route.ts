import type { NextRequest } from 'next/server';
import { handleVerifyPin } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST {store_slug, pin} → `{ ok, user: {id, name, role, store_id}, same_store }`.
 * Second-person PIN check (manager approval). Never changes the caller's
 * session cookies; tokens minted for the check are discarded server-side.
 */
export function POST(request: NextRequest) {
  return handleVerifyPin(request);
}
