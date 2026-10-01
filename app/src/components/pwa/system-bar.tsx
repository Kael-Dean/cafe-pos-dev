'use client';

import { useEffect, useRef } from 'react';
import { OfflineIndicator } from './offline-indicator';
import { ServiceWorkerRegister } from './service-worker-register';

// --color-bg per theme (globals.css). Mirrors viewport.themeColor in layout.tsx.
const THEME_COLOR = { light: '#F7F3EC', dark: '#1A140E' } as const;

/**
 * App-level status strip pinned to the top edge: the offline banner and the
 * "new version" prompt. Mounted once in <Providers>, so it is present on the
 * login screen as well as inside the POS.
 *
 * It does not float over the UI. Its measured height is published as
 * `--sys-bar-h` on <html>; globals.css pads <body> by that amount and derives
 * `--app-h` (the height the shell uses instead of 100dvh). So when a strip
 * appears the whole app shifts down and shrinks by exactly that height, and no
 * POS control ends up underneath it. With nothing to show the height is 0 and
 * the layout is untouched.
 */
export function SystemBar() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty('--sys-bar-h', `${el.offsetHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--sys-bar-h');
    };
  }, []);

  // The theme-color metas from layout.tsx follow the OS colour scheme, but the
  // app theme is the user's saved choice (<html data-theme>) and can differ.
  // Point every theme-color meta at the active theme so the browser / installed
  // app chrome matches what is actually on screen.
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      const color = root.dataset.theme === 'dark' ? THEME_COLOR.dark : THEME_COLOR.light;
      document
        .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
        .forEach((meta) => meta.setAttribute('content', color));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="sys-bars surface-inverse">
      <OfflineIndicator />
      <ServiceWorkerRegister />
    </div>
  );
}
