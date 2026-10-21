import type { ProductRule } from '@pos/core/edition/types';

/**
 * System-managed catalog product the backend creates the first time a session bills
 * table time, and re-looks-up BY EXACT NAME on every close. Renaming or retiring it
 * silently breaks time billing, and giving it a recipe would deduct stock on every
 * settle — so the UI hides it from ordering and locks it in product admin.
 */
export const TABLE_TIME_PRODUCT_NAME = 'ค่าโต๊ะ (Table time)';

const isTableTime = (p: { name: string }) => p.name === TABLE_TIME_PRODUCT_NAME;

/** Board-game edition product rule: the table-time line is the backend's, not staff's. */
export const tableTimeProductRule: ProductRule = {
  hiddenFromSale: isTableTime,
  systemManaged: isTableTime,
  hiddenFromRecipes: isTableTime,
};
