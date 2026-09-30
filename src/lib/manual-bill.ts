import { APP_CURRENCY } from './currencies';
import { MAX_MONEY_CENTS, parseToCents } from './money';

const validAmount = /^\d+(?:\.\d{1,2})?$/;

/** Turn a total-only bill into the same data shape used by scanned receipts. */
export function createManualBill(name: string, totalInput: string, taxInput: string, tipInput: string) {
  const merchantName = name.trim();
  const total = parseToCents(totalInput);
  const tax = taxInput.trim() ? parseToCents(taxInput) : 0;
  const tip = tipInput.trim() ? parseToCents(tipInput) : 0;

  if (!merchantName || merchantName.length > 100) return { error: 'name' as const };
  if (!validAmount.test(totalInput.trim()) || !Number.isSafeInteger(total) || total <= 0 || total > MAX_MONEY_CENTS) {
    return { error: 'total' as const };
  }
  if (
    (taxInput.trim() && !validAmount.test(taxInput.trim())) ||
    (tipInput.trim() && !validAmount.test(tipInput.trim())) ||
    !Number.isSafeInteger(tax) ||
    !Number.isSafeInteger(tip) ||
    tax < 0 ||
    tip < 0 ||
    tax + tip >= total
  ) {
    return { error: 'extras' as const };
  }

  const subtotal = total - tax - tip;
  return {
    receiptData: { merchantName, subtotal, tax, tip, total, currency: APP_CURRENCY },
    items: [{ name: merchantName, quantity: 1, unitPrice: subtotal, totalPrice: subtotal }],
  };
}
