'use client';

import { useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Shield, Database, Package, FolderOpen, HardDrive, Loader2 } from 'lucide-react';

import { AuditLogSection } from '@/components/admin/audit-log-section';
import { AnnouncementSection } from '@/components/admin/announcement-section';
import { ActivityFeedSection } from '@/components/admin/activity-feed-section';
import { AIStatsSection } from '@/components/admin/ai-stats-section';
import { VenmoSettingsSection } from '@/components/admin/venmo-settings-section';

export default function AdminPage() {
  const t = useTranslations('admin');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-7 w-7 text-primary" />
        <h1 className="text-2xl font-bold">{t('title')}</h1>
      </div>

      <div className="grid gap-6 [&>*]:min-w-0">
        <SystemHealthSection />
        <Separator />
        <StorageStatsSection />
        <Separator />
        <AnnouncementSection />
        <VenmoSettingsSection />
        <Separator />
        <AIStatsSection />
        <ActivityFeedSection />
        <Separator />
        <AuditLogSection />
      </div>
    </div>
  );
}

// ─── System Health ─────────────────────────────────────────

function SystemHealthSection() {
  const t = useTranslations('admin');
  const health = trpc.admin.getSystemHealth.useQuery(undefined, {
    refetchInterval: 30000,
  });

  if (health.isLoading) return <SectionSkeleton title={t('systemHealth.title')} />;

  const data = health.data;

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">{t('systemHealth.title')}</h2>
      <div className="grid gap-4 @2xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Database className="h-4 w-4" />
              {t('systemHealth.database')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${data?.dbStatus === 'connected' ? 'bg-green-500' : 'bg-red-500'}`}
              />
              <span className="text-sm font-medium capitalize">{data?.dbStatus ?? 'unknown'}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Package className="h-4 w-4" />
              {t('systemHealth.version')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-sm font-medium">v{data?.version}</span>
            {data?.commitSha && data.commitSha !== 'unknown' && (
              <span className="ml-2 text-xs text-muted-foreground font-mono">({data.commitSha})</span>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

// ─── Storage Stats ─────────────────────────────────────────

function StorageStatsSection() {
  const t = useTranslations('admin');
  const storage = trpc.admin.getStorageStats.useQuery();

  if (storage.isLoading) return <SectionSkeleton title={t('storage.title')} />;

  const data = storage.data;

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">{t('storage.title')}</h2>
      <div className="grid gap-4 @2xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FolderOpen className="h-4 w-4" />
              {t('storage.receipts')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data?.receiptCount ?? 0}</p>
            <p className="text-xs text-muted-foreground">{t('storage.inDatabase')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <HardDrive className="h-4 w-4" />
              Tracked receipt bytes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatBytes(data?.storedBytes ?? 0)}</p>
            <p className="text-xs text-muted-foreground">Private R2 bucket · {data?.bucket ?? 'unknown'}</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

// ─── Helpers ───────────────────────────────────────────────

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
