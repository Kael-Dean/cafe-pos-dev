'use client';

/**
 * Order alert for the bar tablet: a loud chime + screen wake lock.
 *
 * Browsers only let audio start after a user gesture, so the owner taps "เปิดเสียงแจ้งเตือน"
 * once per page load; that tap creates / resumes the AudioContext, and from then on the
 * chime can fire with nobody touching the tablet. The wake lock keeps the screen on so the
 * tablet does not sleep (a sleeping tablet silences the page). Both are re-acquired when
 * the page returns to the foreground.
 *
 * Wake Lock needs a secure context (https or localhost) — on plain http over the LAN it is
 * reported as 'unsupported' so the UI can say so instead of silently failing.
 */

import { useSyncExternalStore } from 'react';

export type WakeLockState = 'off' | 'on' | 'unsupported';

export interface AlertState {
  /** The owner has tapped the enable button on this page load and audio is running. */
  armed: boolean;
  /** The owner enabled alerts before (localStorage) — after a reload we ask for the tap again. */
  wasEnabled: boolean;
  /** Audio was armed, then the browser suspended it and a tap is needed again. */
  needsTap: boolean;
  wakeLock: WakeLockState;
}

const LS_KEY = 'cafe_pos_order_alert';

function readWasEnabled(): boolean {
  try { return window.localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
}

let state: AlertState = { armed: false, wasEnabled: false, needsTap: false, wakeLock: 'off' };
const listeners = new Set<() => void>();
const SERVER_STATE: AlertState = { armed: false, wasEnabled: false, needsTap: false, wakeLock: 'off' };

function set(patch: Partial<AlertState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

let initDone = false;
function init() {
  if (initDone || typeof window === 'undefined') return;
  initDone = true;
  state = { ...state, wasEnabled: readWasEnabled() };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.armed) return;
    void acquireWakeLock();
    void ctx?.resume().catch(() => {});
  });
}

let ctx: AudioContext | null = null;
let lock: WakeLockSentinel | null = null;

type AudioCtor = typeof AudioContext;
function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

async function acquireWakeLock(): Promise<void> {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) { set({ wakeLock: 'unsupported' }); return; }
  try {
    if (lock && !lock.released) return;
    lock = await navigator.wakeLock.request('screen');
    set({ wakeLock: 'on' });
    lock.addEventListener('release', () => { if (state.armed) set({ wakeLock: 'off' }); });
  } catch {
    // Denied (battery saver / insecure context): report it, never throw into the UI.
    set({ wakeLock: 'unsupported' });
  }
}

/** Two-note doorbell, played twice, ~1.6 s. Loud on purpose: the bar is noisy. */
function ring(c: AudioContext) {
  const notes = [880, 660, 880, 660];
  const t0 = c.currentTime + 0.02;
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    const start = t0 + i * 0.32;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.32);
  });
}

/**
 * MUST be called from a tap/click handler. Unlocks audio, plays a test chime, grabs the
 * wake lock and remembers the choice.
 */
export async function enableAlerts(): Promise<boolean> {
  init();
  const Ctor = audioCtor();
  if (!Ctor) return false;
  try {
    if (!ctx) {
      ctx = new Ctor();
      ctx.onstatechange = () => {
        if (!state.armed) return;
        set({ needsTap: ctx?.state !== 'running' });
      };
    }
    await ctx.resume();
    ring(ctx);
    try { window.localStorage.setItem(LS_KEY, '1'); } catch { /* storage blocked: still works this load */ }
    set({ armed: ctx.state === 'running', wasEnabled: true, needsTap: false });
    await acquireWakeLock();
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

export function disableAlerts(): void {
  try { window.localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  void lock?.release().catch(() => {});
  lock = null;
  void ctx?.suspend().catch(() => {});
  set({ armed: false, wasEnabled: false, needsTap: false, wakeLock: 'off' });
}

/** Ring now. Returns false when audio is not armed (the caller still shows the visual alert). */
export async function playOrderChime(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate([300, 120, 300]); } catch { /* not supported */ }
  }
  if (!ctx || !state.armed) return false;
  try {
    if (ctx.state !== 'running') await ctx.resume();
    if (ctx.state !== 'running') { set({ needsTap: true }); return false; }
    ring(ctx);
    return true;
  } catch {
    set({ needsTap: true });
    return false;
  }
}

function subscribe(cb: () => void) {
  init();
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useAlertState(): AlertState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}
