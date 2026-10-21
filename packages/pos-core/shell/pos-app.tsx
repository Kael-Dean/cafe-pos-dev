'use client';

import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ToastProvider, Sidebar } from '@pos/core/components/app-common';
import { MobileNav } from '@pos/core/components/mobile-nav';
import { getToken, clearToken, subscribeAuth } from '@pos/core/lib/token-store';
import { canLeave } from '@pos/core/lib/nav-guard';
// Login stays static: it is the gate, so it belongs in the first chunk (the POS
// screen, the default, is static in CORE_SCREENS for the same reason).
import LoginScreen from '@pos/core/components/screens/login';
import { EditionProvider } from '@pos/core/edition/context';
import { TableTabProvider } from '@pos/core/hooks/use-table-tab';
import { BarWatcher } from '@pos/core/components/bar/bar-watcher';
import type { EditionConfig } from '@pos/core/edition/types';

/**
 * The whole POS, client-side: login gate, then the shell (sidebar / phone nav +
 * the active screen) for the given edition. Each app's `app/page.tsx` is just
 * `<PosApp edition={edition} />`.
 */
export function PosApp({ edition }: { edition: EditionConfig }) {
  return (
    <EditionProvider edition={edition}>
      <PosRoot edition={edition} />
    </EditionProvider>
  );
}

function PosRoot({ edition }: { edition: EditionConfig }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Lives above the login gate (as before the split): after logout → login the
  // shell reopens on the screen that was showing.
  const [screen, setScreen] = useState<string>(edition.defaultScreen ?? 'pos');
  const queryClient = useQueryClient();

  useEffect(() => {
    setIsLoggedIn(!!getToken());
    setMounted(true);
    // React to mid-session token changes (expiry, cross-tab logout, manual clear).
    const unsub = subscribeAuth(() => {
      setIsLoggedIn(!!getToken());
    });
    return unsub;
  }, []);

  if (!mounted) return null;

  if (!isLoggedIn) {
    return <LoginScreen onLogin={() => {
      // Drop any cache left over from a previous session so /me (and all other
      // user/store-scoped queries) refetch for whoever just logged in.
      queryClient.clear();
      setIsLoggedIn(true);
    }} />;
  }

  return (
    // The table tab lives inside the logged-in tree: logging out unmounts it, so a
    // table's tab can never leak into the next user's session.
    <TableTabProvider>
      <Shell edition={edition} screen={screen} setScreen={setScreen} onLoggedOut={() => setIsLoggedIn(false)} />
    </TableTabProvider>
  );
}

function Shell({ edition, screen, setScreen, onLoggedOut }: {
  edition: EditionConfig;
  screen: string;
  setScreen: (s: string) => void;
  onLoggedOut: () => void;
}) {
  const defaultScreen = edition.defaultScreen ?? 'pos';
  const queryClient = useQueryClient();

  // Let the active screen veto leaving (e.g. BOM Builder with unsaved edits).
  // The check is async because it may show a themed confirm dialog.
  const navigate = async (s: string) => {
    if (s === screen || !(s in edition.screens)) return;
    if (await canLeave()) setScreen(s);
  };
  const go = (s: string) => { void navigate(s); };

  const handleLogout = async () => {
    if (!(await canLeave())) return;
    clearToken();
    queryClient.clear();
    onLoggedOut();
  };

  const Screen = edition.screens[screen] ?? edition.screens[defaultScreen];

  return (
    <ToastProvider>
      {/* .app-shell (globals.css): flex row, height --app-h = 100dvh minus the system
          bar / top safe-area inset, side safe-area insets as padding. */}
      <div className="app-shell">
        {/* ≥ 768px. Below that it is display:none and <MobileNav> is the nav. */}
        <Sidebar current={screen} onNavigate={go} onLogout={() => { void handleLogout(); }} />
        <main className="app-main" style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'auto' }}>
          {/* key={screen} remounts on navigation so the screen fade (.screen-enter,
              opacity only) plays once per switch. ScreenFrame also tags itself
              .screen-switching for the duration of that fade, which suppresses the
              child entrance animations that used to stack on top and read as a
              collapse→expand flicker. */}
          <ScreenFrame key={screen}><Screen navigate={go} /></ScreenFrame>
        </main>
      </div>
      {/* Phones (< 768px): bottom tab bar + menu sheet. Renders nothing on wider
          screens. Goes through the same navigate() / handleLogout() as the sidebar,
          so the unsaved-changes guard applies. .app-main reserves its height
          (--tabbar-h) so no screen content sits behind it. */}
      <MobileNav current={screen} onNavigate={go} onLogout={() => { void handleLogout(); }} />
      {/* Self-ordering stores only: new guest order alert + banner on every screen. */}
      <BarWatcher screen={screen} navigate={go} />
    </ToastProvider>
  );
}

/**
 * Wraps the active screen. Remounted on every navigation (via key={screen} in the
 * parent), so it always starts mid-switch: it carries `.screen-switching` while the
 * one-shot screen fade plays, then drops it once the fade ends. That window is what
 * suppresses the child .rise-in / .fade-in entrances (see globals.css) so switching
 * screens reads as a single calm fade instead of a collapse→expand flicker. After the
 * fade, genuinely new content (e.g. an incoming KDS ticket) animates in normally.
 */
function ScreenFrame({ children }: { children: React.ReactNode }) {
  const [switching, setSwitching] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  // Safety net: onAnimationEnd clears the flag in the normal case. If that event
  // never fires (reduced motion zeroes the duration, or the element is offscreen so
  // the animation is skipped), drop the flag after the fade's worst-case duration so
  // child entrances aren't suppressed forever. The timeout is longer than the
  // 180ms screen-enter fade, so it never pre-empts the real animationend.
  useEffect(() => {
    const id = setTimeout(() => setSwitching(false), 400);
    return () => clearTimeout(id);
  }, []);

  return (
    <div
      ref={ref}
      className={`screen-enter${switching ? ' screen-switching' : ''}`}
      style={{ height: '100%' }}
      onAnimationEnd={(e) => {
        if (e.target === ref.current) setSwitching(false);
      }}
    >
      {children}
    </div>
  );
}
