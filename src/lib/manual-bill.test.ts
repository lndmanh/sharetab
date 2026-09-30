import { describe, expect, test } from 'vitest';
import { createManualBill } from './manual-bill';

describe('createManualBill', () => {
  test('creates one assignable item with a matching total', () => {
    expect(createManualBill('  Dinner  ', '120.50', '10.25', '5.00')).toEqual({
      receiptData: { merchantName: 'Dinner', subtotal: 10525, tax: 1025, tip: 500, total: 12050, currency: 'VND' },
      items: [{ name: 'Dinner', quantity: 1, unitPrice: 10525, totalPrice: 10525 }],
    });
  });

  test('defaults optional tax and tip to zero', () => {
    expect(createManualBill('Lunch', '99', '', '').receiptData).toMatchObject({ subtotal: 9900, total: 9900 });
  });

  test('rejects invalid totals and extras', () => {
    expect(createManualBill('', '10', '', '')).toEqual({ error: 'name' });
    expect(createManualBill('Lunch', '0', '', '')).toEqual({ error: 'total' });
    expect(createManualBill('Lunch', '10', '10', '')).toEqual({ error: 'extras' });
    expect(createManualBill('Lunch', '10', '-1', '')).toEqual({ error: 'extras' });
    expect(createManualBill('Lunch', '10', 'oops', '')).toEqual({ error: 'extras' });
    expect(createManualBill('Lunch', '10.001', '', '')).toEqual({ error: 'total' });
  });
});
