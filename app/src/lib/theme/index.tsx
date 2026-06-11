'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'kafe-theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default to 'light' for the very first render so SSR and the first client
  // render agree. The real theme has already been applied to <html> pre-paint by
  // the inline script in layout.tsx, so the page never *looks* light — we just
  // sync React state to whatever that script decided, in an effect after mount.
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    try {
      const applied = document.documentElement.dataset.theme;
      if (applied === 'light' || applied === 'dark') setThemeState(applied);
    } catch {
      /* SSR / no document — keep default */
    }
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.dataset.theme = next;
    } catch {
      /* localStorage unavailable (private mode) — state still updates */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((cur) => {
      const next: Theme = cur === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
        document.documentElement.dataset.theme = next;
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}
