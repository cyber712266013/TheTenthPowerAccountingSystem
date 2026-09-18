'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const NAV_ITEMS = [
  {
    section: 'الرئيسية',
    items: [
      { href: '/dashboard', icon: '📊', label: 'لوحة التحكم' },
    ],
  },
  {
    section: 'المستندات',
    items: [
      { href: '/documents/upload', icon: '📤', label: 'رفع مستند' },
      { href: '/documents', icon: '📄', label: 'المستندات', badge: '' },
      { href: '/documents?status=needs_review', icon: '⏳', label: 'بانتظار المراجعة', badge: '' },
    ],
  },
  {
    section: 'الحسابات',
    items: [
      { href: '/transactions', icon: '💳', label: 'الحركات المالية' },
      { href: '/statement', icon: '📋', label: 'كشف الحساب' },
      { href: '/parties', icon: '🏢', label: 'الأطراف' },
    ],
  },
  {
    section: 'الإدارة',
    items: [
      { href: '/search', icon: '🔍', label: 'البحث' },
      { href: '/export', icon: '📥', label: 'التصدير' },
      { href: '/audit', icon: '🔏', label: 'سجل التدقيق' },
      { href: '/settings', icon: '⚙️', label: 'الإعدادات' },
    ],
  },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  pendingCount?: number;
}

export function Sidebar({ isOpen, onClose, pendingCount = 0 }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 99,
            backdropFilter: 'blur(4px)',
          }}
          onClick={onClose}
        />
      )}

      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        {/* Logo */}
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">📊</div>
            <div>
              <div>نظام الحسابات</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-3)', fontWeight: 400 }}>
                v1.0
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((section) => (
            <div key={section.section}>
              <div className="nav-section-label">{section.section}</div>
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                const showBadge = item.badge !== undefined && pendingCount > 0 && item.label.includes('مراجعة');

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item ${isActive ? 'active' : ''}`}
                    onClick={onClose}
                  >
                    <span className="nav-item-icon">{item.icon}</span>
                    <span>{item.label}</span>
                    {showBadge && (
                      <span className="nav-badge">{pendingCount}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <Link href="/login" className="nav-item" style={{ color: 'var(--color-danger)' }}>
            <span className="nav-item-icon">🚪</span>
            <span>تسجيل الخروج</span>
          </Link>
        </div>
      </aside>
    </>
  );
}

// ─── Layout Component ───────────────────────────────────────

interface DashboardLayoutClientProps {
  children: React.ReactNode;
  title: string;
  pendingCount?: number;
}

export function DashboardLayoutClient({ children, title, pendingCount }: DashboardLayoutClientProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app-shell">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        pendingCount={pendingCount}
      />

      <main className="main-content">
        {/* Top bar */}
        <header className="top-bar">
          {/* Mobile menu button */}
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setSidebarOpen(true)}
            style={{ display: 'none' }}
            id="mobile-menu-btn"
          >
            ☰
          </button>

          <div className="top-bar-title">{title}</div>

          {/* Quick actions */}
          <Link href="/documents/upload" className="btn btn-primary btn-sm">
            + رفع مستند
          </Link>
        </header>

        {/* Page content */}
        <div className="page-content">
          {children}
        </div>
      </main>

      {/* Mobile menu button (shown only on mobile via CSS) */}
      <style>{`
        @media (max-width: 768px) {
          #mobile-menu-btn { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
