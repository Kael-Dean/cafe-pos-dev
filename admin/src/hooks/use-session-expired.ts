'use client';

import { useSyncExternalStore } from 'react';
import { readAndClearLogoutReason } from '@/lib/admin-token';

/**
 * Whether the visitor arrived at /login because their token expired.
 *
 * The flag is consumed on first read so a refresh doesn't re-show the banner,
 * then cached — so this snapshot is stable for the rest of the page's life,
 * which is what useSyncExternalStore needs.
 */
let cached: boolean | null = null;

const noopSubscribe = () => () => {};

function getSnapshot(): boolean {
  if (cached === null) cached = readAndClearLogoutReason() === 'expired';
  return cached;
}

const getServerSnapshot = () => false;

export function useSessionExpired(): boolean {
  return useSyncExternalStore(noopSubscribe, getSnapshot, getServerSnapshot);
}
