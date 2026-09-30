import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  batch: vi.fn(),
  prepare: vi.fn((sql: string) => ({ bind: (...values: unknown[]) => ({ sql, values }) })),
  providers: vi.fn(),
  clearCache: vi.fn(),
}));

vi.mock('cloudflare:workers', () => ({
  env: { RECEIPTS: { get: mocks.get }, DB: { prepare: mocks.prepare, batch: mocks.batch } },
}));
vi.mock('../ai/registry', () => ({
  getAIProvidersWithFallback: mocks.providers,
  clearProviderCache: mocks.clearCache,
}));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const extraction = {
  merchantName: 'Store',
  date: '2026-04-13',
  subtotal: 1000,
  tax: 80,
  tip: 0,
  total: 1080,
  currency: 'VND',
  items: [{ name: 'Item', quantity: 1, unitPrice: 1000, totalPrice: 1000 }],
};

describe('receipt processing on R2 and D1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({ arrayBuffer: async () => new TextEncoder().encode('image').buffer });
    mocks.batch.mockResolvedValue([]);
  });

  test('uses fallback provider and batches item replacement with receipt finalization', async () => {
    const first = { name: 'first', extractReceipt: vi.fn().mockRejectedValue(new Error('unavailable')) };
    const second = { name: 'second', extractReceipt: vi.fn().mockResolvedValue(extraction) };
    mocks.providers.mockResolvedValue([first, second]);
    const { processReceiptImage } = await import('./receipt-processor');

    const result = await processReceiptImage({
      receiptId: 'receipt-1',
      receipt: { imagePath: 'receipts/test.png', mimeType: 'image/png' },
    });

    expect(result.status).toBe('COMPLETED');
    expect(mocks.get).toHaveBeenCalledWith('receipts/test.png');
    expect(first.extractReceipt).toHaveBeenCalledTimes(1);
    expect(second.extractReceipt).toHaveBeenCalledTimes(1);
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.prepare.mock.calls.map(([sql]) => sql)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('DELETE FROM ReceiptItem'),
        expect.stringContaining('INSERT INTO ReceiptItem'),
        expect.stringContaining("UPDATE Receipt SET status = 'COMPLETED'"),
      ]),
    );
  });

  test('does not mutate D1 if no provider can extract the image', async () => {
    mocks.providers.mockResolvedValue([
      { name: 'failed', extractReceipt: vi.fn().mockRejectedValue(new Error('down')) },
    ]);
    const { processReceiptImage } = await import('./receipt-processor');
    await expect(
      processReceiptImage({
        receiptId: 'receipt-2',
        receipt: { imagePath: 'receipts/fail.png', mimeType: 'image/png' },
      }),
    ).rejects.toThrow('Receipt extraction failed');
    expect(mocks.batch).not.toHaveBeenCalled();
  });
});
