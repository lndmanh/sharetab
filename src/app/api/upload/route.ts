import { env } from 'cloudflare:workers';
import { randomUUID } from 'node:crypto';
import { getOperator } from '@/server/operator';
import { getDb } from '@/server/db';
import { logger } from '@/server/lib/logger';
import { isSameOriginWrite } from '@/server/lib/same-origin';

const MAX_SIZE = 10 * 1024 * 1024;
const MAX_MULTIPART_SIZE = MAX_SIZE + 1024 * 1024;
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

function detectMimeType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x57 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return 'image/webp';
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = new TextDecoder('ascii').decode(bytes.subarray(8, 12));
    if (['heic', 'heix', 'mif1'].includes(brand)) return 'image/heic';
  }
  return null;
}

export async function POST(request: Request) {
  if (!isSameOriginWrite(request)) return new Response('Forbidden', { status: 403 });
  const isGuest = new URL(request.url).searchParams.get('guest') === 'true';
  const size = Number(request.headers.get('content-length'));
  if (size > MAX_MULTIPART_SIZE) return Response.json({ error: 'File too large' }, { status: 413 });

  const contentType = request.headers.get('content-type');
  if (!contentType?.startsWith('multipart/form-data;')) {
    return Response.json({ error: 'Expected multipart upload' }, { status: 415 });
  }
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: 'No file provided' }, { status: 400 });
  const chunks: ArrayBuffer[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_MULTIPART_SIZE) {
      await reader.cancel();
      return Response.json({ error: 'File too large' }, { status: 413 });
    }
    const copy = new ArrayBuffer(value.byteLength);
    new Uint8Array(copy).set(value);
    chunks.push(copy);
  }

  const operator = await getOperator();
  const boundedRequest = new Request(request.url, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: new Blob(chunks),
  });
  const form = await boundedRequest.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'No file provided' }, { status: 400 });
  if (!MIME_TO_EXT[file.type]) return Response.json({ error: 'Unsupported image type' }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ error: 'File too large' }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (detectMimeType(bytes) !== file.type) return Response.json({ error: 'Invalid image content' }, { status: 400 });

  const imagePath = `receipts/${randomUUID()}.${MIME_TO_EXT[file.type]}`;
  await env.RECEIPTS.put(imagePath, bytes, { httpMetadata: { contentType: file.type } });
  try {
    const receipt = await getDb().receipt.create({
      data: {
        imagePath,
        originalName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        status: 'PENDING',
        uploadedById: operator.user.id,
        isGuest,
      },
    });
    return Response.json({ receiptId: receipt.id, imagePath });
  } catch (error) {
    await env.RECEIPTS.delete(imagePath).catch((cleanupError) => {
      logger.error('upload.orphanCleanupFailed', { imagePath, error: String(cleanupError) });
    });
    logger.error('upload.dbFailed', { error: String(error) });
    return Response.json({ error: 'Failed to save receipt' }, { status: 500 });
  }
}
