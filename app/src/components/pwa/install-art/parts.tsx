'use client';

// Shared drawing primitives for the "install the app" illustrations.
//
// Visual language (keep every scene on it):
//   - Flat, outline-first mock-ups. Chrome lines 1.25, glyph strokes 1.6, round caps.
//   - Radii: device 36 / screen 28 / window 10 / sheet + card 14 / control 8 / pill 999.
//   - Type: 11 (meta, host), 12 (body, menu rows), 13 (titles). Never below 11 units;
//     both viewBoxes render at >= 1 unit per CSS px at a 320px-wide display.
//   - Colour only through theme tokens, so light/dark follow <html data-theme>.
//     The one exception is the Kafe OS app icon, which is a fixed-colour picture of
//     the real installed icon (the real icon does not change with the theme either).
//   - Exactly one <Highlight> per scene: caramel ring + soft caramel wash + pointer.
//     Everything that is not the target is drawn in border / muted tones.

import { useId, type ReactNode } from 'react';

/* ── Tokens ───────────────────────────────────────────────────────── */

export const C = {
  bg: 'var(--color-bg)',
  surface: 'var(--color-surface)',
  surface2: 'var(--color-surface-2)',
  border: 'var(--color-border)',
  borderStrong: 'var(--color-border-strong)',
  text: 'var(--color-text)',
  text2: 'var(--color-text-secondary)',
  muted: 'var(--color-text-muted)',
  primary: 'var(--color-primary)',
  onPrimary: 'var(--color-text-inverse)',
  accent: 'var(--color-accent)',
  accent50: 'var(--color-accent-50)',
  onAccent: 'var(--color-on-accent)',
} as const;

/** Caramel ring. Pure --color-accent is only ~2:1 on the light surfaces, so the
 *  ring is the accent pulled toward --color-primary: a deeper caramel (~4:1) in
 *  light, a lighter caramel (~8:1) in dark. Falls back to --color-accent-600. */
export const RING = 'color-mix(in oklab, var(--color-accent) 60%, var(--color-primary))';
const RING_FALLBACK = 'var(--color-accent-600)';
/** Soft caramel wash behind the target. --color-accent-50 equals --color-surface-2
 *  in dark mode (it would vanish), so the wash is translucent accent instead. */
export const WASH = 'color-mix(in oklab, var(--color-accent) 24%, transparent)';

export const FONT = 'var(--font-sans)';
export const T = { meta: 11, body: 12, title: 13 } as const;
export const STROKE = 1.25;
export const GLYPH = 1.6;

export const PHONE_VB = { w: 280, h: 360 } as const;
export const DESKTOP_VB = { w: 320, h: 216 } as const;

/** Per-instance id safe for url(#...) references (several scenes mount at once). */
export function useSafeId(): string {
  return 'kafe-art-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
}

/* ── Text ─────────────────────────────────────────────────────────── */

// Thai above/below-line marks take no advance width.
const THAI_MARK = /[ัิ-ฺ็-๎]/;

/** Rough advance width of a string in the art font. Used only to size boxes and
 *  space menu items; the preview screenshots are the real check. */
export function textW(s: string, size: number, bold = false): number {
  let em = 0;
  for (const ch of s) {
    if (THAI_MARK.test(ch)) continue;
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x0e00 && code <= 0x0e7f) em += 0.6;
    else if (ch === ' ') em += 0.26;
    else if (/[.,:;'’…|!il]/.test(ch)) em += 0.28;
    else if (/[A-Z]/.test(ch)) em += 0.64;
    else if (/[mw]/.test(ch)) em += 0.8;
    else em += 0.53;
  }
  return em * size * (bold ? 1.06 : 1);
}

type TextProps = {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  weight?: 400 | 500 | 600 | 700;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
};

/** Grey text tones as painted inside the art. The light theme's --color-text-secondary /
 *  --color-text-muted drop to 3.7-4.4:1 on the cream art surfaces and the caramel wash,
 *  so art *text* is pulled 20% toward --color-text (>= 4.8:1 there, both themes). Glyph
 *  strokes keep the plain tokens. Set via `style`, so a browser without color-mix keeps
 *  the plain token from the attribute. */
const TEXT_TONE: Record<string, string> = {
  [C.text2]: 'color-mix(in oklab, var(--color-text-secondary) 80%, var(--color-text))',
  [C.muted]: 'color-mix(in oklab, var(--color-text-muted) 80%, var(--color-text))',
};

/** Single-line label. `y` is the vertical centre of the line. */
export function Label({ x, y, children, size = T.body, weight = 400, fill = C.text, anchor = 'start' }: TextProps) {
  const tone = TEXT_TONE[fill];
  return (
    <text
      x={x}
      y={y}
      fontFamily={FONT}
      fontSize={size}
      fontWeight={weight}
      fill={fill}
      style={tone ? { fill: tone } : undefined}
      textAnchor={anchor}
      dominantBaseline="central"
    >
      {children}
    </text>
  );
}

/** A grey bar standing in for text we don't need to spell out. */
export function Bar({ x, y, w, h = 6, fill = C.border }: { x: number; y: number; w: number; h?: number; fill?: string }) {
  return <rect x={x} y={y - h / 2} width={w} height={h} rx={h / 2} fill={fill} />;
}

/* ── Scene root ───────────────────────────────────────────────────── */

export function ArtSvg({
  kind,
  ariaLabel,
  children,
}: {
  kind: 'phone' | 'desktop';
  ariaLabel: string;
  children: ReactNode;
}) {
  const vb = kind === 'phone' ? PHONE_VB : DESKTOP_VB;
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${vb.w} ${vb.h}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', height: 'auto', fontFamily: FONT }}
    >
      {children}
    </svg>
  );
}

/* ── Kafe OS app icon ─────────────────────────────────────────────── */

// Fixed colours sampled from public/logo.svg (rainbow arch + caramel rays on cream).
const ICON_BG = '#F4EFE3';
const ICON_EDGE = 'rgba(61, 40, 23, 0.16)';
const ARCH = ['#E5472A', '#EE8F3A', '#F0CF44', '#7DB84F', '#3F67A8', '#6A3C83'];
const RAY = '#CC9649';
const WORD = '#983837';

/** The installed app icon: rainbow arch + rays on a cream tile, with a single
 *  maroon bar hinting at the Thai wordmark (real lettering is unreadable this small). */
export function AppIcon({
  x,
  y,
  size,
  shape = 'squircle',
}: {
  x: number;
  y: number;
  size: number;
  shape?: 'squircle' | 'circle';
}) {
  const s = size;
  const cx = x + s / 2;
  const cy = y + s * 0.6;
  const outer = s * 0.33;
  const step = s * 0.042;
  const sw = s * 0.045;
  const rays: ReactNode[] = [];
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + (Math.PI * (i + 1)) / 8;
    const r1 = outer + s * 0.05;
    const r2 = outer + s * 0.1;
    rays.push(
      <line
        key={i}
        x1={cx + Math.cos(a) * r1}
        y1={cy + Math.sin(a) * r1}
        x2={cx + Math.cos(a) * r2}
        y2={cy + Math.sin(a) * r2}
        stroke={RAY}
        strokeWidth={s * 0.032}
        strokeLinecap="round"
      />,
    );
  }
  return (
    <g aria-hidden="true">
      {shape === 'circle' ? (
        <circle cx={cx} cy={y + s / 2} r={s / 2 - 0.5} fill={ICON_BG} stroke={ICON_EDGE} strokeWidth={1} />
      ) : (
        <rect x={x + 0.5} y={y + 0.5} width={s - 1} height={s - 1} rx={s * 0.23} fill={ICON_BG} stroke={ICON_EDGE} strokeWidth={1} />
      )}
      {rays}
      {ARCH.map((col, i) => {
        const r = outer - i * step;
        return (
          <path
            key={col}
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke={col}
            strokeWidth={sw}
            strokeLinecap="round"
          />
        );
      })}
      <rect x={cx - s * 0.22} y={cy + s * 0.09} width={s * 0.44} height={s * 0.065} rx={s * 0.03} fill={WORD} />
    </g>
  );
}

/** A neutral placeholder app icon (for grids, docks, taskbars, share targets). */
export function GhostIcon({
  x,
  y,
  size,
  shape = 'squircle',
  glyph = 0,
}: {
  x: number;
  y: number;
  size: number;
  shape?: 'squircle' | 'circle';
  glyph?: number;
}) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const g = size * 0.17;
  const inner = [
    <circle key="c" cx={cx} cy={cy} r={g} fill="none" stroke={C.borderStrong} strokeWidth={GLYPH} />,
    <rect key="r" x={cx - g} y={cy - g} width={g * 2} height={g * 2} rx={g * 0.4} fill="none" stroke={C.borderStrong} strokeWidth={GLYPH} />,
    <path key="t" d={`M ${cx - g} ${cy + g * 0.8} L ${cx} ${cy - g} L ${cx + g} ${cy + g * 0.8} Z`} fill="none" stroke={C.borderStrong} strokeWidth={GLYPH} strokeLinejoin="round" />,
    <path key="l" d={`M ${cx - g} ${cy - g * 0.5} H ${cx + g} M ${cx - g} ${cy + g * 0.5} H ${cx + g * 0.4}`} stroke={C.borderStrong} strokeWidth={GLYPH} strokeLinecap="round" />,
  ][glyph % 4];
  return (
    <g aria-hidden="true">
      {shape === 'circle' ? (
        <circle cx={cx} cy={cy} r={size / 2} fill={C.surface} stroke={C.border} strokeWidth={STROKE} />
      ) : (
        <rect x={x} y={y} width={size} height={size} rx={size * 0.23} fill={C.surface} stroke={C.border} strokeWidth={STROKE} />
      )}
      {inner}
    </g>
  );
}

/* ── Highlight ────────────────────────────────────────────────────── */

export type Box = { x: number; y: number; w: number; h: number; r?: number };

// Three pulses (4.2s) then the static ring alone: auto-started motion stays under the
// 5s limit of WCAG 2.2.2, so it needs no pause control.
const PULSE_CSS = `
.kafe-art-pulse{animation:kafe-art-pulse 1.4s cubic-bezier(.2,.8,.2,1) 3}
@keyframes kafe-art-pulse{0%{stroke-width:2;opacity:.6}100%{stroke-width:12;opacity:0}}
@media (prefers-reduced-motion: reduce){.kafe-art-pulse{animation:none;opacity:0}}
`;

/**
 * The single "tap / click this" marker of a scene. Renders, in order:
 * soft caramel wash -> the target itself (children) -> caramel ring -> pointer.
 * The pointer sits on the ring's lower-right corner by default, so it never
 * covers the target's label; pass x/y to place it elsewhere.
 */
export function Highlight({
  box,
  pointer,
  children,
  pad = 3,
}: {
  box: Box;
  pointer: { kind: 'tap' | 'cursor'; x?: number; y?: number };
  children: ReactNode;
  pad?: number;
}) {
  const x = box.x - pad;
  const y = box.y - pad;
  const w = box.w + pad * 2;
  const h = box.h + pad * 2;
  const r = (box.r ?? 8) + pad;
  return (
    <g>
      <style>{PULSE_CSS}</style>
      <rect x={x} y={y} width={w} height={h} rx={r} fill={WASH} />
      {children}
      <rect
        className="kafe-art-pulse"
        x={x}
        y={y}
        width={w}
        height={h}
        rx={r}
        fill="none"
        stroke={RING_FALLBACK}
        style={{ stroke: RING }}
        strokeWidth={2}
        opacity={0}
      />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={r}
        fill="none"
        stroke={RING_FALLBACK}
        style={{ stroke: RING }}
        strokeWidth={2.25}
      />
      {pointer.kind === 'tap' ? (
        <Tap x={pointer.x ?? x + w - 3} y={pointer.y ?? y + h - 1} />
      ) : (
        <Cursor x={pointer.x ?? x + w - 7} y={pointer.y ?? y + h - 6} />
      )}
    </g>
  );
}

/** Fingertip touch: solid dot with a ripple ring. */
function Tap({ x, y }: { x: number; y: number }) {
  return (
    <g aria-hidden="true">
      <circle cx={x} cy={y} r={13} fill="none" stroke={RING_FALLBACK} style={{ stroke: RING }} strokeWidth={1.5} opacity={0.7} />
      <circle cx={x} cy={y} r={7.5} fill={C.primary} stroke={C.surface} strokeWidth={2} />
    </g>
  );
}

/** Arrow cursor, tip at (x, y). */
function Cursor({ x, y }: { x: number; y: number }) {
  return (
    <path
      aria-hidden="true"
      transform={`translate(${x} ${y})`}
      d="M0 0 L0 16 L4.3 12.2 L7.2 18.6 L10 17.4 L7.2 11.1 L12.6 11.1 Z"
      fill={C.text}
      stroke={C.surface}
      strokeWidth={1.4}
      strokeLinejoin="round"
    />
  );
}

/* ── Glyphs (generic, no platform logos) ──────────────────────────── */

type GlyphProps = { x: number; y: number; color?: string; s?: number };

const g = (color: string) => ({
  fill: 'none',
  stroke: color,
  strokeWidth: GLYPH,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

/** All glyphs are centred on (x, y) and drawn in a ~14-unit box (scaled by s). */
export const Glyph = {
  back: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => (
    <path d={`M ${x + 3 * s} ${y - 6 * s} L ${x - 3 * s} ${y} L ${x + 3 * s} ${y + 6 * s}`} {...g(color)} />
  ),
  forward: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => (
    <path d={`M ${x - 3 * s} ${y - 6 * s} L ${x + 3 * s} ${y} L ${x - 3 * s} ${y + 6 * s}`} {...g(color)} />
  ),
  reload: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => (
    <g {...g(color)}>
      <path d={`M ${x + 5 * s} ${y - 2.5 * s} A ${5.5 * s} ${5.5 * s} 0 1 0 ${x + 5.2 * s} ${y + 2 * s}`} />
      <path d={`M ${x + 5.4 * s} ${y - 6.5 * s} V ${y - 2.2 * s} H ${x + 1.2 * s}`} />
    </g>
  ),
  /** Monitor with a down arrow — the desktop "install app" button. */
  installPc: ({ x, y, color = C.text, s = 1 }: GlyphProps) => (
    <g {...g(color)}>
      <path d={`M ${x - 2.5 * s} ${y - 5.5 * s} H ${x - 7 * s} V ${y + 3.5 * s} H ${x + 7 * s} V ${y - 5.5 * s} H ${x + 2.5 * s}`} />
      <path d={`M ${x - 3 * s} ${y + 7 * s} H ${x + 3 * s}`} />
      <path d={`M ${x} ${y - 7 * s} V ${y + 0.5 * s} M ${x - 2.6 * s} ${y - 2 * s} L ${x} ${y + 0.5 * s} L ${x + 2.6 * s} ${y - 2 * s}`} />
    </g>
  ),
  /** Square with an arrow going up out of it — "Share". */
  share: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => (
    <g {...g(color)}>
      <path d={`M ${x - 2.5 * s} ${y - 2.5 * s} H ${x - 5.5 * s} V ${y + 7 * s} H ${x + 5.5 * s} V ${y - 2.5 * s} H ${x + 2.5 * s}`} />
      <path d={`M ${x} ${y - 8 * s} V ${y + 2.5 * s} M ${x - 3 * s} ${y - 5 * s} L ${x} ${y - 8 * s} L ${x + 3 * s} ${y - 5 * s}`} />
    </g>
  ),
  book: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => (
    <g {...g(color)}>
      <path d={`M ${x} ${y - 4 * s} C ${x - 2 * s} ${y - 6 * s} ${x - 5 * s} ${y - 6 * s} ${x - 7 * s} ${y - 5 * s} V ${y + 5.5 * s} C ${x - 5 * s} ${y + 4.5 * s} ${x - 2 * s} ${y + 4.5 * s} ${x} ${y + 6 * s} C ${x + 2 * s} ${y + 4.5 * s} ${x + 5 * s} ${y + 4.5 * s} ${x + 7 * s} ${y + 5.5 * s} V ${y - 5 * s} C ${x + 5 * s} ${y - 6 * s} ${x + 2 * s} ${y - 6 * s} ${x} ${y - 4 * s} V ${y + 6 * s}`} />
    </g>
  ),
  tabs: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => (
    <g {...g(color)}>
      <rect x={x - 6 * s} y={y - 3 * s} width={9 * s} height={9 * s} rx={2 * s} />
      <path d={`M ${x - 3 * s} ${y - 6 * s} H ${x + 4 * s} A ${2 * s} ${2 * s} 0 0 1 ${x + 6 * s} ${y - 4 * s} V ${y + 3 * s}`} />
    </g>
  ),
  copy: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => (
    <g {...g(color)}>
      <rect x={x - 3 * s} y={y - 3 * s} width={9 * s} height={9 * s} rx={2 * s} />
      <path d={`M ${x - 6 * s} ${y + 3 * s} V ${y - 4 * s} A ${2 * s} ${2 * s} 0 0 1 ${x - 4 * s} ${y - 6 * s} H ${x + 3 * s}`} />
    </g>
  ),
  /** Plus inside a rounded square — "Add to Home Screen". */
  plusSquare: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => (
    <g {...g(color)}>
      <rect x={x - 6.5 * s} y={y - 6.5 * s} width={13 * s} height={13 * s} rx={3 * s} />
      <path d={`M ${x} ${y - 3.2 * s} V ${y + 3.2 * s} M ${x - 3.2 * s} ${y} H ${x + 3.2 * s}`} />
    </g>
  ),
  star: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => {
    const pts: string[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = (i % 2 === 0 ? 6.5 : 2.8) * s;
      pts.push(`${x + Math.cos(a) * r},${y + Math.sin(a) * r}`);
    }
    return <polygon points={pts.join(' ')} {...g(color)} />;
  },
  download: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => (
    <g {...g(color)}>
      <path d={`M ${x} ${y - 6 * s} V ${y + 2.5 * s} M ${x - 3.5 * s} ${y - 1 * s} L ${x} ${y + 2.5 * s} L ${x + 3.5 * s} ${y - 1 * s}`} />
      <path d={`M ${x - 6 * s} ${y + 6 * s} H ${x + 6 * s}`} />
    </g>
  ),
  info: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => (
    <g {...g(color)}>
      <circle cx={x} cy={y} r={6.5 * s} />
      <path d={`M ${x} ${y - 0.5 * s} V ${y + 3.5 * s} M ${x} ${y - 3.3 * s} V ${y - 3.2 * s}`} />
    </g>
  ),
  /** Phone with a down arrow — Android "Install app". */
  phoneDown: ({ x, y, color = C.text, s = 1 }: GlyphProps) => (
    <g {...g(color)}>
      <path d={`M ${x - 1.5 * s} ${y - 7 * s} H ${x - 5 * s} V ${y + 7 * s} H ${x + 5 * s} V ${y + 1 * s}`} />
      <path d={`M ${x + 3 * s} ${y - 7.5 * s} V ${y - 1.5 * s} M ${x + 0.5 * s} ${y - 4 * s} L ${x + 3 * s} ${y - 1.5 * s} L ${x + 5.5 * s} ${y - 4 * s}`} />
      <path d={`M ${x - 1.5 * s} ${y + 4.5 * s} H ${x + 1.5 * s}`} />
    </g>
  ),
  newTab: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => (
    <g {...g(color)}>
      <rect x={x - 6 * s} y={y - 6 * s} width={12 * s} height={12 * s} rx={2.5 * s} />
      <path d={`M ${x} ${y - 2.8 * s} V ${y + 2.8 * s} M ${x - 2.8 * s} ${y} H ${x + 2.8 * s}`} />
    </g>
  ),
  clock: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => (
    <g {...g(color)}>
      <circle cx={x} cy={y} r={6.5 * s} />
      <path d={`M ${x} ${y - 3.5 * s} V ${y} L ${x + 2.5 * s} ${y + 2 * s}`} />
    </g>
  ),
  kebab: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => (
    <g fill={color}>
      <circle cx={x} cy={y - 5 * s} r={1.7 * s} />
      <circle cx={x} cy={y} r={1.7 * s} />
      <circle cx={x} cy={y + 5 * s} r={1.7 * s} />
    </g>
  ),
  home: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => (
    <path d={`M ${x - 6 * s} ${y - 0.5 * s} L ${x} ${y - 6 * s} L ${x + 6 * s} ${y - 0.5 * s} M ${x - 4.5 * s} ${y - 1.5 * s} V ${y + 6 * s} H ${x + 4.5 * s} V ${y - 1.5 * s}`} {...g(color)} />
  ),
  lock: ({ x, y, color = C.muted, s = 1 }: GlyphProps) => (
    <g {...g(color)}>
      <rect x={x - 4 * s} y={y - 1 * s} width={8 * s} height={6.5 * s} rx={1.5 * s} />
      <path d={`M ${x - 2.5 * s} ${y - 1 * s} V ${y - 3 * s} A ${2.5 * s} ${2.5 * s} 0 0 1 ${x + 2.5 * s} ${y - 3 * s} V ${y - 1 * s}`} />
    </g>
  ),
};

/* ── Frames ───────────────────────────────────────────────────────── */

export const PHONE = { x: 20, w: 240, r: 36, inset: 8, h: 430 } as const;
/** Screen box of the phone (x/w are fixed; y depends on the anchor). */
export function phoneScreen(anchor: 'top' | 'bottom') {
  const bodyY = anchor === 'top' ? 12 : PHONE_VB.h - 12 - PHONE.h;
  return {
    x: PHONE.x + PHONE.inset,
    y: bodyY + PHONE.inset,
    w: PHONE.w - PHONE.inset * 2,
    h: PHONE.h - PHONE.inset * 2,
    bodyY,
  };
}

/**
 * A phone, cropped: `anchor="top"` shows the upper part (status bar visible),
 * `"bottom"` the lower part (toolbar / home indicator visible). The cut edge
 * fades into the page so the crop reads as intentional.
 */
export function PhoneFrame({
  os,
  anchor,
  children,
  screenFill = C.bg,
}: {
  os: 'ios' | 'android';
  anchor: 'top' | 'bottom';
  children: ReactNode;
  screenFill?: string;
}) {
  const id = useSafeId();
  const sc = phoneScreen(anchor);
  const screenR = os === 'ios' ? PHONE.r - PHONE.inset : 24;
  const bodyR = os === 'ios' ? PHONE.r : 32;
  const fadeTop = anchor === 'bottom';
  return (
    <g>
      <defs>
        <clipPath id={`${id}-scr`}>
          <rect x={sc.x} y={sc.y} width={sc.w} height={sc.h} rx={screenR} />
        </clipPath>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          {fadeTop ? (
            <>
              <stop offset="0" stopColor="#fff" stopOpacity={0} />
              <stop offset="0.09" stopColor="#fff" stopOpacity={1} />
              <stop offset="1" stopColor="#fff" stopOpacity={1} />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#fff" stopOpacity={1} />
              <stop offset="0.91" stopColor="#fff" stopOpacity={1} />
              <stop offset="1" stopColor="#fff" stopOpacity={0} />
            </>
          )}
        </linearGradient>
        <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x={0} y={0} width={PHONE_VB.w} height={PHONE_VB.h}>
          <rect x={0} y={0} width={PHONE_VB.w} height={PHONE_VB.h} fill={`url(#${id}-fade)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-mask)`}>
        <rect
          x={PHONE.x}
          y={sc.bodyY}
          width={PHONE.w}
          height={PHONE.h}
          rx={bodyR}
          fill={C.surface2}
          stroke={C.borderStrong}
          strokeWidth={1.5}
        />
        <g clipPath={`url(#${id}-scr)`}>
          <rect x={sc.x} y={sc.y} width={sc.w} height={sc.h} fill={screenFill} />
          {children}
        </g>
        <rect x={sc.x} y={sc.y} width={sc.w} height={sc.h} rx={screenR} fill="none" stroke={C.border} strokeWidth={1} />
      </g>
    </g>
  );
}

/** Status bar (only meaningful with anchor="top"). Time is a neutral numeral. */
export function StatusBar({ os, y, onDark = false }: { os: 'ios' | 'android'; y: number; onDark?: boolean }) {
  const sc = phoneScreen('top');
  const col = onDark ? C.text2 : C.text;
  const cy = y + 14;
  return (
    <g aria-hidden="true">
      {os === 'ios' ? (
        <>
          <Label x={sc.x + 30} y={cy} size={T.meta} weight={600} fill={col}>9:41</Label>
          <rect x={sc.x + sc.w / 2 - 34} y={cy - 9} width={68} height={18} rx={9} fill={C.onAccent} />
        </>
      ) : (
        <>
          <Label x={sc.x + 18} y={cy} size={T.meta} weight={600} fill={col}>9:41</Label>
          <circle cx={sc.x + sc.w / 2} cy={cy} r={5} fill={C.onAccent} />
        </>
      )}
      {/* signal + battery */}
      <rect x={sc.x + sc.w - 52} y={cy - 2} width={3} height={5} rx={1} fill={col} />
      <rect x={sc.x + sc.w - 47} y={cy - 4} width={3} height={7} rx={1} fill={col} />
      <rect x={sc.x + sc.w - 42} y={cy - 6} width={3} height={9} rx={1} fill={col} />
      <rect x={sc.x + sc.w - 34} y={cy - 5} width={18} height={10} rx={3} fill="none" stroke={col} strokeWidth={1.2} />
      <rect x={sc.x + sc.w - 32} y={cy - 3} width={11} height={6} rx={1.5} fill={col} />
    </g>
  );
}

/** A muted, simplified Kafe OS login card — the "page" in browser scenes. */
export function LoginCard({ cx, y, w, faint = true }: { cx: number; y: number; w: number; faint?: boolean }) {
  const x = cx - w / 2;
  const icon = Math.min(36, w * 0.24);
  const op = faint ? 0.75 : 1;
  return (
    <g aria-hidden="true" opacity={op}>
      <rect x={x} y={y} width={w} height={icon + 84} rx={14} fill={C.surface} stroke={C.border} strokeWidth={STROKE} />
      <AppIcon x={cx - icon / 2} y={y + 12} size={icon} />
      <Label x={cx} y={y + icon + 24} size={T.body} weight={600} fill={C.text2} anchor="middle">Kafé OS</Label>
      <rect x={x + 14} y={y + icon + 36} width={w - 28} height={14} rx={7} fill={C.surface2} stroke={C.border} strokeWidth={1} />
      <rect x={x + 14} y={y + icon + 56} width={w - 28} height={16} rx={8} fill={C.border} />
    </g>
  );
}

/** Desktop-window card frame. */
export function Window({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children?: ReactNode }) {
  const id = useSafeId();
  return (
    <g>
      <defs>
        <clipPath id={`${id}-win`}>
          <rect x={x} y={y} width={w} height={h} rx={10} />
        </clipPath>
      </defs>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={C.bg} />
      <g clipPath={`url(#${id}-win)`}>{children}</g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill="none" stroke={C.borderStrong} strokeWidth={STROKE} />
    </g>
  );
}

/** Floating surface (popup, menu, sheet, dialog) with a soft, offset shadow. */
export function Popover({
  x,
  y,
  w,
  h,
  r = 12,
  fill = C.surface,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
  fill?: string;
}) {
  const id = useSafeId();
  return (
    <g>
      <defs>
        <filter id={`${id}-sh`} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#000" floodOpacity="0.16" />
        </filter>
      </defs>
      <rect x={x} y={y} width={w} height={h} rx={r} fill={fill} stroke={C.borderStrong} strokeWidth={STROKE} filter={`url(#${id}-sh)`} />
    </g>
  );
}

/** Fades whatever is underneath toward the page colour (works in both themes). */
export function Veil({ x, y, w, h, opacity = 0.6 }: Box & { opacity?: number }) {
  return <rect x={x} y={y} width={w} height={h} fill={C.bg} opacity={opacity} />;
}

/** Text clipped to a box (for the host string in narrow address bars). */
export function ClippedLabel({
  box,
  x,
  y,
  children,
  size = T.meta,
  fill = C.text2,
  anchor = 'start',
}: {
  box: Box;
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
}) {
  const id = useSafeId();
  return (
    <g>
      <defs>
        <clipPath id={`${id}-clip`}>
          <rect x={box.x} y={box.y} width={box.w} height={box.h} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        <Label x={x} y={y} size={size} fill={fill} anchor={anchor}>{children}</Label>
      </g>
    </g>
  );
}

/** Plain push button. `tone="primary"` = filled, `"ghost"` = outlined, `"text"` = label only. */
export function Button({
  x,
  y,
  w,
  h = 26,
  label,
  tone,
  size = T.body,
}: {
  x: number;
  y: number;
  w: number;
  h?: number;
  label: string;
  tone: 'primary' | 'ghost' | 'text';
  size?: number;
}) {
  const fill = tone === 'primary' ? C.primary : tone === 'ghost' ? C.surface : 'none';
  const stroke = tone === 'ghost' ? C.borderStrong : 'none';
  const fg = tone === 'primary' ? C.onPrimary : tone === 'ghost' ? C.text2 : C.text2;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={h >= 30 ? h / 2 : 8} fill={fill} stroke={stroke} strokeWidth={STROKE} />
      <Label x={x + w / 2} y={y + h / 2} size={size} weight={600} fill={fg} anchor="middle">{label}</Label>
    </g>
  );
}

/** Button width that fits its label. */
export const btnW = (label: string, size: number = T.body, min = 56) => Math.max(min, Math.ceil(textW(label, size, true) + 24));
