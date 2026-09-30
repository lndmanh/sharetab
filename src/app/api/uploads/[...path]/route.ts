import { env } from 'cloudflare:workers';
import { getDb } from '@/server/db';

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const imagePath = path.join('/');
  if (!/^receipts\/[a-f0-9-]{36}\.(jpg|png|webp|heic)$/.test(imagePath)) {
    return new Response('Not found', { status: 404 });
  }
  const receipt = await getDb().receipt.findFirst({ where: { imagePath }, select: { mimeType: true } });
  if (!receipt) return new Response('Not found', { status: 404 });
  const object = await env.RECEIPTS.get(imagePath);
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, {
    headers: {
      'Content-Type': receipt.mimeType,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
