'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/admin-api';
import { errorMessage, rateLimitKind } from '@/lib/error-copy';
import { getAdminToken, setAdminToken } from '@/lib/admin-token';
import { loginAdmin } from '@/hooks/use-admin-auth';
import { useSessionExpired } from '@/hooks/use-session-expired';
import { loginSchema, type LoginForm } from '@/lib/schemas';
import { TextField } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Note } from '@/components/ui/layout-bits';
import Icon from '@/components/ui/icon';

/** The per-IP limiter allows 5 attempts per minute; wait out the whole window. */
const IP_COOLDOWN_SECONDS = 60;
/** The per-email throttle locks an account for 15 min and sends no Retry-After. */
const ACCOUNT_COOLDOWN_SECONDS = 15 * 60;

/** "45 วินาที" / "14:03 นาที" — 899 seconds is not a readable countdown. */
function formatCooldown(secs: number): string {
  if (secs < 60) return `${secs} วินาที`;
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} นาที`;
}

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const expired = useSessionExpired();
  const [formError, setFormError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  // Already signed in — skip the form.
  useEffect(() => {
    if (getAdminToken()) router.replace('/tenants');
  }, [router]);

  // Rate-limit countdown. The founders will hit this while testing, so show
  // exactly how long is left instead of a flat "try again later".
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // react-hook-form blocks a second submit while isSubmitting is true, so the
  // cooldown guard is the only extra one needed.
  const onSubmit = handleSubmit(async ({ email, password }) => {
    if (cooldown > 0) return;
    setFormError(null);
    try {
      const token = await loginAdmin(email.trim(), password);
      setAdminToken(token);
      // Never let a previous admin's cached tenants survive a re-login.
      qc.clear();
      router.replace('/tenants');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        // Default an unclassifiable 429 to the account lockout: over-estimating
        // costs an impatient wait, under-estimating tells a locked-out founder
        // "60 seconds" and sends them into 14 more attempts against a 15-min wall.
        const kind = rateLimitKind(err);
        setCooldown(err.retryAfter ?? (kind === 'account' ? ACCOUNT_COOLDOWN_SECONDS : IP_COOLDOWN_SECONDS));
      }
      setFormError(errorMessage(err, 'login'));
    }
  });

  const blocked = cooldown > 0;

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-6)',
        background: 'var(--color-bg)',
      }}
    >
      <div className="rise-in" style={{ width: 'min(400px, 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--space-6)' }}>
          <span
            aria-hidden
            style={{
              width: 34, height: 34, display: 'grid', placeItems: 'center',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-accent)', color: 'var(--color-on-accent)',
              fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-13)', letterSpacing: '0.02em',
            }}
          >
            FRD
          </span>
          <span style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--color-text-secondary)' }}>
            Control Plane
          </span>
        </div>

        <h1 style={{ fontSize: 'var(--fs-24)', fontWeight: 'var(--fw-bold)', letterSpacing: '-0.02em' }}>
          เข้าสู่ระบบ
        </h1>
        <p style={{ marginTop: 6, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
          สำหรับทีม FRD เท่านั้น — บัญชีนี้คนละชุดกับที่ร้านใช้เข้า POS
        </p>

        <form onSubmit={onSubmit} noValidate style={{ marginTop: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {expired && (
            <Note tone="warning">เซสชันก่อนหน้าหมดอายุแล้ว เข้าสู่ระบบอีกครั้ง</Note>
          )}

          <TextField
            label="อีเมล"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoFocus
            required
            error={errors.email?.message}
            {...register('email')}
          />

          <TextField
            label="รหัสผ่าน"
            type="password"
            autoComplete="current-password"
            required
            error={errors.password?.message}
            {...register('password')}
          />

          {formError && (
            <div
              role="alert"
              style={{
                display: 'flex', gap: 10, alignItems: 'flex-start',
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--color-danger-50)',
                border: '1px solid var(--color-danger-fg)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--fs-13)', lineHeight: 1.6,
              }}
            >
              <Icon name="warning" size={16} color="var(--color-danger-fg)" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {formError}
                {blocked && (
                  <>
                    {' '}
                    <span className="num">(รออีก {formatCooldown(cooldown)})</span>
                  </>
                )}
              </span>
            </div>
          )}

          {blocked && (
            // Which limiter fired is a heuristic, so never let a wrong guess lock
            // the only login screen for 15 minutes. The server is still the
            // authority — clicking this just earns another 429 if we guessed right.
            <Button type="button" variant="quiet" size="sm" onClick={() => setCooldown(0)}>
              ลองใหม่เลย
            </Button>
          )}

          <Button type="submit" variant="primary" size="lg" block loading={isSubmitting} disabled={blocked}>
            {blocked ? `รออีก ${formatCooldown(cooldown)}` : 'เข้าสู่ระบบ'}
          </Button>
        </form>

        <p style={{ marginTop: 'var(--space-5)', fontSize: 'var(--fs-12)', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          ลืมรหัสผ่านหรือยังไม่มีบัญชี ต้องให้ทีมหลังบ้านสร้างให้ — ระบบนี้ไม่มีการสมัครเองและยังรีเซ็ตรหัสผ่านเองไม่ได้
        </p>
      </div>
    </main>
  );
}
