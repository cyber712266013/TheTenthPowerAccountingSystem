import { DashboardLayoutClient } from '@/components/layout/Sidebar';
import { prisma } from '@/lib/prisma';

// Try to get pending count, fallback to 0 if DB not connected
async function getPendingCount(): Promise<number> {
  try {
    return await prisma.document.count({ where: { processingStatus: 'needs_review' } });
  } catch {
    return 0;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pendingCount = await getPendingCount();

  return (
    <DashboardLayoutClient title="نظام الحسابات" pendingCount={pendingCount}>
      {children}
    </DashboardLayoutClient>
  );
}
