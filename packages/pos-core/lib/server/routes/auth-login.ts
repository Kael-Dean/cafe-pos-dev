import type { NextRequest } from 'next/server';
import { handleLogin } from '@pos/core/lib/server/session';


/** POST {store_slug, pin} → sets HttpOnly session cookies. Never returns tokens. */
export function POST(request: NextRequest) {
  return handleLogin(request);
}
