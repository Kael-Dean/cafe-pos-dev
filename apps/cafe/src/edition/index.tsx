'use client';

import { defineEdition } from '@pos/core/edition/define';
import { CORE_SCREENS } from '@pos/core/edition/core-screens';
import { FEATURE_SELF_ORDERING } from '@pos/core/edition/nav';
import { brand } from './brand';
import { nav } from './nav';

/**
 * Kafé OS — café edition. Core screens only; no edition plugins. Tables work as
 * plain tabs (no time billing) for stores that have a table entitlement.
 */
export const edition = defineEdition({
  ...brand,
  nav,
  screens: CORE_SCREENS,
  defaultScreen: 'pos',
  features: [FEATURE_SELF_ORDERING],
});
