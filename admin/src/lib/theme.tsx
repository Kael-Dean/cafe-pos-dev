'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'frd-admin-theme';

/**
 * The active theme lives on `<html data-theme>`, put there before first paint by
 * the inline script in layout.tsx. That element is the source of truth, so React
 * subscribes to it rather than keeping a second copy in state — which also means
 * no effect, no cascading render, and no light-mode flash on load.
 */
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** SSR renders light; the pre-paint script has already corrected the DOM by then. */
function getServerSnapshot(): Theme {
  return 'light';
}

function applyTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* private mode — the choice just won't survive a reload */
  }
  listeners.forEach((cb) => cb());
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggleTheme = useCallback(() => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  }, []);
  return { theme, toggleTheme };
}
