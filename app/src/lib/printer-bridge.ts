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

export type BridgeStatus = { printer: boolean; ip: string };

export type BridgeConfig = {
  ip: string;
  port?: number;
  storeName?: string;
  storeAddress?: string | null;
  storeTaxId?: string | null;
  storeBranch?: string | null;
};

const BRIDGE_UNREACHABLE = 'bridge ไม่ตอบ — ตรวจสอบว่าเปิด bridge บน PC ที่ต่อปริ้นเตอร์';

async function bridgeFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(bridgeUrl(path), init);
  } catch {
    throw new Error(BRIDGE_UNREACHABLE);
  }
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
