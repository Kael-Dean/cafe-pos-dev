'use client';

// Local print bridge runs on the PC that has the printer cable.
// Chrome treats http://127.0.0.1 as a secure context, so HTTPS pages
// (e.g. cafe-pos-sable.vercel.app) can fetch from it without mixed-content blocking.
//
// If the browser cannot reach the bridge, every call here throws.
// Callers are expected to surface that to the user (the POS app is only
// useful from the PC running the bridge).

export const BRIDGE_BASE = 'http://127.0.0.1:8080';

export const bridgeUrl = (path: string) => `${BRIDGE_BASE}${path}`;

export type PrinterMode = 'lan' | 'usb';

export type BridgeStatus = { printer: boolean; ip: string; mode?: PrinterMode; printerName?: string | null };

export type BridgeConfig = {
  ip: string;
  port?: number;
  mode?: PrinterMode;
  printerName?: string | null;
  storeName?: string;
  storeAddress?: string | null;
  storeTaxId?: string | null;
  storeBranch?: string | null;
};

const BRIDGE_UNREACHABLE = 'bridge ไม่ตอบ — ตรวจสอบว่าเปิด bridge บน PC ที่ต่อปริ้นเตอร์';

// The bridge only answers allow-listed origins that send its shop-wide token
// (security audit M3). The token is handed out by the BFF to logged-in users
// only, and cached in memory for the page's lifetime (never persisted).
let bridgeTokenPromise: Promise<string | null> | null = null;

function loadBridgeToken(): Promise<string | null> {
  if (!bridgeTokenPromise) {
    bridgeTokenPromise = fetch('/api/auth/bridge-token', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          bridgeTokenPromise = null; // not logged in yet / transient: retry next call
          return null;
        }
        const data = (await r.json().catch(() => ({}))) as { token?: unknown };
        return typeof data.token === 'string' && data.token ? data.token : null;
      })
      .catch(() => {
        bridgeTokenPromise = null;
        return null;
      });
  }
  return bridgeTokenPromise;
}

async function rawBridgeFetch(path: string, init: RequestInit | undefined, token: string | null): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (token) headers.set('x-bridge-token', token);
  try {
    return await fetch(bridgeUrl(path), { ...init, headers });
  } catch {
    throw new Error(BRIDGE_UNREACHABLE);
  }
}

async function bridgeFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await rawBridgeFetch(path, init, await loadBridgeToken());
  if (res.status === 401) {
    // Token rotated on the server since we cached it: fetch it again, retry once.
    bridgeTokenPromise = null;
    return rawBridgeFetch(path, init, await loadBridgeToken());
  }
  return res;
}

export async function fetchStatus(signal?: AbortSignal): Promise<BridgeStatus> {
  const res = await bridgeFetch('/status', { signal });
  if (!res.ok) throw new Error('status failed');
  return res.json();
}

export async function fetchConfig(): Promise<BridgeConfig> {
  const res = await bridgeFetch('/config');
  if (!res.ok) throw new Error('config load failed');
  return res.json();
}

export async function saveConfig(patch: Partial<BridgeConfig>): Promise<BridgeConfig> {
  const res = await bridgeFetch('/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'config save failed');
  return data;
}

export async function scanPrinters(signal?: AbortSignal): Promise<{ found: string[]; subnet: string }> {
  const res = await bridgeFetch('/scan', { signal });
  if (!res.ok) throw new Error('scan failed');
  return res.json();
}

// USB mode: list Windows-installed printers so the user can pick one by name.
export async function listPrinters(signal?: AbortSignal): Promise<string[]> {
  const res = await bridgeFetch('/printers', { signal });
  if (!res.ok) throw new Error('printers list failed');
  const data = await res.json();
  return (data as { printers?: string[] }).printers ?? [];
}

export async function sendPrintJob(body: Record<string, unknown>): Promise<void> {
  const res = await bridgeFetch('/print', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'print failed');
  }
}
