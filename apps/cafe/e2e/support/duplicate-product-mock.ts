import type { Route } from '@playwright/test';
import type { Call, MockApi } from './mock-api';

/**
 * Stateful stand-in for handoff duplicate-product/api-handoff.md, layered on MockApi.extra:
 *
 *   POST /products/{id}/duplicate   201 ProductDetail · BARISTA 403 · unknown id 404 NOT_FOUND
 *   GET  /products[?…] · /products/{id} · /products/{id}/steps · /inventory · /modifier-groups
 *        (the recipe screen around it, backed by the same state so the copy shows up)
 *
 * Copy rules as specified: name "Copy of {name}" truncated to 120 chars, all fields copied
 * (is_active too), recipe + modifier-group links + cooking steps cloned, PRODUCED gets a new
 * finished-goods item. Any client-side re-creation (POST /products, PUT recipe / groups /
 * steps) is recorded in `legacyWrites` so the spec can prove the old path is gone.
 */

const STORE_ID = 'store-e2e-1';
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(body) });
const err = (route: Route, status: number, code: string, message: string) => json(route, status, { error: { code, message } });

interface Product {
  id: string; category_id: string | null; name: string; description: string | null; price: string;
  is_active: boolean; product_type: 'MADE_TO_ORDER' | 'PRODUCED' | 'COMPONENT'; servings_per_batch: number;
  finished_goods_item_id: string | null;
  recipe: { id: string; inventory_item_id: string; quantity: string; cost_per_unit: string }[];
  modifier_group_ids: string[];
  steps: string[];
}

export class DuplicateState {
  seq = 0;
  inventory = [
    { id: 'inv-beans', name: 'เมล็ดกาแฟคั่วเข้ม', unit: 'g', stock_on_hand: '5000.000', cost_per_unit: '0.2500', par_level: '1000', category: 'INGREDIENT' },
    { id: 'inv-milk', name: 'นมสด', unit: 'ml', stock_on_hand: '8000.000', cost_per_unit: '0.0600', par_level: '2000', category: 'INGREDIENT' },
  ];
  modifierGroups = [
    { id: 'mg-milk', store_id: STORE_ID, name: 'ชนิดนม', required: false, min_select: 0, max_select: 1, is_active: true,
      modifiers: [{ id: 'mod-oat', name: 'นมโอ๊ต', price_delta: '15.00', is_active: true }] },
  ];
  products: Product[] = [
    {
      id: 'p-latte', category_id: 'cat-coffee', name: 'ลาเต้ร้อน', description: 'ช็อตคู่ นมสด', price: '60.00', is_active: true,
      product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null,
      recipe: [
        { id: 'r1', inventory_item_id: 'inv-beans', quantity: '18.000', cost_per_unit: '0.2500' },
        { id: 'r2', inventory_item_id: 'inv-milk', quantity: '180.000', cost_per_unit: '0.0600' },
      ],
      modifier_group_ids: ['mg-milk'],
      steps: ['สกัดช็อตคู่ 36 ml', 'สตีมนม 65°C', 'เทลาย'],
    },
    {
      id: 'p-americano', category_id: 'cat-coffee', name: 'อเมริกาโน่', description: null, price: '50.00', is_active: true,
      product_type: 'MADE_TO_ORDER', servings_per_batch: 1, finished_goods_item_id: null,
      recipe: [{ id: 'r3', inventory_item_id: 'inv-beans', quantity: '18.000', cost_per_unit: '0.2500' }],
      modifier_group_ids: [], steps: [],
    },
    {
      // 115 chars — the copy name must be cut to exactly 120.
      id: 'p-long', category_id: 'cat-bakery', name: `ครัวซองต์${'เนยสด'.repeat(21)}x`.slice(0, 115), description: null, price: '45.00',
      is_active: true, product_type: 'PRODUCED', servings_per_batch: 12, finished_goods_item_id: 'fg-croissant',
      recipe: [], modifier_group_ids: [], steps: [],
    },
  ];
  duplicateCalls: string[] = [];
  legacyWrites: string[] = [];

  constructor(private api: MockApi) {}

  private read(p: Product) {
    return {
      id: p.id, store_id: STORE_ID, category_id: p.category_id, name: p.name, description: p.description, price: p.price,
      is_active: p.is_active, product_type: p.product_type, servings_per_batch: p.servings_per_batch,
      finished_goods_item_id: p.finished_goods_item_id, image_url: null,
    };
  }

  private detail(p: Product) {
    return {
      ...this.read(p),
      created_at: '2026-06-06T09:41:00Z', updated_at: '2026-06-06T09:41:00Z',
      recipe: p.recipe.map((r) => {
        const inv = this.inventory.find((i) => i.id === r.inventory_item_id)!;
        return { ...r, inventory_item_name: inv.name, unit: inv.unit, stock_on_hand: inv.stock_on_hand, in_use_lot_id: null, cost_source: 'FIFO' };
      }),
      modifier_groups: p.modifier_group_ids.map((id) => {
        const g = this.modifierGroups.find((x) => x.id === id)!;
        return { id: g.id, name: g.name, required: g.required, min_select: g.min_select, max_select: g.max_select, modifiers: g.modifiers };
      }),
    };
  }

  async handle(c: Call, route: Route): Promise<boolean> {
    const { method: m, path: p } = c;
    const manager = this.api.role === 'OWNER' || this.api.role === 'MANAGER';

    const dup = /^\/api\/v1\/products\/([^/]+)\/duplicate$/.exec(p);
    if (m === 'POST' && dup) {
      this.duplicateCalls.push(dup[1]);
      if (!manager) { await err(route, 403, 'FORBIDDEN', 'manager only'); return true; }
      const src = this.products.find((x) => x.id === dup[1]);
      if (!src) { await err(route, 404, 'NOT_FOUND', 'Product not found'); return true; }
      const n = ++this.seq;
      const clone: Product = {
        ...src,
        id: `p-copy-${n}`,
        name: `Copy of ${src.name}`.slice(0, 120),
        recipe: src.recipe.map((r, i) => ({ ...r, id: `r-copy-${n}-${i}` })),
        modifier_group_ids: [...src.modifier_group_ids],
        steps: [...src.steps],
        finished_goods_item_id: src.product_type === 'PRODUCED' ? `fg-copy-${n}` : null,
      };
      this.products.push(clone);
      await json(route, 201, this.detail(clone));
      return true;
    }

    if (m === 'GET' && p === '/api/v1/products') {
      const activeOnly = new URL(`http://x${c.search}`).searchParams.get('is_active') === 'true';
      await json(route, 200, this.products.filter((x) => !activeOnly || x.is_active).map((x) => this.read(x)));
      return true;
    }
    const one = /^\/api\/v1\/products\/([^/]+)$/.exec(p);
    if (m === 'GET' && one && one[1] !== 'deleted') {
      const x = this.products.find((q) => q.id === one[1]);
      if (!x) { await err(route, 404, 'NOT_FOUND', 'no product'); return true; }
      await json(route, 200, this.detail(x));
      return true;
    }
    const steps = /^\/api\/v1\/products\/([^/]+)\/steps$/.exec(p);
    if (m === 'GET' && steps) {
      const x = this.products.find((q) => q.id === steps[1]);
      await json(route, 200, (x?.steps ?? []).map((instruction, i) => ({ id: `${steps[1]}-s${i}`, product_id: steps[1], instruction, sort_order: i })));
      return true;
    }
    if (m === 'GET' && p === '/api/v1/inventory') { await json(route, 200, this.inventory); return true; }
    if (m === 'GET' && p === '/api/v1/modifier-groups') { await json(route, 200, this.modifierGroups); return true; }

    // The old client-side copy: create + PUT recipe / modifier-groups / steps.
    if ((m === 'POST' && p === '/api/v1/products') ||
        (m === 'PUT' && /^\/api\/v1\/products\/[^/]+\/(recipe|modifier-groups|steps)$/.test(p))) {
      this.legacyWrites.push(`${m} ${p}`);
      await err(route, 500, 'UNEXPECTED', 'duplicate must use POST /products/{id}/duplicate');
      return true;
    }
    return false;
  }
}

export function installDuplicate(api: MockApi): DuplicateState {
  const state = new DuplicateState(api);
  api.extra.unshift((c, route) => state.handle(c, route));
  return state;
}
