'use client';

import { useRef, type RefObject } from 'react';
import { useGSAP } from '@gsap/react';

export interface UseCountUpOptions {
  /** Tween duration in seconds. Default 0.6 (count-up reads slower than UI motion). */
  duration?: number;
  /** Formats the live number into the element's text. Default `Math.round(n)`. */
  format?: (n: number) => string;
}

/**
 * Animate a numeric value into a `<span>` by tweening from its currently
 * displayed value up (or down) to `value`, writing `textContent` each frame.
 *
 * gsap is **lazy-imported** inside the effect (dynamic `import('gsap')`) so the
 * POS first-paint chunk never pulls the engine — only the dashboard (the lone
 * count-up consumer) loads it on demand.
 *
 * Reduced-motion: the final formatted value is written synchronously (no tween).
 *
 * React 19 double-effect safety: the tween's *start* is parsed from the
 * element's current text, so a re-run picks up wherever the previous run left
 * off instead of snapping back to zero and flashing.
 */
export function useCountUp(
  value: number,
  opts: UseCountUpOptions = {},
): RefObject<HTMLSpanElement | null> {
  const { duration = 0.6, format } = opts;
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      const fmt = format ?? ((n: number) => String(Math.round(n)));

      // Parse the currently rendered number so we tween from what's on screen.
      const parsed = parseFloat((el.textContent ?? '').replace(/[^0-9.-]/g, ''));
      const from = Number.isFinite(parsed) ? parsed : 0;

      // Reduced-motion: settle instantly, no engine work.
      if (
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        el.textContent = fmt(value);
        return;
      }

      // Already at target — write once and skip the dynamic import entirely.
      if (from === value) {
        el.textContent = fmt(value);
        return;
      }

      let killed = false;
      let tween: gsap.core.Tween | undefined;

      void import('gsap').then(({ gsap }) => {
        if (killed || !ref.current) return;
        const counter = { n: from };
        tween = gsap.to(counter, {
          n: value,
          duration,
          ease: 'power2.out',
          onUpdate: () => {
            if (ref.current) ref.current.textContent = fmt(counter.n);
          },
          onComplete: () => {
            if (ref.current) ref.current.textContent = fmt(value);
          },
        });
      });

      // Cleanup runs synchronously on re-run/unmount; the async import resolves
      // after `killed` flips, so a stale tween is never started.
      return () => {
        killed = true;
        tween?.kill();
      };
    },
    { dependencies: [value, duration] },
  );

  return ref;
}
