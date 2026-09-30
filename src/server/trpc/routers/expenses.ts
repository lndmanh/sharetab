import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, groupMemberProcedure } from '../init';
import { SplitMode } from '@/generated/prisma/client';
import { getExchangeRate, convertCents } from '../../lib/exchange-rates';
import { MAX_MONEY_CENTS } from '@/lib/money';
import { APP_CURRENCY, currencySchema, optionalCurrencySchema } from '@/lib/currencies';
import { env } from 'cloudflare:workers';
import { randomUUID } from 'node:crypto';
import { requireD1Row, clearD1Guard } from '../../lib/d1-atomic';

const expenseShareSchema = z.object({
  userId: z.string(),
  amount: z.number().int().nonnegative().max(MAX_MONEY_CENTS),
  shares: z.number().int().optional(),
  percentage: z.number().int().optional(),
});

const expenseSharesArraySchema = z
  .array(expenseShareSchema)
  .min(1)
  .refine((shares) => new Set(shares.map((s) => s.userId)).size === shares.length, {
    message: 'Duplicate user in shares',
  });

const exchangeRateSchema = z.number().positive().finite().max(1_000_000);

export const expensesRouter = createTRPCRouter({
  list: groupMemberProcedure
    .input(
      z.object({
        groupId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const expenses = await ctx.db.expense.findMany({
        where: { groupId: input.groupId },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor } } : {}),
        orderBy: { expenseDate: 'desc' },
        include: {
          paidBy: { select: { id: true, name: true, email: true, image: true } },
          shares: {
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
          },
        },
      });

      let nextCursor: string | undefined;
      if (expenses.length > input.limit) {
        const next = expenses.pop();
        nextCursor = next?.id;
      }

      return { expenses, nextCursor };
    }),

  get: groupMemberProcedure
    .input(z.object({ groupId: z.string(), expenseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const expense = await ctx.db.expense.findUnique({
        where: { id: input.expenseId },
        include: {
          paidBy: { select: { id: true, name: true, email: true, image: true } },
          addedBy: { select: { id: true, name: true, email: true, image: true } },
          shares: {
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
          },
          receipt: true,
        },
      });
      if (!expense || expense.groupId !== input.groupId) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      return expense;
    }),

  create: groupMemberProcedure
    .input(
      z.object({
        groupId: z.string(),
        title: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        amount: z.number().int().positive().max(MAX_MONEY_CENTS),
        currency: currencySchema,
        exchangeRate: exchangeRateSchema.optional(), // manual override
        category: z.string().max(50).optional(),
        expenseDate: z.string().datetime().optional(),
        paidById: z.string(),
        splitMode: z.nativeEnum(SplitMode),
        shares: expenseSharesArraySchema,
        receiptId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Block expenses on archived groups
      const group = await ctx.db.group.findUnique({
        where: { id: input.groupId },
        select: { archivedAt: true, currency: true },
      });
      if (group?.archivedAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot add expenses to an archived group',
        });
      }

      // Validate paidById is a member of the group
      const paidByMember = await ctx.db.groupMember.findFirst({
        where: { groupId: input.groupId, userId: input.paidById },
      });
      if (!paidByMember) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Paid-by user is not a member of this group' });
      }

      // Validate all share userIds are group members
      const shareUserIds = input.shares.map((s) => s.userId);
      const memberCount = await ctx.db.groupMember.count({
        where: { groupId: input.groupId, userId: { in: shareUserIds } },
      });
      if (memberCount !== new Set(shareUserIds).size) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'One or more share users are not members of this group',
        });
      }

      // Validate shares sum equals total (in expense's original currency)
      const sharesSum = input.shares.reduce((sum, s) => sum + s.amount, 0);
      if (sharesSum !== input.amount) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Shares sum (${sharesSum}) does not equal expense amount (${input.amount})`,
        });
      }

      // Currency conversion: compute base currency amount if currencies differ
      let exchangeRate: number | null = null;
      let baseCurrencyAmount: number | null = null;

      const groupCurrency = group?.currency ?? APP_CURRENCY;
      if (input.currency.toUpperCase() !== groupCurrency.toUpperCase()) {
        if (input.exchangeRate) {
          // Manual override
          exchangeRate = input.exchangeRate;
        } else {
          // Auto-fetch from frankfurter.app
          const dateStr = input.expenseDate
            ? input.expenseDate.slice(0, 10) // YYYY-MM-DD from ISO string
            : undefined;
          exchangeRate = await getExchangeRate(input.currency, groupCurrency, dateStr);
        }

        if (exchangeRate === null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Could not fetch exchange rate. Please provide a manual rate or try again.',
          });
        }

        baseCurrencyAmount = convertCents(input.amount, exchangeRate);
      }

      const expenseId = randomUUID();
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO Expense (id, groupId, title, description, amount, currency, exchangeRate,
          baseCurrencyAmount, category, expenseDate, paidById, addedById, splitMode, receiptId, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          expenseId,
          input.groupId,
          input.title,
          input.description ?? null,
          input.amount,
          input.currency,
          exchangeRate ?? 1,
          baseCurrencyAmount,
          input.category ?? null,
          input.expenseDate ?? now,
          input.paidById,
          ctx.user.id,
          input.splitMode,
          input.receiptId ?? null,
          now,
          now,
        ),
        ...input.shares.map((share) =>
          env.DB.prepare(
            `INSERT INTO ExpenseShare
          (id, expenseId, userId, amount, shares, percentage) VALUES (?, ?, ?, ?, ?, ?)`,
          ).bind(randomUUID(), expenseId, share.userId, share.amount, share.shares ?? 1, share.percentage ?? null),
        ),
        env.DB.prepare(
          `INSERT INTO ActivityLog (id, groupId, userId, type, entityId, metadata, createdAt)
          VALUES (?, ?, ?, 'EXPENSE_CREATED', ?, ?, ?)`,
        ).bind(
          randomUUID(),
          input.groupId,
          ctx.user.id,
          expenseId,
          JSON.stringify({ title: input.title, amount: input.amount }),
          now,
        ),
      ]);
      return ctx.db.expense.findUniqueOrThrow({ where: { id: expenseId }, include: { shares: true } });
    }),

  update: groupMemberProcedure
    .input(
      z
        .object({
          groupId: z.string(),
          expenseId: z.string(),
          title: z.string().min(1).max(200).optional(),
          description: z.string().max(1000).optional(),
          amount: z.number().int().positive().max(MAX_MONEY_CENTS).optional(),
          currency: optionalCurrencySchema,
          exchangeRate: exchangeRateSchema.optional(), // manual override
          category: z.string().max(50).optional(),
          expenseDate: z.string().datetime().optional(),
          paidById: z.string().optional(),
          splitMode: z.nativeEnum(SplitMode).optional(),
          shares: expenseSharesArraySchema.optional(),
        })
        .refine((data) => !data.amount || data.shares, {
          message: 'Shares are required when updating the amount',
          path: ['shares'],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      // Block updates on archived groups
      const groupCheck = await ctx.db.group.findUnique({
        where: { id: input.groupId },
        select: { archivedAt: true, currency: true },
      });
      if (groupCheck?.archivedAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot modify expenses in an archived group',
        });
      }

      const existing = await ctx.db.expense.findUnique({
        where: { id: input.expenseId },
      });
      if (!existing || existing.groupId !== input.groupId) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      const isOwnerOrAdmin = ctx.membership.role === 'OWNER' || ctx.membership.role === 'ADMIN';
      const isCreatorOrPayer = existing.paidById === ctx.user.id || existing.addedById === ctx.user.id;
      if (!isOwnerOrAdmin && !isCreatorOrPayer) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the expense creator, payer, or group owner/admin can modify this expense',
        });
      }

      // Validate paidById is a member of the group (if provided)
      if (input.paidById) {
        const paidByMember = await ctx.db.groupMember.findFirst({
          where: { groupId: input.groupId, userId: input.paidById },
        });
        if (!paidByMember) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Paid-by user is not a member of this group' });
        }
      }

      const { groupId, expenseId, shares, currency: inputCurrency, exchangeRate: inputExchangeRate, ...data } = input;

      if (shares) {
        // Validate all share userIds are group members
        const shareUserIds = shares.map((s) => s.userId);
        const memberCount = await ctx.db.groupMember.count({
          where: { groupId, userId: { in: shareUserIds } },
        });
        if (memberCount !== new Set(shareUserIds).size) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'One or more share users are not members of this group',
          });
        }

        const expectedAmount = data.amount ?? existing.amount;
        const sharesSum = shares.reduce((sum, s) => sum + s.amount, 0);
        if (sharesSum !== expectedAmount) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Shares sum (${sharesSum}) does not equal expense amount (${expectedAmount})`,
          });
        }
      }

      // Recompute currency conversion if currency or amount changed
      const effectiveCurrency = inputCurrency ?? existing.currency;
      const effectiveAmount = data.amount ?? existing.amount;
      const groupCurrency = groupCheck?.currency ?? APP_CURRENCY;
      let newExchangeRate: number | null = existing.exchangeRate;
      let newBaseCurrencyAmount: number | null = existing.baseCurrencyAmount;

      if (effectiveCurrency.toUpperCase() !== groupCurrency.toUpperCase()) {
        if (inputExchangeRate) {
          newExchangeRate = inputExchangeRate;
        } else if (inputCurrency || data.amount || data.expenseDate) {
          // Currency, amount, or date changed -- re-fetch rate
          const dateStr = (data.expenseDate ?? existing.expenseDate.toISOString()).slice(0, 10);
          const fetched = await getExchangeRate(effectiveCurrency, groupCurrency, dateStr);
          if (fetched === null) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Could not fetch exchange rate. Please provide a manual rate or try again.',
            });
          }
          newExchangeRate = fetched;
        }
        newBaseCurrencyAmount = newExchangeRate ? convertCents(effectiveAmount, newExchangeRate) : null;
      } else {
        // Same currency as group -- clear conversion fields
        newExchangeRate = 1.0;
        newBaseCurrencyAmount = null;
      }

      const now = new Date().toISOString();
      await env.DB.batch([
        requireD1Row(
          'SELECT 1 FROM Expense WHERE id = ? AND groupId = ? AND revision = ?',
          expenseId,
          groupId,
          existing.revision,
        ),
        env.DB.prepare(
          `UPDATE Expense SET title = ?, description = ?, amount = ?, currency = ?, exchangeRate = ?,
          baseCurrencyAmount = ?, category = ?, expenseDate = ?, paidById = ?, splitMode = ?, updatedAt = ?, revision = revision + 1
          WHERE id = ? AND groupId = ? AND revision = ?`,
        ).bind(
          data.title ?? existing.title,
          data.description ?? existing.description,
          effectiveAmount,
          effectiveCurrency,
          newExchangeRate ?? 1,
          newBaseCurrencyAmount,
          data.category ?? existing.category,
          data.expenseDate ?? existing.expenseDate.toISOString(),
          data.paidById ?? existing.paidById,
          data.splitMode ?? existing.splitMode,
          now,
          expenseId,
          groupId,
          existing.revision,
        ),
        ...(shares
          ? [
              env.DB.prepare('DELETE FROM ExpenseShare WHERE expenseId = ?').bind(expenseId),
              ...shares.map((share) =>
                env.DB.prepare(
                  `INSERT INTO ExpenseShare
            (id, expenseId, userId, amount, shares, percentage) VALUES (?, ?, ?, ?, ?, ?)`,
                ).bind(
                  randomUUID(),
                  expenseId,
                  share.userId,
                  share.amount,
                  share.shares ?? 1,
                  share.percentage ?? null,
                ),
              ),
            ]
          : []),
        env.DB.prepare(
          `INSERT INTO ActivityLog (id, groupId, userId, type, entityId, createdAt)
          VALUES (?, ?, ?, 'EXPENSE_UPDATED', ?, ?)`,
        ).bind(randomUUID(), groupId, ctx.user.id, expenseId, now),
        clearD1Guard(),
      ]);
      return ctx.db.expense.findUniqueOrThrow({ where: { id: expenseId }, include: { shares: true } });
    }),

  delete: groupMemberProcedure
    .input(z.object({ groupId: z.string(), expenseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const groupCheck = await ctx.db.group.findUnique({
        where: { id: input.groupId },
        select: { archivedAt: true },
      });
      if (groupCheck?.archivedAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot delete expenses from an archived group',
        });
      }

      const expense = await ctx.db.expense.findUnique({
        where: { id: input.expenseId },
      });
      if (!expense || expense.groupId !== input.groupId) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      const isOwnerOrAdmin = ctx.membership.role === 'OWNER' || ctx.membership.role === 'ADMIN';
      const isCreatorOrPayer = expense.paidById === ctx.user.id || expense.addedById === ctx.user.id;
      if (!isOwnerOrAdmin && !isCreatorOrPayer) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the expense creator, payer, or group owner/admin can delete this expense',
        });
      }

      await env.DB.batch([
        requireD1Row(
          'SELECT 1 FROM Expense WHERE id = ? AND groupId = ? AND revision = ?',
          input.expenseId,
          input.groupId,
          expense.revision,
        ),
        env.DB.prepare('DELETE FROM Expense WHERE id = ? AND groupId = ?').bind(input.expenseId, input.groupId),
        env.DB.prepare(
          `INSERT INTO ActivityLog (id, groupId, userId, type, entityId, metadata, createdAt)
          VALUES (?, ?, ?, 'EXPENSE_DELETED', ?, ?, ?)`,
        ).bind(
          randomUUID(),
          input.groupId,
          ctx.user.id,
          input.expenseId,
          JSON.stringify({ title: expense.title, amount: expense.amount }),
          new Date().toISOString(),
        ),
        clearD1Guard(),
      ]);

      return { success: true };
    }),
});
