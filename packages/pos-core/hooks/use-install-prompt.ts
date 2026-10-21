'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Chromium's install event. Not in lib.dom.d.ts (non-standard), so typed here.
 * https://developer.mozilla.org/docs/Web/API/BeforeInstallPromptEvent
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

/**
 * How this device can install the app — drives which action the install UI shows.
 *
 * - `unknown`          server render / before the first client read; render nothing.
 * - `installed`        already running as an installed app (or just installed).
 * - `chromium-prompt`  the browser handed us an install event: show a real button.
 * - `browser-menu`     installable, but only from the browser's own menu (Chromium
 *                      before/without the event, Samsung Internet, Firefox Android).
 * - `ios`              iPhone / iPad, any browser: Share → Add to Home Screen.
 * - `macos-safari`     Safari on macOS: File → Add to Dock.
 * - `unsupported`      cannot install here (Firefox desktop, in-app browsers such
 *                      as LINE / Facebook): point to a browser that can.
 */
export type InstallPlatform =
  | 'unknown'
  | 'installed'
  | 'chromium-prompt'
  | 'browser-menu'
  | 'ios'
  | 'macos-safari'
  | 'unsupported';

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

// ── Module-level store ──────────────────────────────────────────────────────
// `beforeinstallprompt` fires once, early, and is gone if nobody is listening —
// long before a lazily-loaded screen such as Settings mounts. So the listeners
// are attached as soon as this module is evaluated, and components subscribe to
// the stashed result through useSyncExternalStore.

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedThisSession = false;
let platform: InstallPlatform = 'unknown';
const subscribers = new Set<() => void>();

function isStandalone(): boolean {
  // iOS Safari predates the display-mode media query and exposes its own flag.
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

function classify(): InstallPlatform {
  if (installedThisSession || isStandalone()) return 'installed';
  if (deferredPrompt) return 'chromium-prompt';

  const ua = navigator.userAgent;

  // In-app browsers (LINE is the common one for Thai shops) are webviews with no
  // "add to home screen" of their own.
  if (/\bLine\/|FBAN|FBAV|Instagram|; wv\)/.test(ua)) return 'unsupported';

  // iPadOS 13+ reports itself as a Mac; real Macs have no touch points.
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (isIOS) return 'ios';

  const isChromium = /Chrome\/|Chromium\/|Edg\/|SamsungBrowser\/|OPR\//.test(ua);
  const isFirefox = /Firefox\//.test(ua);
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !isChromium && !isFirefox) return 'macos-safari';
  if (isChromium) return 'browser-menu';
  if (isFirefox && /Android/.test(ua)) return 'browser-menu';
  return 'unsupported';
}

function refresh(): void {
  const next = classify();
  if (next === platform) return;
  platform = next;
  subscribers.forEach((notify) => notify());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep Chrome's own mini-infobar from covering the POS; we offer install from
    // Settings and the login screen instead.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    refresh();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installedThisSession = true;
    refresh();
  });
  // Fires when the page moves into (or out of) the installed app window.
  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  standaloneQuery.addEventListener?.('change', refresh);
  platform = classify();
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

/**
 * Which tab of the illustrated install guide fits this device. Same UA tests as
 * `classify()`, but independent of install state: a device that already has the
 * app, or that is waiting on a prompt, still gets a sensible default tab.
 * Identical to `GuidePlatform` in components/pwa/install-art/scenes.tsx.
 */
export type GuidePlatform = 'pc' | 'ios' | 'mac' | 'android';

function classifyGuide(): GuidePlatform {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  const isChromium = /Chrome\/|Chromium\/|Edg\/|SamsungBrowser\/|OPR\//.test(ua);
  const isFirefox = /Firefox\//.test(ua);
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !isChromium && !isFirefox) return 'mac';
  return 'pc';
}

// The UA never changes within a page, so the guide tab is read once. The server
// (and the first hydration pass) report 'pc'; the dialog that consumes this only
// mounts on a click, long after hydration, so no mismatch is possible.
let guidePlatform: GuidePlatform | null = null;
const noopSubscribe = () => () => {};
const getGuideSnapshot = (): GuidePlatform => (guidePlatform ??= classifyGuide());
const getGuideServerSnapshot = (): GuidePlatform => 'pc';

const getSnapshot = (): InstallPlatform => platform;
const getServerSnapshot = (): InstallPlatform => 'unknown';

async function promptInstall(): Promise<InstallOutcome> {
  const event = deferredPrompt;
  if (!event) return 'unavailable';
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    // An install event can be used once. After a dismissal the platform falls back
    // to `browser-menu` (manual steps) until the browser offers a fresh event.
    deferredPrompt = null;
    if (outcome === 'accepted') installedThisSession = true;
    refresh();
    return outcome;
  } catch {
    deferredPrompt = null;
    refresh();
    return 'unavailable';
  }
}

export function useInstallPrompt() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const guide = useSyncExternalStore(noopSubscribe, getGuideSnapshot, getGuideServerSnapshot);
  const install = useCallback(() => promptInstall(), []);
  return {
    platform: current,
    /** Device family for the illustrated guide's default tab (`pc` on the server). */
    guide,
    isInstalled: current === 'installed',
    /** True when `promptInstall()` will open the browser's native install dialog. */
    canPrompt: current === 'chromium-prompt',
    promptInstall: install,
  };
}
