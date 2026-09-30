import { getOperator } from '@/server/operator';
import { AppSidebar } from '@/components/layout/sidebar';
import { MobileHeader } from '@/components/layout/mobile-header';
import { AnnouncementBanner } from '@/components/layout/announcement-banner';

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  await params;
  const operator = await getOperator();

  return (
    <div className="min-h-dvh lg:flex lg:h-dvh lg:flex-row">
      <MobileHeader isAdmin />
      <AppSidebar user={operator.user} isAdmin />
      <main className="@container flex-1 min-w-0 lg:overflow-auto">
        <AnnouncementBanner />
        <div className="w-full py-4 px-4 md:py-6 md:px-8 2xl:mx-auto 2xl:max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
