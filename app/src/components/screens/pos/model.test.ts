import { describe, expect, it } from 'vitest';
import {
  isSellable, manualDiscountAmount, needsManagerPin, PAY_METHOD_API,
} from './model';
import type { MenuItem } from '@/hooks/use-products';

describe('manualDiscountAmount', () => {
  it('amount kind is capped at the base', () => {
    expect(manualDiscountAmount({ kind: 'amount', value: 30 }, 200)).toBe(30);
    expect(manualDiscountAmount({ kind: 'amount', value: 500 }, 200)).toBe(200);
  });
  it('percent kind rounds to whole baht and clamps at 100%', () => {
    expect(manualDiscountAmount({ kind: 'percent', value: 10 }, 155)).toBe(16); // 15.5 -> 16
    expect(manualDiscountAmount({ kind: 'percent', value: 250 }, 80)).toBe(80);
  });
  it('null, zero, negative value or empty base gives 0', () => {
    expect(manualDiscountAmount(null, 100)).toBe(0);
    expect(manualDiscountAmount({ kind: 'amount', value: 0 }, 100)).toBe(0);
    expect(manualDiscountAmount({ kind: 'amount', value: -5 }, 100)).toBe(0);
    expect(manualDiscountAmount({ kind: 'amount', value: 10 }, 0)).toBe(0);
  });
});

describe('needsManagerPin (more than 10% OR more than 50 baht)', () => {
  it('no discount never needs a PIN', () => expect(needsManagerPin(0, 100)).toBe(false));
  it('over 50 baht needs a PIN even when under 10%', () => expect(needsManagerPin(51, 1000)).toBe(true));
  it('exactly 50 baht on a big bill is allowed', () => expect(needsManagerPin(50, 1000)).toBe(false));
  it('over 10% needs a PIN even when under 50 baht', () => expect(needsManagerPin(11, 100)).toBe(true));
  it('exactly 10% is allowed', () => expect(needsManagerPin(10, 100)).toBe(false));
});

describe('isSellable', () => {
  const item = (over: Partial<MenuItem>): MenuItem => ({
    id: '1', name: 'ลาเต้', nameEn: 'ลาเต้', price: 60, cat: '', hot: false, color: '#000', tag: 'ลา',
    needsModifier: false, productType: 'MADE_TO_ORDER', servingsPerBatch: 1, finishedGoodsItemId: null, imageUrl: null,
    ...over,
  });
  it('hides in-house COMPONENT products and the system table-time product', () => {
    expect(isSellable(item({}), 'ค่าโต๊ะ')).toBe(true);
    expect(isSellable(item({ productType: 'PRODUCED' }), 'ค่าโต๊ะ')).toBe(true);
    expect(isSellable(item({ productType: 'COMPONENT' }), 'ค่าโต๊ะ')).toBe(false);
    expect(isSellable(item({ name: 'ค่าโต๊ะ' }), 'ค่าโต๊ะ')).toBe(false);
  });
});

describe('PAY_METHOD_API', () => {
  it('maps every UI method to the backend enum', () => {
    expect(PAY_METHOD_API).toEqual({ cash: 'CASH', card: 'CARD', qr: 'QR_PROMPTPAY', line: 'LINE_PAY' });
  });
});
