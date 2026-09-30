import { randomUUID } from 'node:crypto';
import type { AIProvider } from '../ai/provider';
import { getAIProvidersWithFallback, clearProviderCache } from '../ai/registry';
import { logger } from './logger';
import { normalizeDate } from './normalize-date';
import { env } from 'cloudflare:workers';
import { Buffer } from 'node:buffer';
import { requireD1Row, clearD1Guard } from './d1-atomic';

interface ProcessReceiptImageOptions {
  receiptId: string;
  receipt: { imagePath: string; mimeType: string };
  correctionHint?: string;
  logPrefix?: string;
}

/**
 * Shared receipt processing logic used by both authenticated and guest flows.
 * Reads the private R2 image, calls the AI provider, creates receipt items in D1,
 * and updates the receipt record with the extraction result.
 */
export async function processReceiptImage({
  receiptId,
  receipt,
  correctionHint,
  logPrefix = 'receipt',
}: ProcessReceiptImageOptions) {
  const object = await env.RECEIPTS.get(receipt.imagePath);
  if (!object) throw new Error(`Receipt image missing: ${receiptId}`);
  const imageBuffer = Buffer.from(await object.arrayBuffer());

  logger.info(`${logPrefix}.processing`, {
    receiptId,
    imageSize: imageBuffer.length,
    correctionHint: correctionHint ?? null,
  });

  const start = Date.now();
  let provider: AIProvider | null = null;
  let result: Awaited<ReturnType<AIProvider['extractReceipt']>> | null = null;
  let lastError: unknown;

  for (let pass = 0; pass < 2 && !result; pass++) {
    const providers = await getAIProvidersWithFallback();

    for (const candidate of providers) {
      try {
        result = await candidate.extractReceipt(imageBuffer, receipt.mimeType, correctionHint);
        provider = candidate;
        break;
      } catch (err) {
        lastError = err;
        logger.warn(`${logPrefix}.extractFailed`, {
          receiptId,
          provider: candidate.name,
          error: err instanceof Error ? err.message : String(err),
          pass,
        });
      }
    }

    if (!result && pass === 0) {
      // Cache can become stale after auth expiration; refresh once and retry all providers.
      clearProviderCache();
    }
  }

  if (!result || !provider) {
    throw new Error(
      `Receipt extraction failed across configured providers: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
  const extraction = result;
  const usedProvider = provider;

  logger.info(`${logPrefix}.extracted`, {
    receiptId,
    provider: usedProvider.name,
    items: extraction.items.length,
    total: extraction.total,
    durationMs: Date.now() - start,
  });

  const normalizedDate = normalizeDate(extraction.date);

  const extractedData = {
    merchantName: extraction.merchantName,
    date: normalizedDate,
    subtotal: extraction.subtotal,
    tax: extraction.tax,
    tip: extraction.tip,
    total: extraction.total,
    currency: extraction.currency,
  };
  const now = new Date().toISOString();
  await env.DB.batch([
    requireD1Row('SELECT 1 FROM Receipt WHERE id = ? AND status = ?', receiptId, 'PROCESSING'),
    env.DB.prepare('DELETE FROM ReceiptItem WHERE receiptId = ?').bind(receiptId),
    ...extraction.items.map((item, index) =>
      env.DB.prepare(
        `INSERT INTO ReceiptItem
      (id, receiptId, name, quantity, unitPrice, totalPrice, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(randomUUID(), receiptId, item.name, item.quantity, item.unitPrice, item.totalPrice, index),
    ),
    env.DB.prepare(
      `UPDATE Receipt SET status = 'COMPLETED', aiProvider = ?, rawResponse = ?, extractedData = ?,
      updatedAt = ? WHERE id = ? AND status = 'PROCESSING'`,
    ).bind(usedProvider.name, JSON.stringify(extraction), JSON.stringify(extractedData), now, receiptId),
    clearD1Guard(),
  ]);

  return {
    status: 'COMPLETED' as const,
    merchantName: extraction.merchantName,
    date: normalizedDate,
    subtotal: extraction.subtotal,
    tax: extraction.tax,
    tip: extraction.tip,
    total: extraction.total,
    currency: extraction.currency,
    itemCount: extraction.items.length,
  };
}
