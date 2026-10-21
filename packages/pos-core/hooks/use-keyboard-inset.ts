'use client';

import { useEffect } from 'react';

/**
 * Keyboard-aware viewport controller for tablets / iPads.
 *
 * THE PROBLEM
 * On iPadOS / iOS (and to a lesser extent Android), the on-screen keyboard
 * shrinks the *visual* viewport but leaves the *layout* viewport (what `vh`,
 * `100vh`, and `position:fixed; inset:0` use) at full height. So every centered
 * modal stays centered on the full screen and the keyboard covers the lower
 * input fields. It is worst in landscape, where the keyboard is very tall.
 *
 * THE FIX (mount this ONCE, app-wide)
 *  1. Track the real keyboard height via the VisualViewport API and publish it
 *     as `--kb-inset` on <html>, plus a `data-kb-open` flag. CSS can use these.
 *  2. When an input is focused and the keyboard is up, lift the *fixed* overlay
 *     that contains the field (modal backdrop) above the keyboard, and scroll the
 *     field into the visible band. This is generic — it works for the shared
 *     `.modal-backdrop` modals AND the inline `position:fixed; placeItems:center`
 *     overlays without editing each screen.
 *
 * Gracefully no-ops on browsers without `window.visualViewport`.
 * Supports all iPad models / iOS 13+ and Android tablets.
 */
export function useKeyboardInset() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return; // Older browsers: no-op.

    // A keyboard that eats less than this many CSS px is treated as "closed"
    // (filters out URL-bar / accessory-bar jitter). Even a landscape iPad
    // keyboard is well above this.
    const OPEN_THRESHOLD = 100;

    let inset = 0;
    let focused: HTMLElement | null = null;
    let overlay: HTMLElement | null = null;
    let overlayPrevPB: string | null = null; // restore value for the lifted overlay
    let revealRaf = 0;

    const NON_TYPING = new Set([
      'button', 'checkbox', 'radio', 'submit', 'reset',
      'range', 'color', 'file', 'hidden', 'image',
    ]);

    const isEditable = (el: EventTarget | null): el is HTMLElement => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.tagName === 'TEXTAREA') return true;
      if (el.tagName === 'INPUT') return !NON_TYPING.has((el as HTMLInputElement).type);
      return el.isContentEditable;
    };

    // Nearest ancestor that the browser positions against the viewport — i.e. the
    // modal backdrop. That is the element we lift above the keyboard.
    const fixedOverlayOf = (el: HTMLElement | null): HTMLElement | null => {
      for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
        if (getComputedStyle(n).position === 'fixed') return n;
      }
      return null;
    };

    const releaseOverlay = () => {
      if (overlay && overlay.isConnected && overlayPrevPB !== null) {
        overlay.style.paddingBottom = overlayPrevPB;
      }
      overlay = null;
      overlayPrevPB = null;
    };

    const liftOverlayFor = (el: HTMLElement) => {
      const ov = fixedOverlayOf(el);
      if (ov !== overlay) {
        releaseOverlay();
        overlay = ov;
        // `.style.paddingBottom` reflects CSS shorthand too ("20px" from `padding:20px`,
        // "" when the value comes from a stylesheet class like .modal-backdrop).
        overlayPrevPB = ov ? ov.style.paddingBottom : null;
      }
      if (overlay) {
        const base = overlayPrevPB && overlayPrevPB !== '' ? overlayPrevPB : '0px';
        overlay.style.paddingBottom = `calc(${base} + ${inset}px)`;
      }
    };

    const reveal = () => {
      if (inset < OPEN_THRESHOLD || !focused || !focused.isConnected) return;
      liftOverlayFor(focused);
      // Let the lift / layout settle, then bring the field into the visible band.
      cancelAnimationFrame(revealRaf);
      revealRaf = requestAnimationFrame(() => {
        if (focused && focused.isConnected) {
          focused.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      });
    };

    const recompute = () => {
      // Layout height minus the visible band that sits below the top offset.
      inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const open = inset >= OPEN_THRESHOLD;
      root.style.setProperty('--kb-inset', `${open ? inset : 0}px`);
      root.toggleAttribute('data-kb-open', open);
      if (open) reveal();
      else releaseOverlay();
    };

    const onFocusIn = (e: FocusEvent) => {
      if (!isEditable(e.target)) return;
      focused = e.target as HTMLElement;
      // The keyboard may open slightly after focus; recompute now and shortly after.
      recompute();
      window.setTimeout(recompute, 250);
    };

    const onFocusOut = () => {
      // Don't tear down immediately — focus often hops between fields. The
      // keyboard-close `resize` event releases the overlay when typing is done.
      focused = null;
    };

    vv.addEventListener('resize', recompute);
    vv.addEventListener('scroll', recompute);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    return () => {
      vv.removeEventListener('resize', recompute);
      vv.removeEventListener('scroll', recompute);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      cancelAnimationFrame(revealRaf);
      releaseOverlay();
      root.style.removeProperty('--kb-inset');
      root.removeAttribute('data-kb-open');
    };
  }, []);
}
