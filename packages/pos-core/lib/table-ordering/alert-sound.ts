/**
 * The bar's "new order" alert, synthesised with Web Audio (no asset to cache or
 * fail to load). Browsers keep an AudioContext suspended until a user gesture, so
 * `installAudioUnlock()` resumes it on the first tap / key press anywhere and the
 * alert then keeps working while the tablet sits idle (with the screen kept awake
 * by the Wake Lock toggle on the board).
 */

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let unlocked = false;
const listeners = new Set<(u: boolean) => void>();

function getCtx(): Ctx | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch { return null; }
  ctx.onstatechange = () => setUnlocked(ctx?.state === 'running');
  return ctx;
}

function setUnlocked(v: boolean) {
  if (unlocked === v) return;
  unlocked = v;
  for (const l of listeners) l(v);
}

export const isAudioUnlocked = () => unlocked;

export function onAudioUnlockChange(l: (u: boolean) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Resume the context from inside a user gesture. Safe to call repeatedly. */
export async function unlockAudio(): Promise<boolean> {
  const c = getCtx();
  if (!c) return false;
  try {
    if (c.state !== 'running') await c.resume();
    // A one-sample silent buffer is what iOS / Samsung Internet need to "arm" output.
    const buf = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
  } catch { /* stays locked */ }
  setUnlocked(c.state === 'running');
  return c.state === 'running';
}

/**
 * Listens for the first gesture (and every later one while still locked) and
 * resumes audio. Also re-resumes when the page becomes visible again, since some
 * Android browsers suspend the context in the background. Returns a cleanup.
 */
export function installAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onGesture = () => { if (!unlocked || ctx?.state !== 'running') void unlockAudio(); };
  const onVisible = () => { if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') void ctx.resume().catch(() => {}); };
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/**
 * Two rising three-note bursts (~1.3 s) through a compressor so it cuts through
 * bar noise without clipping. Returns false when audio is still locked.
 */
export function playOrderAlert(volume = 0.9): boolean {
  const c = getCtx();
  if (!c) return false;
  if (c.state !== 'running') {
    // Not unlocked by a gesture yet (or suspended in the background): try, but
    // report "not played" so the board keeps showing the unlock prompt.
    void c.resume().catch(() => {});
    return false;
  }

  const out = c.createDynamicsCompressor();
  out.threshold.value = -10;
  out.ratio.value = 6;
  out.connect(c.destination);

  const notes = [880, 1175, 1568]; // A5, D6, G6
  const t0 = c.currentTime + 0.02;
  for (let burst = 0; burst < 2; burst++) {
    notes.forEach((f, i) => {
      const start = t0 + burst * 0.62 + i * 0.16;
      for (const [type, gainMul] of [['square', 0.35], ['triangle', 1]] as const) {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(f, start);
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(volume * gainMul, start + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
        osc.connect(g).connect(out);
        osc.start(start);
        osc.stop(start + 0.26);
      }
    });
  }
  return true;
}

// ── Screen Wake Lock ──────────────────────────────────────────────────────────

interface WakeLockSentinelLike { released: boolean; release: () => Promise<void>; addEventListener: (t: 'release', l: () => void) => void }

export const wakeLockSupported = () =>
  typeof navigator !== 'undefined' && 'wakeLock' in navigator;

/** Requests the screen wake lock; resolves null when refused / unsupported. */
export async function requestWakeLock(onRelease: () => void): Promise<WakeLockSentinelLike | null> {
  if (!wakeLockSupported()) return null;
  try {
    const lock = await (navigator as unknown as { wakeLock: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } })
      .wakeLock.request('screen');
    lock.addEventListener('release', onRelease);
    return lock;
  } catch {
    return null;
  }
}
