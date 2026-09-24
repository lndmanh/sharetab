import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { users, authedContext, trpcQuery, trpcMutation, trpcResult } from './helpers';

/**
 * Tests the OpenAI receipt provider via the admin testAIProvider endpoint.
 * Requires RUN_AI_TESTS=1, OPENAI_API_KEY, and a running dev server.
 */

const RECEIPT_PATH = resolve('e2e/receipts/coffee-shop.png');
const AI_TIMEOUT = 150_000;

test.describe('AI Provider Test — admin endpoint', () => {
  test.beforeEach(({}, testInfo) => {
    if (!process.env.RUN_AI_TESTS) testInfo.skip(true, 'Set RUN_AI_TESTS=1 to enable');
  });
  test.setTimeout(AI_TIMEOUT);

  let configuredProviders: string[] = [];

  test.beforeAll(async () => {
    if (!process.env.RUN_AI_TESTS) return;
    const ctx = await authedContext(users.alice.email, users.alice.password);
    try {
      const health = await trpcResult(await trpcQuery(ctx, 'admin.getSystemHealth'));
      configuredProviders = (health.aiProvider as string)?.split(' -> ').filter(Boolean) ?? [];
    } finally {
      await ctx.dispose();
    }
  });

  test('openai provider extracts receipt data', async ({}, testInfo) => {
    if (!configuredProviders.includes('openai')) testInfo.skip(true, 'openai not in AI_PROVIDER_PRIORITY');

    const ctx = await authedContext(users.alice.email, users.alice.password);
    try {
      const imageBuffer = readFileSync(RECEIPT_PATH);
      const res = await trpcMutation(
        ctx,
        'admin.testAIProvider',
        {
          providerName: 'openai',
          imageBase64: imageBuffer.toString('base64'),
          mimeType: 'image/png',
        },
        AI_TIMEOUT,
      );
      const body = await res.json();
      const result = body.result?.data?.json;
      const error = body.error?.json;

      if (result) {
        expect(result.durationMs).toBeGreaterThan(0);
        expect(result.result.items.length).toBeGreaterThanOrEqual(1);
        expect(result.result.total).toBeGreaterThan(0);
      } else {
        expect(error?.message).toBeDefined();
      }
    } finally {
      await ctx.dispose();
    }
  });
});
