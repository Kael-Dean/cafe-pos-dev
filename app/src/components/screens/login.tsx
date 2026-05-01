'use client';

import { useState, FormEvent } from 'react';
import { setToken } from '@/lib/token-store';
import Icon from '../icons';

interface Props { onLogin: () => void; }

interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export default function LoginScreen({ onLogin }: Props) {
  const [storeSlug, setStoreSlug] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      setToken(data.access_token);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      height: '100vh', width: '100vw',
      background: 'var(--color-bg)',
      display: 'grid', placeItems: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: 400, padding: '0 24px',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20, margin: '0 auto 16px',
            background: 'var(--color-primary)',
            display: 'grid', placeItems: 'center',
          }}>
            <Icon name="pos" size={36} color="white" />
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>Kafé OS</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            กรุณาเข้าสู่ระบบเพื่อดำเนินการต่อ
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
              Store ID
            </label>
            <input
              type="text"
              autoComplete="username"
              placeholder="เช่น suk49"
              value={storeSlug}
              onChange={e => setStoreSlug(e.target.value)}
              style={{
                width: '100%', padding: '12px 14px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 10, fontSize: 15,
                outline: 'none', boxSizing: 'border-box',
                transition: 'border-color 150ms var(--ease-out)',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--color-primary)'}
              onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
              PIN
            </label>
            <input
              type="password"
              autoComplete="current-password"
              inputMode="numeric"
              maxLength={6}
              placeholder="4–6 หลัก"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              style={{
                width: '100%', padding: '12px 14px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 10, fontSize: 22,
                outline: 'none', boxSizing: 'border-box',
                letterSpacing: '0.4em',
                transition: 'border-color 150ms var(--ease-out)',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--color-primary)'}
              onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
            />
          </div>

          {error && (
            <div style={{
              marginBottom: 16, padding: '10px 14px',
              background: 'var(--color-danger-50)',
              border: '1px solid var(--color-danger)',
              borderRadius: 8, fontSize: 13,
              color: 'var(--color-danger)', fontWeight: 500,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit || loading}
            style={{
              width: '100%', padding: '14px',
              background: canSubmit && !loading ? 'var(--color-primary)' : 'var(--color-surface-2)',
              color: canSubmit && !loading ? 'white' : 'var(--color-text-muted)',
              border: 'none', borderRadius: 10,
              fontSize: 15, fontWeight: 700,
              cursor: canSubmit && !loading ? 'pointer' : 'not-allowed',
              transition: 'all 150ms var(--ease-out)',
              marginTop: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => { if (canSubmit && !loading) e.currentTarget.style.background = 'var(--color-primary-700)'; }}
            onMouseLeave={e => { if (canSubmit && !loading) e.currentTarget.style.background = 'var(--color-primary)'; }}
          >
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  );
}
