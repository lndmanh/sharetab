import { describe, expect, test } from 'vitest';
import { parseUploadResponse, uploadError } from './upload-response';

describe('upload response boundary', () => {
  test('accepts an upload receipt', () => {
    expect(parseUploadResponse({ receiptId: 'r1', imagePath: 'receipts/r1.png' })).toEqual({
      receiptId: 'r1',
      imagePath: 'receipts/r1.png',
    });
  });

  test('rejects malformed server responses', () => {
    expect(() => parseUploadResponse({ receiptId: 3 })).toThrow('Invalid upload response');
  });

  test('uses only a string error message', () => {
    expect(uploadError({ error: 3 }, 'Upload failed')).toBe('Upload failed');
  });
});
