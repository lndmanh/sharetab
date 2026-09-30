import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { z } from 'zod';
import { getOperator } from '../operator';
import { getDb } from '../db';
import { logger } from '../lib/logger';

export const createTRPCContext = async (opts?: { req?: Request }) => {
  const operator = await getOperator();
  return { operator, db: getDb(), headers: opts?.req?.headers ?? new Headers() };
};

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<TRPCContext>().create({ transformer: superjson });

const loggingMiddleware = t.middleware(async ({ path, type, next, ctx }) => {
  const start = Date.now();
  const result = await next();
  logger[result.ok ? 'info' : 'warn'](result.ok ? 'trpc.ok' : 'trpc.error', {
    path,
    type,
    userId: ctx.operator.user.id,
    durationMs: Date.now() - start,
  });
  return result;
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure.use(loggingMiddleware);
export const protectedProcedure = publicProcedure.use(({ ctx, next }) =>
  next({ ctx: { ...ctx, user: ctx.operator.user } }),
);

export const groupMemberProcedure = protectedProcedure
  .input(z.object({ groupId: z.string() }))
  .use(async ({ ctx, input, next }) => {
    const membership = await ctx.db.groupMember.findUnique({
      where: { userId_groupId: { userId: ctx.user.id, groupId: input.groupId } },
    });
    if (!membership) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this group' });
    return next({ ctx: { ...ctx, membership } });
  });
