/**
 * Minimal Pusher Channels client (protocol 7) over the browser WebSocket — just
 * enough to listen on ONE public channel. The backend publishes the KDS events on
 * `kds-store-{store_id}` (no `private-` prefix, so no auth round-trip). Written
 * here instead of adding `pusher-js` (~60 kB) for three events; anything the bar
 * screen cannot get from it, it gets from polling anyway.
 *
 * Config comes from the public env (inlined at build time):
 *   NEXT_PUBLIC_PUSHER_KEY      app key (public by design)
 *   NEXT_PUBLIC_PUSHER_CLUSTER  e.g. "ap1" (default)
 * Without a key `pusherConfig()` is null and callers simply keep polling. The CSP
 * `connect-src` entry for the socket host comes from `realtimeOrigins()` in
 * lib/server/csp.ts, which reads the same two variables.
 */

export interface PusherConfig { key: string; cluster: string }

export function pusherConfig(env: { key?: string; cluster?: string } = {
  key: process.env.NEXT_PUBLIC_PUSHER_KEY,
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
}): PusherConfig | null {
  const key = env.key?.trim();
  if (!key) return null;
  const cluster = (env.cluster?.trim() || 'ap1').toLowerCase();
  // Only [a-z0-9-] reaches the host name (the CSP builder applies the same rule).
  if (!/^[a-z0-9-]+$/i.test(cluster) || !/^[A-Za-z0-9]+$/.test(key)) return null;
  return { key, cluster };
}

export function pusherUrl({ key, cluster }: PusherConfig): string {
  return `wss://ws-${cluster}.pusher.com/app/${key}?protocol=7&client=pos-core&version=1.0&flash=false`;
}

export interface PusherFrame {
  event: string;
  channel: string | null;
  /** `data` is a JSON string inside the JSON frame; parsed when it is one. */
  data: unknown;
}

export function parsePusherFrame(raw: unknown): PusherFrame | null {
  if (typeof raw !== 'string') return null;
  let msg: unknown;
  try { msg = JSON.parse(raw); } catch { return null; }
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as Record<string, unknown>;
  if (typeof m.event !== 'string') return null;
  let data: unknown = m.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { /* plain string payload */ }
  }
  return { event: m.event, channel: typeof m.channel === 'string' ? m.channel : null, data };
}

export type RealtimeStatus = 'off' | 'connecting' | 'live' | 'down';

export interface ChannelListener {
  onEvent: (event: string, data: unknown) => void;
  onStatus?: (status: RealtimeStatus) => void;
}

/** Backoff for reconnects: 1s, 2s, 4s … capped at 30s. */
export const reconnectDelay = (attempt: number) => Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));

/**
 * Opens the socket, subscribes to `channel`, answers pings, reconnects with
 * backoff. Returns a stop function. Never throws: a missing WebSocket or a blocked
 * connection only reports status 'down' (polling keeps the screen correct).
 */
export function subscribeChannel(cfg: PusherConfig, channel: string, listener: ChannelListener): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let activityTimeoutMs = 120_000;

  const status = (s: RealtimeStatus) => listener.onStatus?.(s);
  const send = (event: string, data: unknown) => {
    try { ws?.send(JSON.stringify({ event, data })); } catch { /* socket closing */ }
  };

  // No traffic for `activity_timeout` → ping; no answer within 30s → reconnect.
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      send('pusher:ping', {});
      idleTimer = setTimeout(() => { try { ws?.close(); } catch { /* ignore */ } }, 30_000);
    }, activityTimeoutMs);
  };

  const connect = () => {
    if (stopped) return;
    if (typeof WebSocket === 'undefined') { status('down'); return; }
    status('connecting');
    try {
      ws = new WebSocket(pusherUrl(cfg));
    } catch {
      status('down');
      scheduleRetry();
      return;
    }
    ws.onmessage = (ev) => {
      armIdle();
      const f = parsePusherFrame(ev.data);
      if (!f) return;
      if (f.event === 'pusher:connection_established') {
        const t = (f.data as { activity_timeout?: number } | null)?.activity_timeout;
        if (typeof t === 'number' && t > 0) activityTimeoutMs = Math.min(t, 120) * 1000;
        send('pusher:subscribe', { channel });
        return;
      }
      if (f.event === 'pusher_internal:subscription_succeeded') { attempt = 0; status('live'); return; }
      if (f.event === 'pusher:ping') { send('pusher:pong', {}); return; }
      if (f.event === 'pusher:error') return;
      if (f.channel === channel) listener.onEvent(f.event, f.data);
    };
    ws.onclose = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (stopped) return;
      status('down');
      scheduleRetry();
    };
    ws.onerror = () => { /* onclose follows */ };
  };

  const scheduleRetry = () => {
    if (stopped) return;
    retryTimer = setTimeout(connect, reconnectDelay(attempt++));
  };

  connect();

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (idleTimer) clearTimeout(idleTimer);
    try { ws?.close(); } catch { /* ignore */ }
    ws = null;
    status('off');
  };
}
