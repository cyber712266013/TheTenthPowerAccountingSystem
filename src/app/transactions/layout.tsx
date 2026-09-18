import { DashboardLayoutClient } from '@/components/layout/Sidebar';
export default function TransactionsLayout({ children }: { children: React.ReactNode }) {
  return <DashboardLayoutClient title="الحركات المالية">{children}</DashboardLayoutClient>;
}
