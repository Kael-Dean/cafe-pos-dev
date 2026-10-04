'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { fetchStatus } from '@/lib/printer-bridge';

/**
 * "Print the receipt automatically after a sale" — a per-device setting
 * (owner decision: localStorage, on by default when a printer is paired).
 *
 *   '1' / '0' → the cashier chose explicitly.
 *   missing   → follow the hardware: on when the local bridge reports a printer.
 */

const KEY = 'kafe:auto-print';
const EVENT = 'kafe:auto-print-change';

export type AutoPrintPref = 'on' | 'off' | 'default';

function read(): AutoPrintPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === '1' ? 'on' : v === '0' ? 'off' : 'default';
  } catch {
    return 'default';
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function useAutoPrintPref(): [AutoPrintPref, (on: boolean) => void] {
  const pref = useSyncExternalStore(subscribe, read, () => 'default' as AutoPrintPref);
  const set = useCallback((on: boolean) => {
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [pref, set];
}

/** Bridge probe for the 'default' case. Short timeout: a missing bridge must never delay the receipt. */
export async function printerPaired(timeoutMs = 1200): Promise<boolean> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const s = await fetchStatus(ctl.signal);
    return !!s.printer;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Resolve the effective setting right now (reads storage, probes the bridge only when unset). */
export async function shouldAutoPrint(): Promise<boolean> {
  const pref = read();
  if (pref !== 'default') return pref === 'on';
  return printerPaired();
}
