import type { AIProvider } from './provider';

const USER_SELECTABLE_PROVIDERS = ['openai'] as const;
const ALL_PROVIDERS = [...USER_SELECTABLE_PROVIDERS, 'mock'] as const;

type AIProviderName = (typeof ALL_PROVIDERS)[number];
const DEFAULT_PROVIDER_PRIORITY = 'openai';

function isAIProviderName(value: string): value is AIProviderName {
  return ALL_PROVIDERS.includes(value as AIProviderName);
}

function unknownProviderError(name: string): Error {
  return new Error(`Unknown AI provider: "${name}". Available: ${USER_SELECTABLE_PROVIDERS.join(', ')}, mock`);
}

function parseProviderPriority(raw: string): AIProviderName[] {
  const parsed = raw
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
    .filter((name) => name !== 'ocr');

  const deduped: AIProviderName[] = [];
  for (const name of parsed) {
    if (!isAIProviderName(name)) {
      throw unknownProviderError(name);
    }
    if (!deduped.includes(name)) {
      deduped.push(name);
    }
  }

  if (deduped.length === 0) {
    throw new Error(
      `AI_PROVIDER_PRIORITY resolved to an empty list after removing unsupported entries. ` +
        `Configure at least one valid provider: ${USER_SELECTABLE_PROVIDERS.join(', ')}`,
    );
  }

  return deduped;
}

function getConfiguredProviderPriorityInternal(): AIProviderName[] {
  const rawPriority = process.env.AI_PROVIDER_PRIORITY?.trim() || DEFAULT_PROVIDER_PRIORITY;
  return parseProviderPriority(rawPriority);
}

async function createProvider(name: AIProviderName): Promise<AIProvider> {
  switch (name) {
    case 'openai': {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OpenAI provider requires OPENAI_API_KEY');
      }
      const { OpenAIProvider } = await import('./providers/openai');
      return new OpenAIProvider(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL);
    }
    case 'mock': {
      const { MockProvider } = await import('./providers/mock');
      return new MockProvider();
    }
    default:
      throw unknownProviderError(name);
  }
}

export async function createProviderByName(name: string): Promise<AIProvider> {
  if (
    !isAIProviderName(name) ||
    !USER_SELECTABLE_PROVIDERS.includes(name as (typeof USER_SELECTABLE_PROVIDERS)[number])
  ) {
    throw unknownProviderError(name);
  }
  return createProvider(name);
}

export function getConfiguredProviderPriority(): string[] {
  return getConfiguredProviderPriorityInternal();
}

export async function getAIProvider(): Promise<AIProvider> {
  const [first] = getConfiguredProviderPriorityInternal();
  if (!first) {
    throw new Error('AI_PROVIDER_PRIORITY resolved to an empty list');
  }
  return createProvider(first);
}

let cachedProviders: AIProvider[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60_000;

export function clearProviderCache(): void {
  cachedProviders = null;
  cacheExpiry = 0;
}

export async function getAIProvidersWithFallback(): Promise<AIProvider[]> {
  if (cachedProviders && Date.now() < cacheExpiry) {
    return cachedProviders;
  }

  const priority = getConfiguredProviderPriorityInternal();
  const availableProviders: AIProvider[] = [];

  for (const name of priority) {
    try {
      const provider = await createProvider(name);
      if (await provider.isAvailable()) {
        availableProviders.push(provider);
      }
    } catch {
      // Continue trying lower-priority providers.
    }
  }

  cachedProviders = availableProviders;
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return availableProviders;
}

export async function getAIProviderWithFallback(): Promise<AIProvider> {
  const [provider] = await getAIProvidersWithFallback();
  if (!provider) {
    throw new Error('No AI providers available');
  }
  return provider;
}
