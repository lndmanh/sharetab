import { env } from 'cloudflare:workers';
import { getDb } from './db';

/** Cloudflare Access gates the Worker; this row is an expense identity, not a login. */
export async function getOperator() {
  const db = getDb();
  const select = { id: true, email: true, name: true, image: true, locale: true } as const;
  const email = env.OWNER_EMAIL;
  let user = await db.user.findUnique({ where: { id: 'owner' }, select });
  if (!user) user = await db.user.findUnique({ where: { email }, select });
  if (!user) {
    try {
      user = await db.user.create({ data: { id: 'owner', email, name: 'Owner' }, select });
    } catch (error) {
      const existing = await db.user.findUnique({ where: { id: 'owner' }, select });
      if (!existing) throw error;
      user = existing;
    }
  }
  return { user };
}
