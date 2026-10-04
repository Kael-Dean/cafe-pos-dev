'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { setTokens } from '@/lib/token-store';
import { AUTH_LOGIN_PATH, readAndClearLogoutReason } from '@/lib/auth';
import { parseRetryAfter } from '@/lib/api-client';
import { useFadeRise } from '@/lib/motion';
import { useI18n } from '@/lib/i18n';
import { Banner, Button, Input, Keypad, Spinner, type KeypadKey } from '@/components/ui';
import { useOnlineStatus } from '../pwa/offline-indicator';
import Icon from '../icons';
import { InstallEntry } from '../pwa/install-app';
import s from './login/login.module.css';

interface Props { onLogin: () => void; }

/** Non-secret: which store this device belongs to (spec §2.1). */
const STORE_KEY = 'kafe:store-slug';
const PIN_MAX = 6;
const PIN_MIN = 4;

type LoginResult = { ok: true } | { ok: false; status: number; message: string | null; retryAfter: number | null };

/**
 * The one network call of this screen. Same-origin BFF route: the server sets
 * HttpOnly session cookies and never returns tokens, so nothing secret is read
 * or stored here.
 */
async function requestLogin(storeSlug: string, pin: string): Promise<LoginResult> {
  const res = await fetch(AUTH_LOGIN_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_slug: storeSlug, pin }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Envelope {"error": {"code", "message"}} first, FastAPI's bare "detail" second.
    const raw = body?.error?.message ?? body?.detail;
    return {
      ok: false,
      status: res.status,
      message: typeof raw === 'string' && raw ? raw : null,
      retryAfter: res.status === 429 ? parseRetryAfter(res) ?? 60 : null,
    };
  }
  // Values are ignored since the cookie migration; this only notifies auth subscribers.
  setTokens({ access: '' });
  return { ok: true };
}

function readStore(): string {
  if (typeof window === 'undefined') return '';
  try { return localStorage.getItem(STORE_KEY) ?? ''; } catch { return ''; }
}

/**
 * readAndClearLogoutReason() consumes the marker, and StrictMode runs state
 * initialisers twice, so the first answer is cached until the next login.
 */
let logoutReason: string | null | undefined;
function consumeLogoutReason(): string | null {
  if (logoutReason === undefined) logoutReason = typeof window === 'undefined' ? null : readAndClearLogoutReason();
  return logoutReason;
}

export default function LoginScreen({ onLogin }: Props) {
  const { t } = useI18n();
  const online = useOnlineStatus();
  // The screen only renders after mount (page.tsx), so storage is readable here.
  const [storeSlug, setStoreSlug] = useState(readStore);
  const [editingStore, setEditingStore] = useState(() => readStore() === '');
  const [storeDraft, setStoreDraft] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const [expiredNotice, setExpiredNotice] = useState(() => consumeLogoutReason() === 'expired');
  const [cooldown, setCooldown] = useState(0);
  const storeInputRef = useRef<HTMLInputElement>(null);

  // One calm entrance for the first screen of the day (reduced-motion aware).
  const cardRef = useFadeRise({ y: 12, duration: 0.34 });

  // Rate-limit countdown: the pad stays disabled and shows how long is left.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const padDisabled = loading || cooldown > 0 || !online || editingStore;

  const submit = useCallback(async (value: string) => {
    const slug = storeSlug.trim();
    if (!slug || value.length < PIN_MIN || loading || cooldown > 0 || !online) return;
    setLoading(true);
    setError('');
    try {
      const r = await requestLogin(slug, value);
      if (r.ok) {
        try { localStorage.setItem(STORE_KEY, slug); } catch { /* storage blocked */ }
        setExpiredNotice(false);
        logoutReason = undefined; // the next logout may leave a new marker
        onLogin();
        return;
      }
      setPin('');
      setShakeKey((k) => k + 1);
      if (r.retryAfter != null) {
        setCooldown(r.retryAfter);
        setError(t.login.cooldown(r.retryAfter));
      } else {
        setError(r.message ?? t.login.invalid);
      }
    } catch {
      setPin('');
      setError(t.login.genericError);
    } finally {
      setLoading(false);
    }
  }, [storeSlug, loading, cooldown, online, onLogin, t]);

  const onKey = (key: KeypadKey) => {
    if (padDisabled) return;
    if (key === 'enter') { void submit(pin); return; }
    if (key === 'clear') { setPin(''); return; }
    if (key === 'back') { setPin((p) => p.slice(0, -1)); return; }
    if (!/^[0-9]$/.test(key)) return;
    if (error && cooldown === 0) setError('');
    const next = (pin + key).slice(0, PIN_MAX);
    setPin(next);
    if (next.length === PIN_MAX) void submit(next); // 6 digits: no ✓ needed
  };

  const saveStore = () => {
    const slug = storeDraft.trim();
    if (!slug) { storeInputRef.current?.focus(); return; }
    setStoreSlug(slug);
    setEditingStore(false);
    setError('');
  };

  const changeStore = () => {
    setStoreDraft(storeSlug);
    setEditingStore(true);
    setPin('');
    setError('');
    window.setTimeout(() => storeInputRef.current?.focus(), 0);
  };

  const cooldownText = cooldown > 0 ? t.login.cooldown(cooldown) : '';

  return (
    <main className={s.screen}>
      <div ref={cardRef} className={s.column}>
        <header className={s.brand}>
          <div className={s.logo} aria-hidden="true">
            <Icon name="pos" size={32} />
          </div>
          <h1 className={s.title}>Kafé OS</h1>
          <p className={s.subtitle}>{t.login.subtitle}</p>
        </header>

        {!online && <Banner tone="danger" live="alert" title={t.login.offline} detail={t.login.offlineBody} />}
        {expiredNotice && online && <Banner tone="warning" icon="warning" title={t.login.expired} />}

        {editingStore ? (
          <form className={s.storeForm} onSubmit={(e) => { e.preventDefault(); saveStore(); }}>
            <Input
              ref={storeInputRef}
              label={t.login.storeLabel}
              hint={t.login.storeHint}
              placeholder={t.login.storePlaceholder}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              size="lg"
              value={storeDraft}
              onChange={(e) => setStoreDraft(e.target.value)}
            />
            <Button type="submit" variant="primary" size="lg" fullWidth disabled={!storeDraft.trim()}>
              {t.login.storeContinue}
            </Button>
          </form>
        ) : (
          <>
            <div className={s.storeChip}>
              <Icon name="pos" size={16} />
              <span className={s.storeName}>{t.login.storeCurrent(storeSlug)}</span>
              <Button variant="ghost" size="md" onClick={changeStore} disabled={loading}>{t.login.storeChange}</Button>
            </div>

            <div className={s.pinBlock}>
              <span id="login-pin-label" className="sr-only">{t.login.pinLabel}</span>
              <div
                key={shakeKey}
                className={`${s.dots} ${shakeKey > 0 ? s.shake : ''}`}
                role="img"
                aria-labelledby="login-pin-label"
                aria-describedby="login-pin-progress"
              >
                {Array.from({ length: PIN_MAX }, (_, i) => (
                  <span key={i} className={s.dot} data-filled={i < pin.length ? '' : undefined} />
                ))}
              </div>
              <span id="login-pin-progress" className="sr-only" aria-live="polite">{t.login.pinProgress(pin.length)}</span>

              <div className={s.feedback}>
                {loading ? (
                  <span className={s.loading} role="status"><Spinner /> {t.login.submitting}</span>
                ) : error || cooldownText ? (
                  <span className={s.error} role="alert">{cooldownText || error}</span>
                ) : (
                  <span className={s.hint}>{t.login.pinHint}</span>
                )}
              </div>

              <Keypad
                variant="pin"
                onKey={onKey}
                captureKeyboard={!padDisabled}
                disabled={padDisabled}
                showEnter={pin.length >= PIN_MIN && pin.length < PIN_MAX}
                extraKey="clear"
                ariaLabel={t.login.pinPad}
                className={s.pad}
              />
            </div>
          </>
        )}

        {/* A new tablet lands here first — offer install before anyone logs in. */}
        <InstallEntry />
      </div>
    </main>
  );
}
