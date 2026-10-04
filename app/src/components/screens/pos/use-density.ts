'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useMediaQuery } from '@/hooks/use-media-query';
import type { Density } from './model';

/**
 * Menu density, remembered per device. With no saved choice the default follows
 * the owner decision: compact text tiles at ≥1024px, photo cards below.
 */
const KEY = 'pos:density';
const EVENT = 'pos-density-change';

function read(): Density | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'compact' || v === 'photo' ? v : null;
  } catch { return null; }
}

function subscribe(notify: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) notify(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener(EVENT, notify);
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(EVENT, notify); };
}

export function useDensity(): [Density, (d: Density) => void] {
  const wide = useMediaQuery('(min-width: 1024px)');
  const saved = useSyncExternalStore(subscribe, read, () => null);
  const set = useCallback((d: Density) => {
    try { localStorage.setItem(KEY, d); } catch { /* ignore */ }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [saved ?? (wide ? 'compact' : 'photo'), set];
}
