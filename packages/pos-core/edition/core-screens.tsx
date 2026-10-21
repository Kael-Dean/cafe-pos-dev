'use client';

import type { ComponentType } from 'react';
import dynamic from 'next/dynamic';
import { Skeleton } from '@pos/core/components/ui/skeleton';
// POS stays static: it is the default screen, so it belongs in the first chunk
// (login is imported statically by the shell). Every other screen is code-split.
import POSTerminal from '@pos/core/components/screens/pos';
import type { ScreenComponent, ScreenProps, ScreenRegistry } from './types';

// Brief fallback while a screen's JS chunk downloads. Screens carry their own
// data-loading skeletons; this only covers the chunk fetch itself.
export function ScreenLoading() {
  return (
    <div aria-busy="true" style={{ height: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Skeleton height={32} width="40%" radius={8} />
      <Skeleton height="60%" radius={12} />
    </div>
  );
}

/**
 * Code-split a screen so the first paint (login → POS) doesn't ship the JS for 20
 * other screens. ssr:false is safe — the shell is client-only and gates its render
 * on `mounted` (so nothing renders server-side anyway). Editions use this for
 * their own screens too.
 */
export const lazyScreen = (
  loader: () => Promise<{ default: ComponentType<ScreenProps> } | { default: ComponentType }>,
): ScreenComponent =>
  dynamic(loader as () => Promise<{ default: ComponentType<ScreenProps> }>, { ssr: false, loading: ScreenLoading });

/** Every screen in CORE_NAV. Editions spread this and add their own ids. */
export const CORE_SCREENS: ScreenRegistry = {
  pos:        POSTerminal,
  floor:      lazyScreen(() => import('@pos/core/components/screens/floor')),
  'table-setup': lazyScreen(() => import('@pos/core/components/screens/table-setup')),
  'guest-orders': lazyScreen(() => import('@pos/core/components/screens/guest-orders')),
  kds:        lazyScreen(() => import('@pos/core/components/screens/kds')),
  dashboard:  lazyScreen(() => import('@pos/core/components/screens/dashboard')),
  bom:        lazyScreen(() => import('@pos/core/components/screens/bom-builder')),
  bakery:     lazyScreen(() => import('@pos/core/components/screens/bakery')),
  inventory:  lazyScreen(() => import('@pos/core/components/screens/inventory')),
  'pre-orders':    lazyScreen(() => import('@pos/core/components/screens/pre-orders')),
  'shopping-list': lazyScreen(() => import('@pos/core/components/screens/shopping-list')),
  'stock-take':    lazyScreen(() => import('@pos/core/components/screens/stock-take')),
  cash:       lazyScreen(() => import('@pos/core/components/screens/cash-reconciliation')),
  'receipt-copies': lazyScreen(() => import('@pos/core/components/screens/receipt-copies')),
  promotions: lazyScreen(() => import('@pos/core/components/screens/promotions')),
  members:    lazyScreen(() => import('@pos/core/components/screens/members')),
  sales:      lazyScreen(() => import('@pos/core/components/screens/sales')),
  protocols:  lazyScreen(() => import('@pos/core/components/screens/protocols')),
  hr:         lazyScreen(() => import('@pos/core/components/screens/hr-dashboard')),
  shifts:     lazyScreen(() => import('@pos/core/components/screens/shift-schedule')),
  hardware:   lazyScreen(() => import('@pos/core/components/screens/hardware')),
  customers:  lazyScreen(() => import('@pos/core/components/screens/placeholders').then((m) => ({ default: m.Customers }))),
  reports:    lazyScreen(() => import('@pos/core/components/screens/reports').then((m) => ({ default: m.Reports }))),
  catalog:    lazyScreen(() => import('@pos/core/components/screens/catalog')),
  'recycle-bin': lazyScreen(() => import('@pos/core/components/screens/recycle-bin')),
  settings:   lazyScreen(() => import('@pos/core/components/screens/settings')),
};
