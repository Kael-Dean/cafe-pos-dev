'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { clearAdminToken } from '@/lib/admin-token';
import { useTheme } from '@/lib/theme';
import Icon, { type IconName } from './ui/icon';
import type { AdminMeResponse } from '@/hooks/use-admin-auth';

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/tenants', label: 'ลูกค้า', icon: 'building' },
  { href: '/packages', label: 'แพ็กเกจ', icon: 'box' },
];

export function AdminShell({ me, children }: { me: AdminMeResponse; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { theme, toggleTheme } = useTheme();

  const logout = () => {
    clearAdminToken();
    qc.clear();
    router.replace('/login');
  };

  return (
    <div style={{ display: 'flex', minHeight: '100dvh' }}>
      <aside
        className="sidebar-surface"
        style={{
          width: 232, flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          padding: 'var(--space-5) var(--space-4)',
          position: 'sticky', top: 0, height: '100dvh',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 var(--space-2)', marginBottom: 'var(--space-6)' }}>
          <span
            aria-hidden
            style={{
              width: 30, height: 30, display: 'grid', placeItems: 'center',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-accent)', color: 'var(--sb-avatar-fg)',
              fontWeight: 'var(--fw-bold)', fontSize: 11, letterSpacing: '0.02em',
            }}
          >
            FRD
          </span>
          <span style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--sb-text-strong)', fontSize: 'var(--fs-14)' }}>
            Control Plane
          </span>
        </div>

        <nav aria-label="เมนูหลัก" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sb-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon name={item.icon} size={17} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: 'var(--space-5)', borderTop: '1px solid var(--sb-divider)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ padding: '0 var(--space-2)', minWidth: 0 }}>
            <p style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--sb-text-strong)', fontSize: 'var(--fs-13)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {me.name}
            </p>
            <p style={{ color: 'var(--sb-text-muted)', fontSize: 'var(--fs-12)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {me.email}
            </p>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="sb-item"
            aria-label={theme === 'dark' ? 'สลับเป็นธีมสว่าง' : 'สลับเป็นธีมมืด'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
            {theme === 'dark' ? 'ธีมสว่าง' : 'ธีมมืด'}
          </button>

          <button type="button" onClick={logout} className="btn btn-sm sb-logout" style={{ width: '100%' }}>
            <Icon name="logout" size={15} />
            ออกจากระบบ
          </button>
        </div>
      </aside>

      <main className="scroll" style={{ flex: 1, minWidth: 0, padding: 'var(--space-8)', maxWidth: 1280 }}>
        {children}
      </main>
    </div>
  );
}
