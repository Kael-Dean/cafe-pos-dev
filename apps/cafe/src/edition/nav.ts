import { CORE_NAV, type NavItem } from '@pos/core/edition/nav';

/**
 * Café edition nav = the core nav, unchanged. The core table system (floor, table
 * setup) is included and stays hidden unless the store has a table entitlement.
 */
export const nav: readonly NavItem[] = CORE_NAV;
