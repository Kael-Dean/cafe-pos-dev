import type { NextRequest } from 'next/server';
import { handleRefresh } from '@pos/core/lib/server/session';


/** POST (no body) → exchanges the refresh cookie for a new access cookie. */
export function POST(request: NextRequest) {
  return handleRefresh(request);
}
