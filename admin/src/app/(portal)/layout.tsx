'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAdminToken, subscribeAdminAuth } from '@/lib/admin-token';
import { useAdminMe } from '@/hooks/use-admin-auth';
import { AdminShell } from '@/components/admin-shell';
import { SkeletonCard } from '@/components/ui/skeleton';

/**
 * Route guard for everything behind the login.
 *
 * There is no refresh token, so a 401 anywhere is terminal: admin-api clears the
 * token, subscribeAdminAuth fires, and this bounces to /login — including from
 * another tab, via the storage event.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const { data: me, isError } = useAdminMe();

  useEffect(() => {
    const sync = () => setHasToken(getAdminToken() !== null);
    sync();
    return subscribeAdminAuth(sync);
  }, []);

  useEffect(() => {
    if (hasToken === false || isError) router.replace('/login');
  }, [hasToken, isError, router]);

  // hasToken === null is the pre-mount pass: render nothing rather than a
  // signed-out flash.
  if (hasToken !== true || isError) return null;

  if (!me) {
    return (
      <div style={{ padding: 'var(--space-8)', maxWidth: 720 }}>
        <SkeletonCard lines={4} label="กำลังตรวจสอบสิทธิ์" />
      </div>
    );
  }

  return <AdminShell me={me}>{children}</AdminShell>;
}
