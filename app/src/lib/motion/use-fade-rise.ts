'use client';

import { useRef, type RefObject } from 'react';
import { gsap, useGSAP } from './gsap';

export interface UseFadeRiseOptions {
  /** Distance (px) the element rises from. Default 8 (matches the shell fade). */
  y?: number;
  /** Tween duration in seconds. Default 0.18 (≈ --dur-base). */
  duration?: number;
  /** Start delay in seconds. Default 0. */
  delay?: number;
}

/**
 * Entrance animation: fade in (opacity 0→1) while rising into place
 * (translateY(y) → 0). Returns a ref to attach to the target element.
 *
 * Motion is routed through `gsap.matchMedia()`:
 *   - no-preference  → real tween (power2.out ≈ --ease-out)
 *   - reduce         → `gsap.set` straight to the final state, no motion
 *
 * `useGSAP({ scope })` reverts on unmount and re-run, so this is safe with the
 * ScreenFrame remount-on-key pattern and React 19 strict double-invoke.
 */
export function useFadeRise(
  opts: UseFadeRiseOptions = {},
): RefObject<HTMLDivElement | null> {
  const { y = 8, duration = 0.18, delay = 0 } = opts;
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          el,
          { autoAlpha: 0, y },
          { autoAlpha: 1, y: 0, duration, delay, ease: 'power2.out' },
        );
      });

      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(el, { autoAlpha: 1, y: 0 });
      });
    },
    { scope: ref, dependencies: [y, duration, delay] },
  );

  return ref;
}
