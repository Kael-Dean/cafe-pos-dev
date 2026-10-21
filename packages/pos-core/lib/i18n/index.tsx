'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { th, type Messages } from './th';
import { en } from './en';

export type Lang = 'th' | 'en';

const DICTS: Record<Lang, Messages> = { th, en };
const STORAGE_KEY = 'kafe-lang';

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Resolved dictionary for the current language — access members directly: `t.nav.pos`. */
  t: Messages;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Default to Thai on both server and first client render to avoid hydration mismatch;
  // the saved preference is applied in an effect right after mount.
  const [lang, setLangState] = useState<Lang>('th');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'th' || saved === 'en') setLangState(saved);
    } catch {
      /* localStorage unavailable (private mode / SSR) — keep default */
    }
  }, []);

  useEffect(() => {
    try { document.documentElement.lang = lang; } catch { /* noop */ }
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* noop */ }
  }, []);

  return (
    <I18nContext.Provider value={{ lang, setLang, t: DICTS[lang] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within <LanguageProvider>');
  return ctx;
}
