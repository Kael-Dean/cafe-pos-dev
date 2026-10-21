/**
 * Haptic feedback for touch counters (TOUCH-SPEC §4).
 *
 *   haptic();            // 'tap'     → 8ms   add-to-cart, qty ±, keypad key, KDS bump
 *   haptic('success');   // 'success' → 12·40·12  payment completed
 *
 * Never call it on errors or navigation. Haptics are optional: iOS Safari has no
 * Vibration API, some browsers block it until the first user gesture, and a
 * desktop has no motor. Every failure is swallowed, so callers never need a guard.
 */
export type HapticKind = 'tap' | 'success';

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 8,
  success: [12, 40, 12],
};

export function haptic(kind: HapticKind = 'tap'): void {
  try {
    if (typeof navigator === 'undefined') return;
    navigator.vibrate?.(PATTERNS[kind]);
  } catch {
    /* unsupported or blocked: haptics are optional */
  }
}
