'use client';

import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * False during SSR and the hydration pass, true afterwards.
 *
 * For anything that needs the DOM to exist (portals, `document.body`) without
 * causing a hydration mismatch. Uses useSyncExternalStore rather than
 * useEffect+setState so it never schedules a cascading render.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, onClient, onServer);
}
