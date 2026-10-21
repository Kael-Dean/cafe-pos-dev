/**
 * NEW TABLE badge (handoff Part B): an order gets the badge when it is the FIRST
 * order on its `session_id`. The backend sends no field for it, so the bar screen
 * derives it.
 *
 * The board only ever sees active orders (PENDING / IN_PROGRESS / READY), so once a
 * table's first order is served, "earliest active order" would wrongly promote the
 * second one. We therefore remember the first order seen per session (persisted per
 * device, see `use-guest-orders.ts`) and only fall back to "earliest active order"
 * for sessions we have never seen before (e.g. right after a reload with an empty
 * memory).
 *
 * Pure: no React, no storage — the caller owns the memory map.
 */

export interface OrderOnSession {
  id: string;
  sessionId: string | null;
  /** ISO timestamp. */
  createdAt: string;
  /** Tie-breaker when two orders share a timestamp. */
  orderNumber: number;
  /** Decimal string; only needed by `olderOrdersFromFloor`. */
  total?: string;
}

/**
 * sessionId → id of the first order seen on that session, or `NO_FIRST_ORDER`
 * when the session already had older orders before this device first saw it.
 */
export type FirstOrderMemory = Readonly<Record<string, string>>;

/** Memory value for "the first order already left the board before we looked". */
export const NO_FIRST_ORDER = '-';

/**
 * Tells whether a session we have never seen has orders that are NOT on the board
 * (served / paid earlier). The bar screen answers it from `/floor/live`: the
 * table's `unpaid_total` exceeds the sum of its active orders. Pass `null` while
 * the floor is not loaded yet — unseen sessions are then left undecided.
 */
export type HasOlderOrders = ((sessionId: string, activeOnSession: readonly OrderOnSession[]) => boolean) | null;

const earlier = (a: OrderOnSession, b: OrderOnSession): boolean => {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (ta !== tb) return ta < tb;
  return a.orderNumber < b.orderNumber;
};

/**
 * Returns the updated memory: sessions already remembered keep their value; a
 * session seen for the first time records its earliest active order — or
 * NO_FIRST_ORDER when `hasOlder` says older orders exist. Returns the SAME object
 * when nothing changed (cheap equality for React state).
 */
export function rememberFirstOrders(
  memory: FirstOrderMemory,
  orders: readonly OrderOnSession[],
  hasOlder: HasOlderOrders = () => false,
): FirstOrderMemory {
  if (!hasOlder) return memory;
  const bySession = new Map<string, OrderOnSession[]>();
  for (const o of orders) {
    if (!o.sessionId || memory[o.sessionId]) continue;
    const list = bySession.get(o.sessionId);
    if (list) list.push(o); else bySession.set(o.sessionId, [o]);
  }
  if (bySession.size === 0) return memory;
  const next: Record<string, string> = { ...memory };
  for (const [sid, list] of bySession) {
    if (hasOlder(sid, list)) { next[sid] = NO_FIRST_ORDER; continue; }
    let first = list[0];
    for (const o of list) if (earlier(o, first)) first = o;
    next[sid] = first.id;
  }
  return next;
}

/** Ids of the orders that carry the NEW TABLE badge. */
export function newTableOrderIds(
  memory: FirstOrderMemory,
  orders: readonly OrderOnSession[],
  hasOlder: HasOlderOrders = () => false,
): Set<string> {
  const mem = rememberFirstOrders(memory, orders, hasOlder);
  const ids = new Set<string>();
  for (const o of orders) if (o.sessionId && mem[o.sessionId] === o.id) ids.add(o.id);
  return ids;
}

/** Decimal money string → integer satang (exact; no float sums). */
export function toSatang(amount: string | null | undefined): number {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec((amount ?? '').trim());
  if (!m) return 0;
  const v = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0') || 0);
  return m[1] ? -v : v;
}

/**
 * The HasOlderOrders answer from `/floor/live`: a session whose unpaid total is
 * larger than the orders on the board has older (served) orders. `null` while
 * the floor is not loaded. A session missing from the floor (opened after the
 * last poll) is brand new, so it has no older orders.
 */
export function olderOrdersFromFloor(unpaidBySession: ReadonlyMap<string, string> | null): HasOlderOrders {
  if (!unpaidBySession) return null;
  return (sid, active) => {
    const unpaid = unpaidBySession.get(sid);
    if (unpaid === undefined) return false;
    const onBoard = active.reduce((t, o) => t + toSatang(o.total), 0);
    return toSatang(unpaid) > onBoard;
  };
}

/**
 * Drops sessions that are no longer open so the memory cannot grow forever.
 * `openSessionIds` = sessions from `/floor/live`; pass null while it is unknown
 * (nothing is pruned then).
 */
export function pruneFirstOrders(memory: FirstOrderMemory, openSessionIds: ReadonlySet<string> | null): FirstOrderMemory {
  if (!openSessionIds) return memory;
  let changed = false;
  const next: Record<string, string> = {};
  for (const [sid, oid] of Object.entries(memory)) {
    if (openSessionIds.has(sid)) next[sid] = oid; else changed = true;
  }
  return changed ? next : memory;
}

/**
 * Orders that should trigger the loud alert: PENDING guest orders (guest_id set)
 * whose id was not in the previous poll. `previous` null = first load: nothing
 * alerts (the bar does not want a burst of beeps for orders already on screen).
 */
export function newPendingGuestOrders<T extends { id: string; status: string; guestId: string | null }>(
  previous: ReadonlySet<string> | null,
  orders: readonly T[],
): T[] {
  if (!previous) return [];
  return orders.filter((o) => o.status === 'PENDING' && o.guestId !== null && !previous.has(o.id));
}
