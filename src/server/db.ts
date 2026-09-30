import { env } from 'cloudflare:workers';
import { PrismaD1 } from '@prisma/adapter-d1';
import { PrismaClient } from '@/generated/prisma/client';

/** Create a D1-backed Prisma client in the current Worker request context. */
export function getDb() {
  return new PrismaClient({ adapter: new PrismaD1(env.DB) });
}

export type AppDb = ReturnType<typeof getDb>;
