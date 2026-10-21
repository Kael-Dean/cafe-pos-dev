'use client';

import { useRef, type RefObject } from 'react';
import { gsap, useGSAP } from './gsap';

export interface UseStaggerOptions {
  /**
   * Which children to animate, relative to the container.
   * Default `:scope > *` (direct children only).
   */
  selector?: string;
  /** Stagger gap between items in seconds. Default 0.04. */
  each?: number;
  /** Distance (px) each item rises from. Default 8. */
  y?: number;
  /** Per-item tween duration in seconds. Default 0.18 (≈ --dur-base). */
  duration?: number;
}

/**
 * Staggered entrance for a list/grid. Returns a container ref; on mount each
 * matched child fades + rises into place one after another. Good for KDS
 * tickets, KPI grids and other lists.
 *
 * Motion is routed through `gsap.matchMedia()`:
 *   - no-preference  → staggered tween (power2.out)
 *   - reduce         → `gsap.set` all items to final state at once, no motion
 *
 * `useGSAP({ scope })` handles cleanup/revert, so re-running (e.g. list change)
 * or unmount under React 19 strict mode is safe.
 */
export function useStagger(
  opts: UseStaggerOptions = {},
): RefObject<HTMLDivElement | null> {
  const { selector = ':scope > *', each = 0.04, y = 8, duration = 0.18 } = opts;
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const container = ref.current;
      if (!container) return;

      const items = container.querySelectorAll(selector);
      if (items.length === 0) return;

      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          items,
          { autoAlpha: 0, y },
          {
            autoAlpha: 1,
            y: 0,
            duration,
            ease: 'power2.out',
            stagger: each,
            // Strip the leftover inline transform once the entrance finishes so
            // CSS :hover transforms (e.g. .menu-card lift) aren't overridden.
            clearProps: 'transform',
          },
        );
      });

      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(items, { autoAlpha: 1, y: 0 });
      });
    },
    { scope: ref, dependencies: [selector, each, y, duration] },
  );

  return ref;
}
