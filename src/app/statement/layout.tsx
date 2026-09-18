import { DashboardLayoutClient } from '@/components/layout/Sidebar';
export default function StatementLayout({ children }: { children: React.ReactNode }) {
  return <DashboardLayoutClient title="كشف الحساب">{children}</DashboardLayoutClient>;
}
