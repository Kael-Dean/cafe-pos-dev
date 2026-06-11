'use client';

// Public surface of the motion library. Screens/components import from
// `@/lib/motion` rather than reaching into individual files.

export { gsap, useGSAP } from './gsap';

export { useFadeRise } from './use-fade-rise';
export { useStagger } from './use-stagger';
export { useCountUp } from './use-count-up';
export { useLoadingReveal } from './use-loading-reveal';

/**
 * Synchronous check for the user's reduced-motion preference.
 *
 * Prefer routing animation through `gsap.matchMedia()` inside the hooks (it
 * reacts to live preference changes and reverts automatically). Use this helper
 * only for one-off branching that lives outside a matchMedia context.
 *
 * SSR-safe: returns `false` on the server where `window` is undefined.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
