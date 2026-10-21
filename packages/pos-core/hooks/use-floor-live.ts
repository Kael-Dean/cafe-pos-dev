import { useQuery } from '@tanstack/react-query';
import { api } from '@pos/core/lib/api-client';

/**
 * `GET /floor/live` — the bar's table overview (handoff Part B "Tables overview"):
 * every table with its open session, the guests on it, the unpaid total and how
 * many guests pressed "request bill". Polled every 15 s; the realtime channel
 * (`guest.checkout_requested`) invalidates it sooner when Pusher is configured.
 *
 * The handoff names the fields but not the nesting, so the mapper accepts the
 * table fields either at the top level or under `table`, and the session / guests
 * either at the top level or under `session` / `open_session`.
 */

export type GuestStatus = 'ACTIVE' | 'CHECKOUT_REQUESTED' | 'CHECKED_OUT';

// ── Backend shapes (as documented in the handoff DTOs) ────────────────────────
export interface GuestRead {
  id: string;
  session_id: string;
  label: string;
  status: GuestStatus;
  arrived_at: string;
  checkout_requested_at: string | null;
  left_at: string | null;
  customer_id: string | null;
  time_charge_amount: string | null;
  time_charge_order_id: string | null;
  minutes_so_far: number;
  unpaid_total: string;
}

type Loose = Record<string, unknown>;

// ── Frontend shapes ───────────────────────────────────────────────────────────
export interface LiveGuest {
  id: string;
  sessionId: string;
  label: string;
  status: GuestStatus;
  arrivedAt: string | null;
  checkoutRequestedAt: string | null;
  unpaidTotal: string;
}

export interface LiveSession {
  id: string;
  openedAt: string | null;
  partySize: number;
  /** Set once the owner started closing (payment pending) — new scans get 409. */
  closedAt: string | null;
}

export interface LiveTable {
  id: string;
  name: string;
  zone: string | null;
  capacity: number;
  session: LiveSession | null;
  guests: LiveGuest[];
  unpaidTotal: string;
  checkoutRequestedCount: number;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const obj = (v: unknown): Loose | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : null);

export function mapGuest(g: Loose, sessionId: string | null): LiveGuest {
  const status = str(g.status);
  return {
    id: str(g.id) ?? '',
    sessionId: str(g.session_id) ?? sessionId ?? '',
    label: str(g.label) ?? 'Guest',
    status: status === 'CHECKOUT_REQUESTED' || status === 'CHECKED_OUT' ? status : 'ACTIVE',
    arrivedAt: str(g.arrived_at),
    checkoutRequestedAt: str(g.checkout_requested_at),
    unpaidTotal: str(g.unpaid_total) ?? '0.00',
  };
}

export function mapLiveTable(raw: Loose): LiveTable {
  const t = obj(raw.table) ?? raw;
  const s = obj(raw.session) ?? obj(raw.open_session) ?? null;
  const session: LiveSession | null = s && str(s.id)
    ? {
        id: str(s.id)!,
        openedAt: str(s.opened_at),
        partySize: num(s.party_size, 0),
        closedAt: str(s.closed_at),
      }
    : null;
  const guestsRaw = Array.isArray(raw.guests) ? raw.guests : Array.isArray(s?.guests) ? (s!.guests as unknown[]) : [];
  const guests = (guestsRaw as unknown[]).map(obj).filter((g): g is Loose => !!g).map((g) => mapGuest(g, session?.id ?? null));
  const requested = raw.checkout_requested_count ?? s?.checkout_requested_count;
  return {
    id: str(t.id) ?? str(raw.table_id) ?? '',
    name: str(t.name) ?? str(raw.table_name) ?? '',
    zone: str(t.zone),
    capacity: num(t.capacity, 0),
    session,
    guests,
    unpaidTotal: str(raw.unpaid_total) ?? str(s?.unpaid_total) ?? '0.00',
    checkoutRequestedCount: typeof requested === 'number'
      ? requested
      : guests.filter((g) => g.status === 'CHECKOUT_REQUESTED').length,
  };
}

export const FLOOR_LIVE_KEY = ['floor-live'] as const;

export function useFloorLive(enabled = true, intervalMs = 15_000) {
  return useQuery<LiveTable[]>({
    queryKey: FLOOR_LIVE_KEY,
    queryFn: async () => {
      const data = await api.get<unknown>('/api/v1/floor/live');
      const list = Array.isArray(data) ? data : Array.isArray(obj(data)?.tables) ? (obj(data)!.tables as unknown[]) : [];
      return list.map(obj).filter((x): x is Loose => !!x).map(mapLiveTable);
    },
    enabled,
    refetchInterval: intervalMs,
    // The bar tablet sits on this screen for hours; keep polling when it is the
    // only tab but not when the PWA is backgrounded.
    refetchIntervalInBackground: false,
  });
}

/** Guest lookup across all open tables (order board joins on it). */
export function indexGuests(tables: readonly LiveTable[] | undefined): Map<string, { guest: LiveGuest; table: LiveTable }> {
  const m = new Map<string, { guest: LiveGuest; table: LiveTable }>();
  for (const t of tables ?? []) for (const g of t.guests) m.set(g.id, { guest: g, table: t });
  return m;
}

/** Session id → table (order board shows the table name for a session order). */
export function indexSessions(tables: readonly LiveTable[] | undefined): Map<string, LiveTable> {
  const m = new Map<string, LiveTable>();
  for (const t of tables ?? []) if (t.session) m.set(t.session.id, t);
  return m;
}
