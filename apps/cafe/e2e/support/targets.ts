import type { Page } from '@playwright/test';

/**
 * Touch-target collector shared by the visual capture harness (visual/core-screens.capture.ts,
 * which writes it into a report) and the functional guard in pos-touch.spec.ts (which asserts
 * on it). TOUCH-SPEC §5.1: no visible, reachable interactive element with a rendered box < 44px.
 */

export const MIN_TARGET = 44;

export interface SmallTarget {
  selector: string;
  label: string;
  width: number;
  height: number;
  x: number;
  y: number;
  /** Tap area incl. an absolutely positioned ::before/::after (the `.hit-44` pattern). */
  hitWidth: number;
  hitHeight: number;
  disabled: boolean;
}

export interface TargetReport {
  /** visible + reachable interactive elements */
  total: number;
  /** visible but covered (e.g. behind a modal backdrop) — not counted */
  obscured: number;
  /** of `total`, bounding box < min in width or height */
  items: SmallTarget[];
}

/**
 * Runs in the page. Kept self-contained (no closures, no imports) because Playwright
 * serialises it into the browser.
 */
export function collectTargets(min: number): TargetReport {
  const SEL = [
    'button', 'a', '[role=button]', '[role=tab]', '[role=link]', '[role=checkbox]', '[role=radio]',
    '[role=switch]', '[role=menuitem]', '[role=option]', '[role=combobox]', '[aria-haspopup]',
    'input:not([type=hidden])', 'select', 'textarea', 'summary', '[onclick]',
  ].join(',');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const round = (n: number) => Math.round(n * 10) / 10;
  const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : 0);

  const describe = (el: Element) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
    if (cls.length) s += '.' + cls.join('.');
    for (const a of ['role', 'type', 'data-nav-id', 'data-tab-id', 'data-action', 'aria-label']) {
      const v = el.getAttribute(a);
      if (v) s += `[${a}="${v.slice(0, 40)}"]`;
    }
    return s;
  };
  const labelOf = (el: Element) => {
    const h = el as HTMLElement & { placeholder?: string; value?: string };
    const by = el.getAttribute('aria-labelledby');
    const t =
      el.getAttribute('aria-label') ||
      (by ? by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : '') ||
      h.innerText ||
      h.placeholder ||
      el.getAttribute('title') ||
      (typeof h.value === 'string' ? h.value : '') ||
      '';
    return t.replace(/\s+/g, ' ').trim().slice(0, 60);
  };

  const items: SmallTarget[] = [];
  let total = 0;
  let obscured = 0;
  const seen = new Set<Element>();
  for (const el of Array.from(document.querySelectorAll(SEL))) {
    if (seen.has(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
    if (el.closest('[inert], [aria-hidden="true"]')) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    if (el instanceof HTMLInputElement && (el.type === 'hidden')) continue;

    // Reachable = a tap at the centre of its on-screen part lands on it (not on a modal
    // backdrop or a sticky bar covering it). Clip to the viewport first.
    const cx = (Math.max(r.left, 0) + Math.min(r.right, vw)) / 2;
    const cy = (Math.max(r.top, 0) + Math.min(r.bottom, vh)) / 2;
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || !(el === hit || el.contains(hit))) { obscured++; continue; }
    total++;

    if (r.width >= min && r.height >= min) continue;
    let hitW = r.width;
    let hitH = r.height;
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(el, pseudo);
      if (ps.content === 'none' || ps.content === 'normal' || ps.position !== 'absolute') continue;
      hitW = Math.max(hitW, px(ps.width));
      hitH = Math.max(hitH, px(ps.height));
    }
    items.push({
      selector: describe(el),
      label: labelOf(el),
      width: round(r.width),
      height: round(r.height),
      x: round(r.left),
      y: round(r.top),
      hitWidth: round(hitW),
      hitHeight: round(hitH),
      disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true',
    });
  }
  return { total, obscured, items };
}

/** Convenience wrapper: run the collector on `page`. */
export function smallTargets(page: Page, min = MIN_TARGET): Promise<TargetReport> {
  return page.evaluate(collectTargets, min);
}
