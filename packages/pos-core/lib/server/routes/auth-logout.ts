import type { NextRequest } from 'next/server';
import { handleLogout } from '@pos/core/lib/server/session';


/** POST → best-effort backend logout, then clears every session cookie. */
export function POST(request: NextRequest) {
  return handleLogout(request);
}
