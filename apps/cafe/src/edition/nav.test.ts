import { describe, expect, it } from 'vitest';
import { visibleNavSections, FEATURE_BOARDGAME, FEATURE_SELF_ORDERING } from '@pos/core/edition/nav';
import { nav } from './nav';

// The café edition keeps the nav of the pre-split single app (app/src/components/
// app-common.tsx NAV, commit 28029d8) plus the QR order board ('guest-orders'),
// which only `self_ordering` stores see.
const PRE_SPLIT_NAV = [
  'sec-service', 'pos', 'guest-orders', 'kds', 'pre-orders', 'cash', 'receipt-copies',
  'sec-boardgame', 'floor', 'table-setup',
  'sec-kitchen', 'inventory', 'stock-take', 'shopping-list', 'bakery', 'bom', 'catalog',
  'sec-crm', 'promotions', 'members', 'customers', 'sales',
  'sec-manage', 'dashboard', 'reports', 'protocols', 'shifts', 'hr',
  'sec-setup', 'settings', 'hardware', 'recycle-bin',
];

const ids = (role: string, features: string[]) =>
  visibleNavSections(nav, role, features).map((s) => [s.id, s.items.map((i) => i.id)]);

describe('café edition nav', () => {
  it('is the pre-split nav, item for item', () => {
    expect(nav.map((n) => n.id)).toEqual(PRE_SPLIT_NAV);
  });

  it('owner without add-ons: no table section', () => {
    expect(ids('OWNER', [])).toEqual([
      ['sec-service', ['pos', 'kds', 'pre-orders', 'cash', 'receipt-copies']],
      ['sec-kitchen', ['inventory', 'stock-take', 'shopping-list', 'bakery', 'bom', 'catalog']],
      ['sec-crm', ['promotions', 'members', 'customers', 'sales']],
      ['sec-manage', ['dashboard', 'reports', 'protocols', 'shifts', 'hr']],
      ['sec-setup', ['settings', 'hardware', 'recycle-bin']],
    ]);
  });

  it('board-game store: floor + table setup appear (as before the split)', () => {
    const sections = ids('OWNER', [FEATURE_BOARDGAME]);
    expect(sections[1]).toEqual(['sec-boardgame', ['floor', 'table-setup']]);
  });

  it('self-ordering bar: order board + floor + table setup, no board-game items', () => {
    const sections = ids('OWNER', [FEATURE_SELF_ORDERING]);
    expect(sections[0]).toEqual(['sec-service', ['pos', 'guest-orders', 'kds', 'pre-orders', 'cash', 'receipt-copies']]);
    expect(sections[1]).toEqual(['sec-boardgame', ['floor', 'table-setup']]);
    const flat = sections.flatMap(([, items]) => items as string[]);
    expect(flat.some((id) => id.startsWith('bg-'))).toBe(false);
  });

  it('board-game store does not get the QR order board', () => {
    const flat = ids('OWNER', [FEATURE_BOARDGAME]).flatMap(([, items]) => items as string[]);
    expect(flat).not.toContain('guest-orders');
  });

  it('bar staff sees the order board and the floor', () => {
    const flat = ids('BARISTA', [FEATURE_SELF_ORDERING]).flatMap(([, items]) => items as string[]);
    expect(flat).toContain('guest-orders');
    expect(flat).toContain('floor');
    expect(flat).not.toContain('table-setup');
  });

  it('staff never sees admin / owner items', () => {
    const flat = ids('STAFF', [FEATURE_BOARDGAME]).flatMap(([, items]) => items as string[]);
    expect(flat).not.toContain('cash');
    expect(flat).not.toContain('table-setup');
    expect(flat).not.toContain('catalog');
    expect(flat).toContain('floor');
  });
});
