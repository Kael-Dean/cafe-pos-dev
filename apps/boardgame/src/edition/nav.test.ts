import { describe, expect, it } from 'vitest';
import { CORE_NAV, FEATURE_BOARDGAME, FEATURE_SELF_ORDERING, visibleNavSections } from '@pos/core/edition/nav';
import { nav } from './nav';
import { tableTimeProductRule, TABLE_TIME_PRODUCT_NAME } from '../tables/table-time';

const section = (role: string, features: string[], id: string) =>
  visibleNavSections(nav, role, features).find((s) => s.id === id)?.items.map((i) => i.id);

describe('board-game edition nav', () => {
  it('is core nav + the board-game items at the end of the table section', () => {
    const core = CORE_NAV.map((n) => n.id);
    const ids = nav.map((n) => n.id);
    expect(ids.filter((id) => !id.startsWith('bg-'))).toEqual(core);
    expect(ids.slice(ids.indexOf('table-setup') + 1, ids.indexOf('sec-kitchen'))).toEqual([
      'bg-lending', 'bg-reservations', 'bg-library', 'bg-report',
    ]);
  });

  it('owner of a board-game store sees the full board-game section', () => {
    expect(section('OWNER', [FEATURE_BOARDGAME], 'sec-boardgame')).toEqual([
      'floor', 'table-setup', 'bg-lending', 'bg-reservations', 'bg-library', 'bg-report',
    ]);
  });

  it('without the board-game entitlement the board-game items stay hidden', () => {
    expect(section('OWNER', [], 'sec-boardgame')).toBeUndefined();
    // self_ordering only: core tables yes, board-game extras no.
    expect(section('OWNER', [FEATURE_SELF_ORDERING], 'sec-boardgame')).toEqual(['floor', 'table-setup']);
  });

  it('staff: no admin-only items', () => {
    expect(section('STAFF', [FEATURE_BOARDGAME], 'sec-boardgame')).toEqual([
      'floor', 'bg-lending', 'bg-reservations', 'bg-library',
    ]);
  });

  it('every edition-only item carries its own th/en label', () => {
    for (const n of nav.filter((i) => i.id.startsWith('bg-'))) {
      expect(n.label?.th).toBeTruthy();
      expect(n.label?.en).toBeTruthy();
    }
  });
});

describe('table-time product rule', () => {
  it('locks only the exact backend product name', () => {
    const tt = { name: TABLE_TIME_PRODUCT_NAME };
    expect(tableTimeProductRule.hiddenFromSale?.(tt)).toBe(true);
    expect(tableTimeProductRule.systemManaged?.(tt)).toBe(true);
    expect(tableTimeProductRule.hiddenFromRecipes?.(tt)).toBe(true);
    expect(tableTimeProductRule.hiddenFromSale?.({ name: 'ลาเต้' })).toBe(false);
  });
});
