'use client';

import { useRef, type RefObject } from 'react';
import { gsap, useGSAP } from './gsap';

export interface UseLoadingRevealResult {
  /** Attach to the content wrapper that should fade in once data is ready. */
  contentRef: RefObject<HTMLDivElement | null>;
  /** Mirrors `isLoading` — render the skeleton while this is true. */
  showSkeleton: boolean;
}

/**
 * Reveal content once loading completes. While `isLoading` is true the caller
 * renders a skeleton (`showSkeleton`). When `isLoading` flips true→false the
 * content wrapper crossfades in (fade + tiny rise).
 *
 * Motion is routed through `gsap.matchMedia()`:
 *   - no-preference  → fade + rise on reveal
 *   - reduce         → snap to final state, no motion
 *
 * `useGSAP` re-runs when `isLoading` changes; `{ scope }` reverts the previous
 * run so React 19 strict double-invoke is safe.
 */
export function useLoadingReveal(isLoading: boolean): UseLoadingRevealResult {
  const contentRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = contentRef.current;
      // Nothing to reveal while the skeleton is up (content isn't mounted yet).
      if (!el || isLoading) return;

      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          el,
          { autoAlpha: 0, y: 6 },
          { autoAlpha: 1, y: 0, duration: 0.18, ease: 'power2.out' },
        );
      });

      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(el, { autoAlpha: 1, y: 0 });
      });
    },
    { scope: contentRef, dependencies: [isLoading] },
  );

  return { contentRef, showSkeleton: isLoading };
}
