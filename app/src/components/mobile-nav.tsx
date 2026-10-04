'use client';

// Phone navigation (< 768px): a bottom tab bar + the "เมนู" sheet that lists every
// screen. Mounted once by app/page.tsx; the desktop Sidebar (app-common.tsx) is
// hidden at this width. Both navs render from the same `useVisibleNav()` data, so
// role / feature gating cannot drift between them.
//
// Styles: globals.css → "Phone shell" (.tabbar*, .navsheet*). The bar's footprint is
// published as --tabbar-h, which .app-main pads by.

import { useEffect, useRef, useState } from 'react';
import Icon from './icons';
import { useVisibleNav, groupOfScreen, type NavItem, type NavSection } from './app-common';
import { useIsPhone } from '@/hooks/use-media-query';
import { useModalA11y } from '@/hooks/use-modal-a11y';
import { useI18n, type Lang } from '@/lib/i18n';
import { useTheme, type Theme } from '@/lib/theme';

/** How many screens get a tab of their own; the last slot is always "เมนู". */
const PRIMARY_TAB_COUNT = 4;

// Order of preference for the primary tabs. Each id is used only if the role can
// actually see that screen; gaps are filled from the rest of the visible nav.
const TAB_PREFERENCE = {
  admin: ['pos', 'kds', 'dashboard', 'inventory'],
  staff: ['pos', 'kds', 'inventory', 'protocols'],
} as const;

/** The screens that get their own tab for this role — always a subset of the visible nav. */
export const primaryTabs = (sections: NavSection[], isAdmin: boolean): NavItem[] => {
  const visible = sections.flatMap((s) => s.items);
  const byId = new Map(visible.map((n) => [n.id, n]));
  const picked: NavItem[] = [];
  for (const id of TAB_PREFERENCE[isAdmin ? 'admin' : 'staff']) {
    const item = byId.get(id);
    if (item) picked.push(item);
  }
  for (const item of visible) {
    if (picked.length >= PRIMARY_TAB_COUNT) break;
    if (!picked.includes(item)) picked.push(item);
  }
  return picked.slice(0, PRIMARY_TAB_COUNT);
};

/**
 * Keyboards that RESIZE the layout viewport (Chrome on Android, with
 * `interactiveWidget: 'resizes-content'`) never trip use-keyboard-inset — that hook
 * watches the VisualViewport, which stays equal to the layout there. Without this a
 * fixed bottom bar rides up on top of the keyboard. So: while a text field has
 * focus and the window is clearly shorter than its tallest height at this width,
 * flag <html data-kb-resized>; globals.css hides the bar and zeroes --tabbar-h.
 */
function useResizedByKeyboard() {
  useEffect(() => {
    const root = document.documentElement;
    let width = window.innerWidth;
    let tallest = window.innerHeight;
    const isTyping = () => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return false;
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
    };
    const update = () => {
      if (window.innerWidth !== width) { width = window.innerWidth; tallest = window.innerHeight; }
      tallest = Math.max(tallest, window.innerHeight);
      root.toggleAttribute('data-kb-resized', isTyping() && tallest - window.innerHeight > 150);
    };
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      root.removeAttribute('data-kb-resized');
    };
  }, []);
}

interface MobileNavProps {
  current: string;
  /** Must be the shell's `navigate()` so the unsaved-changes guard (canLeave) still runs. */
  onNavigate: (id: string) => void;
  onLogout: () => void;
}

export function MobileNav({ current, onNavigate, onLogout }: MobileNavProps) {
  const { t } = useI18n();
  const isPhone = useIsPhone();
  const { sections, role, isAdmin, navLabel } = useVisibleNav();
  const [sheetOpen, setSheetOpen] = useState(false);
  useResizedByKeyboard();

  // Rotating / resizing past the breakpoint while the sheet is open: the sidebar
  // takes over, so the sheet must not be left hanging over it.
  if (!isPhone) {
    if (sheetOpen) setSheetOpen(false);
    return null;
  }

  // Until /auth/me answers, the role is unknown. Show only the two tabs every role
  // has and keep the other slots empty, so no tab changes under a thumb mid-tap.
  const tabs = primaryTabs(sections, isAdmin).slice(0, role ? PRIMARY_TAB_COUNT : 2);
  const placeholders = PRIMARY_TAB_COUNT - tabs.length;
  const tabLabel = (id: string) => (t.tabs as Record<string, string>)[id] ?? navLabel(id);
  const currentHasTab = tabs.some((n) => n.id === current);

  return (
    <>
      <nav className="tabbar" aria-label={t.sidebar.navLabel}>
        {tabs.map((n) => {
          const active = current === n.id;
          return (
            <button
              key={n.id}
              type="button"
              data-tab-id={n.id}
              className={`tabbar-tab${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => onNavigate(n.id)}
            >
              <span className="tabbar-pill"><Icon name={n.icon ?? 'list'} size={22} strokeWidth={active ? 1.9 : 1.6} /></span>
              <span className="tabbar-label">{tabLabel(n.id)}</span>
            </button>
          );
        })}
        {Array.from({ length: placeholders }, (_, i) => <span key={`gap-${i}`} aria-hidden style={{ flex: '1 1 0' }} />)}
        {/* Marked active when the current screen has no tab of its own — it lives in the sheet. */}
        <button
          type="button"
          data-tab-id="menu"
          className={`tabbar-tab${!currentHasTab || sheetOpen ? ' active' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
        >
          <span className="tabbar-pill"><Icon name="menu" size={22} strokeWidth={!currentHasTab || sheetOpen ? 1.9 : 1.6} /></span>
          <span className="tabbar-label">{t.tabs.menu}</span>
        </button>
      </nav>

      {sheetOpen && (
        <NavSheet
          current={current}
          onClose={() => setSheetOpen(false)}
          onNavigate={(id) => { setSheetOpen(false); onNavigate(id); }}
          onLogout={() => { setSheetOpen(false); onLogout(); }}
        />
      )}
    </>
  );
}

interface NavSheetProps {
  current: string;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onLogout: () => void;
}

/**
 * The full nav as a bottom sheet. Mounted only while open, so useModalA11y's
 * mount/unmount lifecycle gives it the focus trap, Escape-to-close and focus
 * restore (back to the "เมนู" tab that opened it).
 */
function NavSheet({ current, onClose, onNavigate, onLogout }: NavSheetProps) {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const { sections, me, initial, roleLabel, navLabel, sectionLabel } = useVisibleNav();
  const dialogRef = useModalA11y(onClose);
  const bodyRef = useRef<HTMLDivElement>(null);
  const currentGroupId = groupOfScreen(current);

  useEffect(() => {
    // Nothing behind the sheet may scroll while it is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Open on "where am I": bring the current screen's row into view.
    bodyRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'center' });
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  const themeOptions: { value: Theme; icon: string; label: string }[] = [
    { value: 'light', icon: 'sun', label: t.settings.themeLight },
    { value: 'dark', icon: 'moon', label: t.settings.themeDark },
  ];
  const langOptions: { value: Lang; short: string; label: string }[] = [
    { value: 'th', short: 'ไทย', label: t.settings.thai },
    { value: 'en', short: 'EN', label: t.settings.english },
  ];
  const meta = [roleLabel, me?.store_name].filter(Boolean).join(' · ');

  return (
    <div className="navsheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.tabs.menuTitle}
        className="navsheet sidebar-surface"
      >
        <div className="navsheet-head">
          <div className="navsheet-avatar" aria-hidden>{initial}</div>
          <div className="navsheet-user">
            <div className="navsheet-name">{me?.name ?? '...'}</div>
            {meta && <div className="navsheet-meta">{meta}</div>}
          </div>
          <button type="button" className="navsheet-close" aria-label={t.tabs.closeMenu} onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>

        <nav ref={bodyRef} className="navsheet-body" aria-label={t.tabs.menuTitle}>
          {sections.map((s) => {
            const headId = `navsheet-${s.id}`;
            return (
              <div key={s.id} className="navsheet-group" role="group" aria-labelledby={headId}>
                <h2 id={headId} className={`navsheet-group-head${s.id === currentGroupId ? ' current' : ''}`}>
                  <span className="sb-group-icon"><Icon name={s.icon ?? 'list'} size={18} strokeWidth={1.75} /></span>
                  <span className="sb-group-label">{sectionLabel(s.id)}</span>
                </h2>
                <div className="sb-group-items">
                  {s.items.map((n) => {
                    const active = current === n.id;
                    return (
                      <button
                        key={n.id}
                        type="button"
                        data-nav-id={n.id}
                        className={`sb-item${active ? ' active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => onNavigate(n.id)}
                      >
                        {n.icon && <Icon name={n.icon} size={18} style={{ flexShrink: 0 }} />}
                        <span className="sb-item-label">{navLabel(n.id)}</span>
                        {n.soft && <span className="navsheet-soft">P1</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="navsheet-foot">
          <div className="navsheet-seg" role="group" aria-label={t.settings.themeTitle}>
            {themeOptions.map((o) => (
              <button key={o.value} type="button" aria-pressed={theme === o.value} aria-label={o.label} onClick={() => setTheme(o.value)}>
                <Icon name={o.icon} size={18} />
              </button>
            ))}
          </div>
          <div className="navsheet-seg" role="group" aria-label={t.settings.languageTitle}>
            {langOptions.map((o) => (
              <button key={o.value} type="button" aria-pressed={lang === o.value} aria-label={o.label} lang={o.value} onClick={() => setLang(o.value)}>
                {o.short}
              </button>
            ))}
          </div>
          <button type="button" className="navsheet-logout" data-action="logout" onClick={onLogout}>
            <Icon name="logout" size={18} />
            {t.sidebar.logout}
          </button>
        </div>
      </div>
    </div>
  );
}
