import { z } from 'zod';
import { env } from 'cloudflare:workers';
import type { AdminAction, PrismaClient } from '@/generated/prisma/client';
import { Prisma } from '@/generated/prisma/client';
import { createTRPCRouter, protectedProcedure } from '../init';
import packageJson from '../../../../package.json';

const adminProcedure = protectedProcedure;

export async function logAdminAction(
  db: PrismaClient,
  adminId: string,
  action: AdminAction,
  targetId?: string | null,
  metadata?: Record<string, unknown> | null,
) {
  await db.adminAuditLog.create({
    data: {
      adminId,
      action,
      ...(targetId != null ? { targetId } : {}),
      ...(metadata != null ? { metadata: metadata as Prisma.InputJsonValue } : {}),
    },
  });
}

export const adminRouter = createTRPCRouter({
  getSystemHealth: adminProcedure.query(async ({ ctx }) => {
    let dbStatus: 'connected' | 'disconnected' = 'disconnected';
    try {
      await ctx.db.$queryRaw`SELECT 1`;
      dbStatus = 'connected';
    } catch {
      // Report the failed connection without revealing internal details.
    }
    return {
      dbStatus,
      aiProvider: process.env.AI_PROVIDER_PRIORITY ?? 'openai',
      aiAvailable: !!process.env.OPENAI_API_KEY,
      aiStatus: process.env.OPENAI_API_KEY ? ('available' as const) : ('unavailable' as const),
      version: packageJson.version,
      commitSha: 'unknown',
      serverStartTime: new Date().toISOString(),
      uptime: 0,
    };
  }),

  getAuditLog: adminProcedure
    .input(z.object({ cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.db.adminAuditLog.findMany({
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: { admin: { select: { name: true, email: true } } },
      });
      const nextCursor = items.length > input.limit ? items[input.limit - 1]?.id : undefined;
      if (nextCursor) items.pop();
      return {
        items: items.map((item) => ({
          id: item.id,
          action: item.action,
          targetId: item.targetId,
          metadata: item.metadata as Record<string, unknown> | null,
          adminName: item.admin.name ?? item.admin.email,
          adminEmail: item.admin.email,
          createdAt: item.createdAt,
        })),
        nextCursor,
      };
    }),

  getAnnouncement: adminProcedure.query(async ({ ctx }) => {
    const setting = await ctx.db.systemSetting.findUnique({ where: { key: 'announcement' } });
    return { message: setting?.value ?? null };
  }),
  setAnnouncement: adminProcedure
    .input(z.object({ message: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const message = input.message?.trim();
      if (message) {
        await ctx.db.systemSetting.upsert({
          where: { key: 'announcement' },
          create: { key: 'announcement', value: message },
          update: { value: message },
        });
      } else {
        await ctx.db.systemSetting.deleteMany({ where: { key: 'announcement' } });
      }
      await logAdminAction(ctx.db, ctx.user.id, 'ANNOUNCEMENT_SET', null, { message: message ?? null });
      return { success: true };
    }),

  getVenmoEnabled: adminProcedure.query(async ({ ctx }) => {
    const setting = await ctx.db.systemSetting.findUnique({ where: { key: 'venmoEnabled' } });
    return { enabled: setting?.value === 'true' };
  }),
  setVenmoEnabled: adminProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    await ctx.db.systemSetting.upsert({
      where: { key: 'venmoEnabled' },
      create: { key: 'venmoEnabled', value: String(input.enabled) },
      update: { value: String(input.enabled) },
    });
    await logAdminAction(ctx.db, ctx.user.id, 'VENMO_SETTING_CHANGED', null, { enabled: input.enabled });
    return { success: true };
  }),

  getAIStats: adminProcedure.query(async ({ ctx }) => {
    const now = Date.now();
    const [total, statuses, providers, last7Days, last30Days] = await Promise.all([
      ctx.db.receipt.count(),
      ctx.db.receipt.groupBy({ by: ['status'], _count: true }),
      ctx.db.receipt.groupBy({ by: ['aiProvider'], _count: true }),
      ctx.db.receipt.count({ where: { createdAt: { gte: new Date(now - 7 * 86_400_000) } } }),
      ctx.db.receipt.count({ where: { createdAt: { gte: new Date(now - 30 * 86_400_000) } } }),
    ]);
    return {
      total,
      byStatus: Object.fromEntries(statuses.map((row) => [row.status, row._count])),
      byProvider: Object.fromEntries(
        providers.filter((row) => row.aiProvider).map((row) => [row.aiProvider, row._count]),
      ),
      last7Days,
      last30Days,
    };
  }),

  getGlobalActivity: adminProcedure
    .input(z.object({ cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.db.activityLog.findMany({
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { name: true, email: true } }, group: { select: { name: true } } },
      });
      const nextCursor = items.length > input.limit ? items[input.limit - 1]?.id : undefined;
      if (nextCursor) items.pop();
      return {
        items: items.map((item) => ({
          id: item.id,
          type: item.type,
          userName: item.user?.name ?? item.user?.email ?? 'Unknown',
          groupName: item.group.name,
          createdAt: item.createdAt,
        })),
        nextCursor,
      };
    }),

  getStorageStats: adminProcedure.query(async ({ ctx }) => {
    const [receiptCount, totals] = await Promise.all([
      ctx.db.receipt.count(),
      ctx.db.receipt.aggregate({ _sum: { fileSize: true } }),
    ]);
    let bucket: 'available' | 'unavailable' = 'unavailable';
    try {
      await env.RECEIPTS.head('__sharetab_health_probe__');
      bucket = 'available';
    } catch {
      // The head request verifies the binding without creating an object.
    }
    const storedBytes = totals._sum.fileSize ?? 0;
    return { receiptCount, storedBytes, bucket };
  }),
});
