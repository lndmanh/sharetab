import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../init';
import { locales } from '@/i18n/routing';
import { optionalCurrencySchema } from '@/lib/currencies';
import { stripUndefined } from '../../lib/strip-undefined';

/** Operator profile settings; Cloudflare Access handles authentication. */
export const profileRouter = createTRPCRouter({
  getOperator: protectedProcedure.query(({ ctx }) => ctx.operator),

  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.user.id },
      select: { name: true, email: true, venmoUsername: true, locale: true, defaultCurrency: true },
    });
    if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Operator not found' });
    return user;
  }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).optional(),
        defaultCurrency: optionalCurrencySchema,
        locale: z.enum(locales).optional(),
        venmoUsername: z.string().max(50).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.update({
        where: { id: ctx.user.id },
        data: {
          ...stripUndefined(input),
          ...(input.venmoUsername !== undefined ? { venmoUsername: input.venmoUsername?.trim() || null } : {}),
        },
      });
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        locale: user.locale,
        venmoUsername: user.venmoUsername,
      };
    }),
});
