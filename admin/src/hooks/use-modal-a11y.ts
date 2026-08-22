'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Modal a11y: move focus into the dialog, trap it there, close on Esc, and
 * restore focus to whatever opened it. Attach the returned ref to the element
 * carrying role="dialog" / aria-modal="true". The open/close animation stays in
 * CSS — this only wires keyboard + focus behaviour.
 */
export function useModalA11y(onClose: () => void): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the setup effect below — that
  // would steal focus back to the first field on every parent render.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;

    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    // preventScroll: the dialog is already centered; letting the browser scroll
    // the focused control into view jolts the page behind it.
    focusables()[0]?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  return ref;
}
