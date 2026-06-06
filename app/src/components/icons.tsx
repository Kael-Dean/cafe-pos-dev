'use client';

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function Icon({ name, size = 20, color = 'currentColor', strokeWidth = 1.5, className = '', style }: IconProps) {
  const props = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    className, style,
  };
  const paths: Record<string, React.ReactNode> = {
    cart: <><circle cx="9" cy="21" r="1.5"/><circle cx="18" cy="21" r="1.5"/><path d="M3 3h2l3 12h12l2-8H6"/></>,
    star: <path d="M12 3l2.6 5.7 6.2.6-4.7 4.3 1.4 6.2L12 16.9 6.5 19.8l1.4-6.2L3.2 9.3l6.2-.6z"/>,
    flame: <path d="M12 3c2 5 5 5 5 10a5 5 0 1 1-10 0c0-2 1-3 2-4-1 4 3 4 3 0 0-2 0-4 0-6z"/>,
    snowflake: <><path d="M12 2v20M4 6l16 12M4 18l16-12M2 12h20"/></>,
    leaf: <><path d="M11 20A7 7 0 0 1 4 13c0-6 9-9 16-9 0 7-3 16-9 16a7 7 0 0 1-7-7"/><path d="M2 22l9-9"/></>,
    cake: <><path d="M3 21h18M5 21V11h14v10M3 11h18M9 7c0-1 1-1 1-2s-1-1-1-2M14 7c0-1 1-1 1-2s-1-1-1-2"/></>,
    dots: <><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    minus: <path d="M5 12h14"/>,
    x: <path d="M18 6L6 18M6 6l12 12"/>,
    check: <path d="M5 12l5 5 9-11"/>,
    trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></>,
    discount: <><path d="M9 9h.01M15 15h.01"/><path d="M16 8L8 16"/><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></>,
    park: <><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M8 6V4M16 6V4"/></>,
    void: <><circle cx="12" cy="12" r="9"/><path d="M5 5l14 14"/></>,
    cash: <><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M5 9v.01M19 15v.01"/></>,
    card: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></>,
    qr: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v3M14 21h3M21 21h.01M17 17v4"/></>,
    line: <><circle cx="12" cy="12" r="9"/><path d="M7 11v3M10 11v3l3-3v3M16 11v3M14 11h3"/></>,
    chart: <><path d="M3 3v18h18"/><path d="M7 14l4-4 4 3 5-7"/></>,
    bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 21h4"/></>,
    pos: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M7 14h2M11 14h2M15 14h2M7 17h10"/></>,
    kds: <><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>,
    inv: <><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></>,
    customers: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M15 20c0-2 2-3.5 4-3.5s2 1.5 2 3.5"/></>,
    reports: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 13h6M9 17h6M9 9h2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
    chevronLeft: <path d="M15 18l-6-6 6-6"/>,
    chevronRight: <path d="M9 6l6 6-6 6"/>,
    chevronDown: <path d="M6 9l6 6 6-6"/>,
    arrowUp: <><path d="M12 19V5M5 12l7-7 7 7"/></>,
    arrowDown: <><path d="M12 5v14M5 12l7 7 7-7"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    coffee: <><path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z"/><path d="M6 2v3M10 2v3M14 2v3"/></>,
    print: <><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="1"/><path d="M6 17h12v4H6z"/></>,
    success: <><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></>,
    warning: <><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M12 12v5"/></>,
    refresh: <><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></>,
    moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>,
    link: <><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></>,
    tag: <><path d="M12 2H6a2 2 0 0 0-2 2v6l8.59 8.59a2 2 0 0 0 2.82 0l5.18-5.18a2 2 0 0 0 0-2.82z"/><circle cx="8.5" cy="8.5" r="1.5"/></>,
    staff: <><circle cx="12" cy="7" r="4"/><path d="M3 21c0-4.5 4-8 9-8s9 3.5 9 8"/><path d="M16 11l2 4-2 1"/><path d="M8 11l-2 4 2 1"/></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></>,
    gift: <><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></>,
    printer: <><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></>,
    wifi: <><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/></>,
    bluetooth: <path d="M6.5 6.5l11 11L12 23V1l5.5 5.5-11 11"/>,
    usb: <><path d="M12 2v12"/><path d="M9 8l3-6 3 6"/><rect x="9" y="14" width="6" height="6" rx="1"/><path d="M7 20h10"/></>,
  };
  return <svg {...props}>{paths[name] || null}</svg>;
}
