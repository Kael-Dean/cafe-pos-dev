'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Phones = below Tailwind `md`. Keep in sync with the `@media (max-width: 767px)` blocks in globals.css. */
export const PHONE_QUERY = '(max-width: 767px)';

/**
 * Subscribes to a CSS media query. SSR-safe: the server snapshot is `false`, and the
 * client reads `matchMedia` on the first client render, so there is no post-mount flip.
 *
 * Reach for this only when the JSX *structure* must differ (master → detail flows,
 * a different component on phones). Anything that is purely layout belongs in a
 * class from the "Responsive toolkit" section of globals.css instead.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** True on phone-width viewports (< 768px) — the same breakpoint the CSS toolkit uses. */
export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
