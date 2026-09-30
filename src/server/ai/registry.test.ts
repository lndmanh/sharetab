import { describe, test, expect, vi, beforeEach } from 'vitest';

function setProviderPriority(value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, 'AI_PROVIDER_PRIORITY');
  } else {
    Reflect.set(process.env, 'AI_PROVIDER_PRIORITY', value);
  }
}

describe('getAIProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  test('defaults to openai when AI_PROVIDER_PRIORITY is not set', async () => {
    setProviderPriority(undefined);
    process.env.OPENAI_API_KEY = 'test-key';
    const { getAIProvider } = await import('./registry');
    const provider = await getAIProvider();
    expect(provider).toBeDefined();
    expect(provider.constructor.name).toBe('OpenAIProvider');
  });

  test('selects openai provider', async () => {
    setProviderPriority('openai');
    process.env.OPENAI_API_KEY = 'test-key';
    const { getAIProvider } = await import('./registry');
    const provider = await getAIProvider();
    expect(provider.constructor.name).toBe('OpenAIProvider');
  });

  test('selects mock provider', async () => {
    setProviderPriority('mock');
    const { getAIProvider } = await import('./registry');
    const provider = await getAIProvider();
    expect(provider.constructor.name).toBe('MockProvider');
  });

  test('openai provider throws without API key', async () => {
    setProviderPriority('openai');
    delete process.env.OPENAI_API_KEY;
    const { getAIProvider } = await import('./registry');
    await expect(getAIProvider()).rejects.toThrow('OPENAI_API_KEY');
  });

  test('silently ignores ocr in priority list', async () => {
    setProviderPriority('openai,ocr');
    process.env.OPENAI_API_KEY = 'test-key';
    const { getAIProvider } = await import('./registry');
    const provider = await getAIProvider();
    expect(provider.constructor.name).toBe('OpenAIProvider');
  });

  test('throws for unknown provider', async () => {
    setProviderPriority('gpt-5-turbo-ultra');
    const { getAIProvider } = await import('./registry');
    await expect(getAIProvider()).rejects.toThrow('Unknown AI provider: "gpt-5-turbo-ultra"');
  });

  test('error message lists available providers', async () => {
    setProviderPriority('invalid');
    const { getAIProvider } = await import('./registry');
    await expect(getAIProvider()).rejects.toThrow('openai, mock');
  });

  test('throws for removed providers', async () => {
    setProviderPriority('openai-codex');
    const { getAIProvider } = await import('./registry');
    await expect(getAIProvider()).rejects.toThrow('Unknown AI provider: "openai-codex"');
  });

  test('throws when AI_PROVIDER_PRIORITY contains only removed providers', async () => {
    setProviderPriority('ocr');
    const { getAIProvider } = await import('./registry');
    await expect(getAIProvider()).rejects.toThrow('resolved to an empty list');
  });
});

describe('getAIProviderWithFallback', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  test('returns empty when openai is unavailable', async () => {
    setProviderPriority('openai');
    process.env.OPENAI_API_KEY = 'test-key';
    const { OpenAIProvider } = await import('./providers/openai');
    vi.spyOn(OpenAIProvider.prototype, 'isAvailable').mockResolvedValue(false);

    const { getAIProvidersWithFallback } = await import('./registry');
    const providers = await getAIProvidersWithFallback();
    expect(providers).toHaveLength(0);
  });

  test('clearCache forces re-evaluation on next call', async () => {
    setProviderPriority('mock');
    const { getAIProviderWithFallback, clearProviderCache } = await import('./registry');

    const first = await getAIProviderWithFallback();
    expect(first.constructor.name).toBe('MockProvider');

    clearProviderCache();
    const second = await getAIProviderWithFallback();
    expect(second.constructor.name).toBe('MockProvider');

    expect(first).not.toBe(second);
  });

  test('cached provider is returned within TTL without re-checking', async () => {
    setProviderPriority('mock');
    const { getAIProviderWithFallback } = await import('./registry');
    const { MockProvider } = await import('./providers/mock');
    const spy = vi.spyOn(MockProvider.prototype, 'isAvailable').mockResolvedValue(true);

    const first = await getAIProviderWithFallback();
    const second = await getAIProviderWithFallback();

    expect(first).toBe(second);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('cache expires after TTL and provider is re-evaluated', async () => {
    setProviderPriority('mock');
    const { MockProvider } = await import('./providers/mock');
    vi.spyOn(MockProvider.prototype, 'isAvailable').mockResolvedValue(true);
    const { getAIProviderWithFallback } = await import('./registry');

    const first = await getAIProviderWithFallback();

    vi.useFakeTimers();
    vi.advanceTimersByTime(61_000);

    const second = await getAIProviderWithFallback();

    expect(first).not.toBe(second);
    expect(second.constructor.name).toBe('MockProvider');

    vi.useRealTimers();
  });

  test('falls through priority list when first provider is unavailable', async () => {
    setProviderPriority('openai,mock');
    process.env.OPENAI_API_KEY = 'test-key';

    const { OpenAIProvider } = await import('./providers/openai');
    vi.spyOn(OpenAIProvider.prototype, 'isAvailable').mockResolvedValue(false);

    const { getAIProviderWithFallback } = await import('./registry');
    const provider = await getAIProviderWithFallback();

    expect(provider.constructor.name).toBe('MockProvider');
  });
});
