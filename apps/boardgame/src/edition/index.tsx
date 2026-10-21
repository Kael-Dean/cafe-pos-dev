'use client';

import dynamic from 'next/dynamic';
import { defineEdition } from '@pos/core/edition/define';
import { CORE_SCREENS, lazyScreen } from '@pos/core/edition/core-screens';
import { FEATURE_BOARDGAME } from '@pos/core/edition/nav';
import { tableTimeProductRule } from '@/tables/table-time';
import { useRatePlanBilling } from '@/tables/rate-plan-billing';
import { brand } from './brand';
import { nav } from './nav';

/**
 * Kafé OS — board-game café edition = core + time billing on the core table
 * system (rate plans in table setup, plan picker when opening a table), the
 * table-time product rule, and the board-game screens (planned slots for now).
 */
export const edition = defineEdition({
  ...brand,
  nav,
  screens: {
    ...CORE_SCREENS,
    'bg-lending':      lazyScreen(() => import('@/screens/planned').then((m) => ({ default: m.Lending }))),
    'bg-reservations': lazyScreen(() => import('@/screens/planned').then((m) => ({ default: m.Reservations }))),
    'bg-library':      lazyScreen(() => import('@/screens/planned').then((m) => ({ default: m.Library }))),
    'bg-report':       lazyScreen(() => import('@/screens/planned').then((m) => ({ default: m.BoardgameReport }))),
  },
  defaultScreen: 'pos',
  features: [FEATURE_BOARDGAME],
  productRules: [tableTimeProductRule],
  tables: {
    // Loaded with the table setup screen, not in the first chunk.
    SetupSection: dynamic(() => import('@/tables/rate-plans-section'), { ssr: false }),
    useOpenSessionBilling: useRatePlanBilling,
  },
});
