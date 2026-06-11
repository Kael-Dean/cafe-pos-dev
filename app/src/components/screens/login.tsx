'use client';

import { useState, useEffect, FormEvent } from 'react';
import { setTokens } from '@/lib/token-store';
import { readAndClearLogoutReason } from '@/lib/auth';
import { useFadeRise } from '@/lib/motion';
import Icon from '../icons';

interface Props { onLogin: () => void; }

interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--fs-12)', fontWeight: 600, color: 'var(--color-text-secondary)',
  display: 'block', marginBottom: 'var(--space-2)', letterSpacing: '0.03em', textTransform: 'uppercase',
};
const inputBase: React.CSSProperties = {
  width: '100%', padding: '12px var(--space-4)', minHeight: 48,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  outline: 'none', boxSizing: 'border-box',
  color: 'var(--color-text)',
};

export default function LoginScreen({ onLogin }: Props) {
  const [storeSlug, setStoreSlug] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expiredNotice, setExpiredNotice] = useState(false);

  // First screen the client sees — a single calm fade-rise on the whole card is
  // a tasteful entrance here (one-time, not a repeated interaction). Honors
  // prefers-reduced-motion via the hook's matchMedia routing.
  const cardRef = useFadeRise({ y: 12, duration: 0.34 });

  useEffect(() => {
    if (readAndClearLogoutReason() === 'expired') setExpiredNotice(true);
  }, []);

  const canSubmit = storeSlug.trim().length > 0 && pin.length >= 4;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_slug: storeSlug.trim(), pin }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body?.detail ?? 'เข้าสู่ระบบไม่สำเร็จ';
        throw new Error(typeof msg === 'string' ? msg : 'รหัส PIN หรือ Store ID ไม่ถูกต้อง');
      }
      const data: TokenPair = await res.json();
      setTokens({ access: data.access_token, refresh: data.refresh_token });
      setExpiredNotice(false);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      height: '100dvh', width: '100vw',
      background: 'var(--color-bg)',
      display: 'grid', placeItems: 'center',
    }}>
      <div ref={cardRef} style={{
        width: '100%', maxWidth: 400, padding: '0 var(--space-6)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-10)' }}>
          <div style={{
            width: 72, height: 72, borderRadius: 'var(--radius-xl)', margin: '0 auto var(--space-4)',
            background: 'var(--color-primary)',
            display: 'grid', placeItems: 'center',
            boxShadow: 'var(--shadow-md)',
          }}>
            <Icon name="pos" size={36} color="var(--color-text-inverse)" />
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--color-text)' }}>Kafé OS</div>
          <div style={{ fontSize: 'var(--fs-14)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-1)' }}>
            กรุณาเข้าสู่ระบบเพื่อดำเนินการต่อ
          </div>
        </div>

        {/* Session-expired banner */}
        {expiredNotice && (
          <div
            role="status"
            style={{
              marginBottom: 'var(--space-4)', padding: '10px var(--space-4)',
              background: 'var(--color-warning-50)',
              border: '1px solid var(--color-warning)',
              borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-14)',
              color: 'var(--color-warning)', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}
          >
            <Icon name="warning" size={16} color="var(--color-warning)" />
            <span>เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label htmlFor="login-store" style={labelStyle}>Store ID</label>
            <input
              id="login-store"
              className="input-std"
              type="text"
              autoComplete="username"
              placeholder="เช่น suk49"
              value={storeSlug}
              onChange={e => setStoreSlug(e.target.value)}
              style={{ ...inputBase, fontSize: 15 }}
            />
          </div>

          <div style={{ marginBottom: 'var(--space-2)' }}>
            <label htmlFor="login-pin" style={labelStyle}>PIN</label>
            <input
              id="login-pin"
              className="input-std num"
              type="password"
              autoComplete="current-password"
              inputMode="numeric"
              maxLength={6}
              placeholder="4–6 หลัก"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              style={{ ...inputBase, fontSize: 22, letterSpacing: '0.4em' }}
            />
          </div>

          {error && (
            <div
              role="alert"
              style={{
                marginTop: 'var(--space-4)', marginBottom: 'var(--space-2)', padding: '10px var(--space-4)',
                background: 'var(--color-danger-50)',
                border: '1px solid var(--color-danger)',
                borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-14)',
                color: 'var(--color-danger)', fontWeight: 500,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit || loading}
            aria-busy={loading || undefined}
            className="pressable"
            style={{
              width: '100%', padding: '14px', minHeight: 52,
              background: canSubmit && !loading ? 'var(--color-primary)' : 'var(--color-surface-2)',
              color: canSubmit && !loading ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
              border: 'none', borderRadius: 'var(--radius-md)',
              fontSize: 15, fontWeight: 700,
              cursor: canSubmit && !loading ? 'pointer' : 'not-allowed',
              transition: 'background var(--dur-base) var(--ease-out)',
              marginTop: 'var(--space-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => { if (canSubmit && !loading) e.currentTarget.style.background = 'var(--color-primary-700)'; }}
            onMouseLeave={e => { if (canSubmit && !loading) e.currentTarget.style.background = 'var(--color-primary)'; }}
          >
            {loading ? (
              <>
                <span className="spinner" aria-hidden style={{ width: 16, height: 16 }} />
                กำลังเข้าสู่ระบบ...
              </>
            ) : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  );
}
