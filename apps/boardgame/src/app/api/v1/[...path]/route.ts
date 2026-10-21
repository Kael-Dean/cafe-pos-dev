// Cookie BFF proxy to RAILWAY_API_URL — implementation in @pos/core.
// Segment config must stay literal in this file (Next reads it statically).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export { GET, HEAD, POST, PUT, PATCH, DELETE } from '@pos/core/lib/server/routes/bff-proxy';
