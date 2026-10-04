'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Modal a11y: trap focus inside the dialog, close on Esc, restore focus to the
 * element that opened it. Attach the returned ref to the dialog element that
 * carries role="dialog" / aria-modal="true". The visual open/close stays on the
 * CSS .modal-in / .backdrop-in classes — this only wires keyboard + focus
 * behaviour.
 *
 * Shared canonical version of the hook that used to be copy-pasted per modal
 * file; import from '@/hooks/use-modal-a11y' instead of redeclaring it.
 */
// Open dialogs, oldest first. Only the topmost one reacts to Escape / Tab, so a
// confirm opened over a sheet closes alone instead of taking the sheet with it.
const openStack: symbol[] = [];

export function useModalA11y(onClose: () => void): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const token = Symbol('modal');
    openStack.push(token);
    const isTop = () => openStack[openStack.length - 1] === token;

    // Move focus into the dialog on open (first focusable, else the shell).
    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    // preventScroll: the dialog is centered in the viewport already; letting the
    // browser scroll the focused control into view can jolt the page behind it.
    focusables()[0]?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return;
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
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
      const at = openStack.indexOf(token);
      if (at >= 0) openStack.splice(at, 1);
      document.removeEventListener('keydown', onKey);
      // A dialog that hands over to another one (detail -> settle) stays mounted for
      // its exit fade, so this cleanup can run AFTER the next dialog took focus. Do not
      // pull focus out of a different open dialog back to the page behind it.
      const ae = document.activeElement as HTMLElement | null;
      const inOtherDialog = !!ae && ae !== document.body && !node?.contains(ae) && !!ae.closest('[aria-modal="true"]');
      if (!inOtherDialog) {
        // Opener gone (it lived inside the dialog we handed over from): land on <main>
        // rather than <body> so the next Tab starts inside the screen, not the sidebar.
        if (opener && opener.isConnected) opener.focus({ preventScroll: true });
        else document.getElementById('main-content')?.focus({ preventScroll: true });
      }
    };
    // onClose identity is stable for the modal's lifetime in practice; we only
    // want this to run once on mount/unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
