import { z } from 'zod';

/** The only currency this app records and displays. */
export const APP_CURRENCY = 'VND' as const;

export const COMMON_CURRENCIES = [{ code: APP_CURRENCY, name: 'Vietnamese Dong', symbol: '₫' }] as const;

export type CurrencyCode = (typeof COMMON_CURRENCIES)[number]['code'];

const isoCurrency = z
  .string()
  .length(3)
  .regex(/^[a-zA-Z]{3}$/)
  .transform((c) => c.toUpperCase())
  .refine((c): c is typeof APP_CURRENCY => c === APP_CURRENCY, { message: 'Only VND is supported' });

export const currencySchema = isoCurrency.default(APP_CURRENCY);
export const optionalCurrencySchema = isoCurrency.optional();

/**
 * Get the display label for a currency code.
 */
export function getCurrencyLabel(code: string): string {
  const upper = code.toUpperCase();
  const found = COMMON_CURRENCIES.find((c) => c.code === upper);
  return found ? `${found.code} - ${found.name}` : upper;
}
