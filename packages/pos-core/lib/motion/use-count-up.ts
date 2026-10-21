'use client';

import { useEffect, useRef, type RefObject } from 'react';

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
 * Driven by `requestAnimationFrame` with a `power2.out` ease — NOT gsap. A
 * count-up is a pure numeric tween (it only writes `textContent`, never a
 * transform), so it needs none of the gsap engine. Crucially, `@gsap/react`'s
 * `useGSAP` *statically* imports the gsap engine, so routing count-up through it
 * would drag ~71KB of gsap into the first-paint chunk of every screen that uses
 * a KPI value — including the always-mounted shell (`app-common`). Hand-rolling
 * the tween keeps the engine out of those paths; gsap then loads only for the
 * transform-based entrance hooks (useFadeRise / useStagger / useLoadingReveal).
 *
 * Behaviour preserved 1:1 with the previous gsap version:
 *  - Reduced-motion: the final formatted value is written synchronously, no rAF.
 *  - React 19 double-effect safety: the tween's *start* is parsed from the
 *    element's current text, so a re-run picks up wherever the previous run left
 *    off instead of snapping back to zero and flashing.
 *  - Cleanup cancels any in-flight frame loop on re-run / unmount.
 */
export function useCountUp(
  value: number,
  opts: UseCountUpOptions = {},
): RefObject<HTMLSpanElement | null> {
  const { duration = 0.6, format } = opts;
  // Keep the latest formatter without retriggering the effect on every render
  // (callers pass a fresh `format` closure each render).
  const formatRef = useRef(format);
  formatRef.current = format;

  const ref = useRef<HTMLSpanElement>(null);

  useEffect(
    () => {
      const el = ref.current;
      if (!el) return;

      const fmt = formatRef.current ?? ((n: number) => String(Math.round(n)));

      // Parse the currently rendered number so we tween from what's on screen.
      const parsed = parseFloat((el.textContent ?? '').replace(/[^0-9.-]/g, ''));
      const from = Number.isFinite(parsed) ? parsed : 0;

      // Reduced-motion: settle instantly, no frame loop.
      if (
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        el.textContent = fmt(value);
        return;
      }

      // Already at target — write once and skip the animation entirely.
      if (from === value) {
        el.textContent = fmt(value);
        return;
      }

      const durationMs = duration * 1000;
      const delta = value - from;
      let rafId = 0;
      let start = 0;

      // power2.out: decelerating ease, matches the previous gsap tween's feel.
      const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);

      const step = (now: number) => {
        if (!start) start = now;
        const t = durationMs <= 0 ? 1 : Math.min((now - start) / durationMs, 1);
        const n = from + delta * easeOutQuad(t);
        if (ref.current) ref.current.textContent = fmt(t >= 1 ? value : n);
        if (t < 1) {
          rafId = requestAnimationFrame(step);
        }
      };

      rafId = requestAnimationFrame(step);

      return () => {
        if (rafId) cancelAnimationFrame(rafId);
      };
    },
    [value, duration],
  );

  return ref;
}
