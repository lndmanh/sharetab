import { describe, expect, test } from 'vitest';
import { isSameOriginWrite } from './same-origin';

describe('same-origin writes', () => {
  test('accepts same-origin POST', () => {
    expect(
      isSameOriginWrite(
        new Request('https://app.example.com/api/upload', {
          method: 'POST',
          headers: { origin: 'https://app.example.com', 'sec-fetch-site': 'same-origin' },
        }),
      ),
    ).toBe(true);
  });
  test('rejects foreign Origin even if fetch-site is absent', () => {
    expect(
      isSameOriginWrite(
        new Request('https://app.example.com/api/upload', {
          method: 'POST',
          headers: { origin: 'https://evil.example' },
        }),
      ),
    ).toBe(false);
  });
  test('rejects cross-site fetch metadata', () => {
    expect(
      isSameOriginWrite(
        new Request('https://app.example.com/api/upload', {
          method: 'POST',
          headers: { 'sec-fetch-site': 'cross-site' },
        }),
      ),
    ).toBe(false);
  });
});
