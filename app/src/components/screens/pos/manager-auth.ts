/**
 * Manager approval for a manual discount above the threshold.
 *
 * Uses the BFF route `POST /api/auth/verify-pin` ({store_slug, pin}): the server
 * verifies the PIN against the backend, returns the verified user (id, name,
 * role, store) plus `same_store` (same branch as the signed-in cashier), and
 * never touches the cashier's session cookies. The role and same-store checks
 * below only interpret that server answer — nothing is decided from the PIN
 * client-side.
 *
 * BACKEND GAP (reported): the approval is not recorded on the order until
 * POST /orders accepts a manual discount + approver field.
 */

/** localStorage keys the login screen may persist the store slug under (first hit wins). */
const STORE_SLUG_KEYS = ['kafe:store-slug', 'pos:store-slug'];

export function readStoreSlug(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    for (const k of STORE_SLUG_KEYS) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) return v.trim();
    }
  } catch { /* storage unavailable */ }
  return null;
}

export type ManagerCheck =
  | { ok: true; approver: { id: string; name: string } }
  | { ok: false; reason: 'wrong-pin' | 'not-manager' | 'other-store' | 'rate-limited' | 'network' | 'no-store' | 'signed-out'; retryAfter?: number };

interface VerifyPinResponse {
  ok?: boolean;
  user?: { id?: string; name?: string; role?: string; store_id?: string | null };
  same_store?: boolean;
}

export async function verifyManagerPin(pin: string, storeSlug: string | null): Promise<ManagerCheck> {
  if (!storeSlug) return { ok: false, reason: 'no-store' };
  try {
    const res = await fetch('/api/auth/verify-pin', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ store_slug: storeSlug, pin }),
    });
    if (res.status === 429) {
      const ra = Number(res.headers.get('Retry-After'));
      return { ok: false, reason: 'rate-limited', retryAfter: Number.isFinite(ra) && ra > 0 ? ra : 60 };
    }
    if (res.status === 401) {
      // 401 is ambiguous: wrong PIN (upstream) or the cashier's own session expired.
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      return { ok: false, reason: body?.error?.code === 'UNAUTHENTICATED' ? 'signed-out' : 'wrong-pin' };
    }
    if ([403, 404, 422].includes(res.status)) return { ok: false, reason: 'wrong-pin' };
    if (!res.ok) return { ok: false, reason: 'network' };
    const body = (await res.json()) as VerifyPinResponse;
    const user = body.user;
    if (!body.ok || !user?.id) return { ok: false, reason: 'network' };
    if (user.role !== 'OWNER' && user.role !== 'MANAGER') return { ok: false, reason: 'not-manager' };
    if (body.same_store !== true) return { ok: false, reason: 'other-store' };
    return { ok: true, approver: { id: user.id, name: user.name ?? '' } };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
