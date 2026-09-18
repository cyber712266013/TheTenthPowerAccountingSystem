import { DashboardLayoutClient } from '@/components/layout/Sidebar';

// Wrapper layout for all non-dashboard pages (documents, statement, transactions, parties)
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardLayoutClient title="نظام الحسابات">
      {children}
    </DashboardLayoutClient>
  );
}
