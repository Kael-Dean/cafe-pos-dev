'use client';

export type IconName =
  | 'building' | 'store' | 'box' | 'plus' | 'check' | 'x' | 'search'
  | 'warning' | 'info' | 'success' | 'copy' | 'pencil' | 'logout'
  | 'chevronDown' | 'chevronLeft' | 'chevronRight'
  | 'moon' | 'sun' | 'pause' | 'play' | 'lock';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Icons are decorative by default (aria-hidden) — every interactive icon here
   * has a text label or aria-label beside it. Pass a name only for the rare
   * standalone-informative glyph, which exposes it as role="img".
   */
  title?: string;
}

const PATHS: Record<IconName, React.ReactNode> = {
  building: <><path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M15 21V9h4a2 2 0 0 1 2 2v10"/><path d="M9 7h2M9 11h2M9 15h2"/></>,
  store: <><path d="M3 9l1.5-5h15L21 9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 11v10h14V11"/><path d="M10 21v-6h4v6"/></>,
  box: <><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  check: <path d="M5 12l5 5 9-11"/>,
  x: <path d="M18 6L6 18M6 6l12 12"/>,
  search: <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>,
  warning: <><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M12 12v5"/></>,
  success: <><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  pencil: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></>,
  chevronDown: <path d="M6 9l6 6 6-6"/>,
  chevronLeft: <path d="M15 18l-6-6 6-6"/>,
  chevronRight: <path d="M9 6l6 6-6 6"/>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  pause: <><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></>,
  play: <path d="M6 4l14 8-14 8z"/>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
};

export default function Icon({
  name, size = 18, color = 'currentColor', strokeWidth = 1.6, className = '', style, title,
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      {...(title
        ? { role: 'img' as const, 'aria-label': title }
        : { 'aria-hidden': true, focusable: false })}
    >
      {PATHS[name]}
    </svg>
  );
}
