import { describe, expect, it } from 'vitest';
import { mapLiveTable } from './use-floor-live';
import { mapBillPreview } from './use-table-bill';
import { mapBoardOrder } from './use-guest-orders';

describe('/floor/live mapper', () => {
  const guest = { id: 'g1', session_id: 's1', label: 'Nok', status: 'CHECKOUT_REQUESTED', arrived_at: 'x', checkout_requested_at: 'y', left_at: null, unpaid_total: '180.00' };

  it('reads a flat row', () => {
    const t = mapLiveTable({ id: 't5', name: 'T5', zone: null, capacity: 4, session: { id: 's1', opened_at: 'x', party_size: 2, closed_at: null }, guests: [guest], unpaid_total: '540.00', checkout_requested_count: 1 });
    expect(t).toMatchObject({ id: 't5', name: 'T5', unpaidTotal: '540.00', checkoutRequestedCount: 1, session: { id: 's1' } });
    expect(t.guests[0]).toMatchObject({ id: 'g1', label: 'Nok', status: 'CHECKOUT_REQUESTED', unpaidTotal: '180.00' });
  });

  it('reads a nested row and derives the request count', () => {
    const t = mapLiveTable({ table: { id: 't1', name: 'T1', capacity: 2 }, open_session: { id: 's9', guests: [guest], unpaid_total: '90.00' } });
    expect(t).toMatchObject({ id: 't1', name: 'T1', unpaidTotal: '90.00', checkoutRequestedCount: 1 });
    expect(t.guests[0].sessionId).toBe('s1');
  });

  it('free table', () => {
    expect(mapLiveTable({ id: 't2', name: 'T2', session: null, guests: [] })).toMatchObject({ session: null, guests: [], unpaidTotal: '0.00', checkoutRequestedCount: 0 });
  });
});

describe('bill preview mapper', () => {
  it('keeps money as strings and tolerates line field names', () => {
    const b = mapBillPreview({
      lines: [{ order_id: 'o1', product_name: 'Mojito', quantity: 2, line_total: '360.00', guest_id: 'g1' }, { name: 'Soda', amount: '40.00' }],
      fnb_total: '400.00', time_total: '0.00', amount: '400.00', guests_pending_checkout: ['g2', { id: 'g3' }],
    });
    expect(b.amount).toBe('400.00');
    expect(b.lines[0]).toMatchObject({ orderId: 'o1', name: 'Mojito', quantity: 2, amount: '360.00', guestId: 'g1' });
    expect(b.lines[1]).toMatchObject({ orderId: null, name: 'Soda', quantity: 1, amount: '40.00', guestId: null });
    expect(b.guestsPendingCheckout).toEqual(['g2', 'g3']);
  });
});

describe('board order mapper', () => {
  const base = { id: 'o1', order_number: 7, status: 'PENDING', channel: 'DINE_IN', total: '180.00', created_at: '2026-10-18T14:03:11Z' };
  it('guest order: no cashier, note trimmed, modifiers parsed', () => {
    const m = mapBoardOrder({ ...base, session_id: 's1', guest_id: 'g1', created_by_id: null, customer_note: '  less sweet ', items: [{ product_name: 'Mojito', quantity: 1, modifiers_json: { modifiers: [{ id: 'm1', name: '+1 shot' }] } }] });
    expect(m).toMatchObject({ fromGuest: true, note: 'less sweet', sessionId: 's1', items: [{ name: 'Mojito', qty: 1, mods: ['+1 shot'] }] });
  });
  it('walk-up order on a table is not a guest order', () => {
    expect(mapBoardOrder({ ...base, session_id: 's1', guest_id: null, created_by_id: 'u1' })?.fromGuest).toBe(false);
  });
  it('drops statuses that are off the board', () => {
    expect(mapBoardOrder({ ...base, status: 'COMPLETED' })).toBeNull();
    expect(mapBoardOrder({ ...base, status: 'VOID' })).toBeNull();
  });
});
