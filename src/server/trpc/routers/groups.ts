import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure, groupMemberProcedure } from '../init';
import { stripUndefined } from '../../lib/strip-undefined';
import { currencySchema, optionalCurrencySchema } from '@/lib/currencies';
import { env } from 'cloudflare:workers';
import { randomUUID } from 'node:crypto';

export const groupsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const groups = await ctx.db.group.findMany({
      where: {
        members: { some: { userId: ctx.user.id } },
        archivedAt: null,
      },
      take: 200,
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, image: true, isPlaceholder: true, placeholderName: true },
            },
          },
        },
        _count: { select: { expenses: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return groups;
  }),

  listArchived: protectedProcedure.query(async ({ ctx }) => {
    const groups = await ctx.db.group.findMany({
      where: {
        members: { some: { userId: ctx.user.id } },
        archivedAt: { not: null },
      },
      take: 200,
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, image: true, isPlaceholder: true, placeholderName: true },
            },
          },
        },
        _count: { select: { expenses: true } },
      },
      orderBy: { archivedAt: 'desc' },
    });
    return groups;
  }),

  get: groupMemberProcedure.query(async ({ ctx, input }) => {
    const group = await ctx.db.group.findUnique({
      where: { id: input.groupId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true,
                isPlaceholder: true,
                placeholderName: true,
                venmoUsername: true,
              },
            },
          },
        },
      },
    });
    if (!group) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' });
    }
    return group;
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        currency: currencySchema,
        emoji: z.string().max(4).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const groupId = randomUUID();
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO "Group" (id, name, description, currency, emoji, simplifyDebts, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        ).bind(groupId, input.name, input.description ?? null, input.currency, input.emoji ?? '💰', now, now),
        env.DB.prepare(
          `INSERT INTO GroupMember (id, userId, groupId, role, joinedAt)
          VALUES (?, ?, ?, 'OWNER', ?)`,
        ).bind(randomUUID(), ctx.user.id, groupId, now),
      ]);
      return ctx.db.group.findUniqueOrThrow({ where: { id: groupId } });
    }),

  update: groupMemberProcedure
    .input(
      z.object({
        groupId: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        currency: optionalCurrencySchema,
        emoji: z.string().max(4).optional(),
        simplifyDebts: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.membership.role === 'MEMBER') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins and owners can update groups' });
      }
      const { groupId, ...data } = input;

      if (data.currency) {
        const existing = await ctx.db.group.findUnique({
          where: { id: groupId },
          select: { currency: true },
        });
        if (existing && data.currency.toUpperCase() !== existing.currency.toUpperCase()) {
          const [expenseCount, settlementCount] = await Promise.all([
            ctx.db.expense.count({ where: { groupId }, take: 1 }),
            ctx.db.settlement.count({ where: { groupId }, take: 1 }),
          ]);
          if (expenseCount > 0 || settlementCount > 0) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'Cannot change group currency after expenses or settlements have been recorded. Create a new group with the desired currency instead.',
            });
          }
        }
      }

      const group = await ctx.db.group.update({
        where: { id: groupId },
        data: stripUndefined(data),
      });
      return group;
    }),

  delete: groupMemberProcedure.input(z.object({ groupId: z.string() })).mutation(async ({ ctx, input }) => {
    if (ctx.membership.role !== 'OWNER') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner can delete a group' });
    }
    await ctx.db.group.delete({ where: { id: input.groupId } });
    return { success: true };
  }),

  archive: groupMemberProcedure.input(z.object({ groupId: z.string() })).mutation(async ({ ctx, input }) => {
    if (ctx.membership.role === 'MEMBER') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins and owners can archive groups' });
    }
    const group = await ctx.db.group.update({
      where: { id: input.groupId },
      data: { archivedAt: new Date() },
    });
    await ctx.db.activityLog.create({
      data: {
        groupId: input.groupId,
        userId: ctx.user.id,
        type: 'GROUP_ARCHIVED',
        metadata: { name: group.name },
      },
    });
    return group;
  }),

  unarchive: groupMemberProcedure.input(z.object({ groupId: z.string() })).mutation(async ({ ctx, input }) => {
    if (ctx.membership.role === 'MEMBER') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins and owners can unarchive groups' });
    }
    const group = await ctx.db.group.update({
      where: { id: input.groupId },
      data: { archivedAt: null },
    });
    await ctx.db.activityLog.create({
      data: {
        groupId: input.groupId,
        userId: ctx.user.id,
        type: 'GROUP_UNARCHIVED',
        metadata: { name: group.name },
      },
    });
    return group;
  }),

  removeMember: groupMemberProcedure
    .input(z.object({ groupId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.db.groupMember.findUnique({
        where: { userId_groupId: { userId: input.userId, groupId: input.groupId } },
        include: { user: { select: { isPlaceholder: true } } },
      });
      if (!member?.user.isPlaceholder)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only participant records can be removed' });
      const [shares, expenses, settlements, assignments] = await Promise.all([
        ctx.db.expenseShare.count({ where: { userId: input.userId } }),
        ctx.db.expense.count({ where: { OR: [{ paidById: input.userId }, { addedById: input.userId }] } }),
        ctx.db.settlement.count({ where: { OR: [{ fromId: input.userId }, { toId: input.userId }] } }),
        ctx.db.receiptItemAssignment.count({ where: { userId: input.userId } }),
      ]);
      if (shares + expenses + settlements + assignments > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This participant has financial history and cannot be removed. Rename them instead.',
        });
      }
      await ctx.db.user.delete({ where: { id: input.userId } });
      await ctx.db.activityLog.create({
        data: {
          groupId: input.groupId,
          userId: ctx.user.id,
          type: 'MEMBER_LEFT',
          metadata: { removedUserId: input.userId, wasPlaceholder: true },
        },
      });
      return { success: true };
    }),

  addPlaceholder: groupMemberProcedure
    .input(
      z.object({
        groupId: z.string(),
        name: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.membership.role === 'MEMBER') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins and owners can add placeholder members' });
      }

      const userId = randomUUID();
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO User (id, name, email, isPlaceholder, placeholderName, createdByUserId,
          createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
        ).bind(userId, input.name, `placeholder-${userId}@placeholder.local`, input.name, ctx.user.id, now, now),
        env.DB.prepare(
          `INSERT INTO GroupMember (id, userId, groupId, role, joinedAt)
          VALUES (?, ?, ?, 'MEMBER', ?)`,
        ).bind(randomUUID(), userId, input.groupId, now),
        env.DB.prepare(
          `INSERT INTO ActivityLog (id, groupId, userId, type, metadata, createdAt)
          VALUES (?, ?, ?, 'PLACEHOLDER_CREATED', ?, ?)`,
        ).bind(
          randomUUID(),
          input.groupId,
          ctx.user.id,
          JSON.stringify({ placeholderName: input.name, placeholderUserId: userId }),
          now,
        ),
      ]);
      return { id: userId, name: input.name, isPlaceholder: true };
    }),

  renamePlaceholder: groupMemberProcedure
    .input(z.object({ groupId: z.string(), placeholderUserId: z.string(), name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.membership.role !== 'OWNER' && ctx.membership.role !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins and owners can rename placeholder members' });
      }
      const user = await ctx.db.user.findUnique({ where: { id: input.placeholderUserId } });
      if (!user?.isPlaceholder) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'User is not a placeholder' });
      }
      const membership = await ctx.db.groupMember.findUnique({
        where: { userId_groupId: { userId: input.placeholderUserId, groupId: input.groupId } },
      });
      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Placeholder is not a member of this group' });
      }
      return ctx.db.user.update({
        where: { id: input.placeholderUserId },
        data: { placeholderName: input.name, name: input.name },
      });
    }),
});
