'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface DashboardStats {
  pendingReview: number;
  failedAnalysis: number;
  totalDocuments: number;
  totalTransactions: number;
  totalOnUs: number;
  totalForUs: number;
  recentTransactions: {
    id: string;
    transactionDate: string;
    details: string;
    onUs: number;
    forUs: number;
    balanceAfter: number;
    party?: { name: string };
  }[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(d => { if (d.success) setStats(d.data); })
      .finally(() => setLoading(false));
  }, []);

  function fmt(n: number) {
    return n.toLocaleString('ar-SA', { minimumFractionDigits: 2 });
  }

  function fmtDate(d: string) {
    return new Date(d).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' });
  }

  return (
    <div>
      <div className="mb-8">
        <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 800, marginBottom: 'var(--space-1)' }}>
          لوحة التحكم
        </h1>
        <p className="text-muted text-sm">نظرة عامة على النظام المالي</p>
      </div>

      {/* Quick Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-8)' }}>
        {[
          { href: '/documents/upload', icon: '📤', label: 'رفع مستند', primary: true },
          { href: '/transactions/new', icon: '➕', label: 'إضافة يدوي' },
          { href: '/statement', icon: '📋', label: 'كشف الحساب' },
          { href: '/parties', icon: '🏢', label: 'الأطراف' },
        ].map(({ href, icon, label, primary }) => (
          <Link
            key={href}
            href={href}
            className={`btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-lg`}
            style={{ flexDirection: 'column', gap: 'var(--space-2)', height: '80px', textDecoration: 'none' }}
          >
            <span style={{ fontSize: '1.5rem' }}>{icon}</span>
            <span style={{ fontSize: 'var(--font-size-sm)' }}>{label}</span>
          </Link>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center" style={{ height: '300px' }}>
          <div style={{ fontSize: '2rem', animation: 'spin 1s linear infinite' }}>⟳</div>
        </div>
      ) : (
        <>
          {/* Alerts */}
          {(stats?.pendingReview || 0) > 0 && (
            <div className="alert alert-warning mb-6">
              <span className="alert-icon">⏳</span>
              <div className="alert-body">
                <div className="alert-title">يوجد {stats?.pendingReview} مستند بانتظار مراجعتك</div>
                <Link href="/documents?status=needs_review" className="btn btn-warning btn-sm mt-2">
                  مراجعة الآن
                </Link>
              </div>
            </div>
          )}

          {(stats?.failedAnalysis || 0) > 0 && (
            <div className="alert alert-danger mb-6">
              <span className="alert-icon">❌</span>
              <div className="alert-body">
                <div className="alert-title">{stats?.failedAnalysis} مستند فشل تحليله</div>
                <Link href="/documents?status=failed" className="btn btn-danger btn-sm mt-2">
                  عرض المستندات
                </Link>
              </div>
            </div>
          )}

          {/* Stats Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
            <div className="stat-card primary">
              <div className="stat-label">المستندات</div>
              <div className="stat-value" style={{ color: 'var(--color-primary)' }}>{stats?.totalDocuments || 0}</div>
              <div className="stat-sub">إجمالي المستندات المرفوعة</div>
            </div>
            <div className="stat-card primary">
              <div className="stat-label">الحركات المالية</div>
              <div className="stat-value" style={{ color: 'var(--color-primary)' }}>{stats?.totalTransactions || 0}</div>
              <div className="stat-sub">حركة معتمدة</div>
            </div>
            <div className="stat-card debit">
              <div className="stat-label">إجمالي عليه</div>
              <div className="stat-value debit">{fmt(stats?.totalOnUs || 0)}</div>
            </div>
            <div className="stat-card credit">
              <div className="stat-label">إجمالي له</div>
              <div className="stat-value credit">{fmt(stats?.totalForUs || 0)}</div>
            </div>
            <div className="stat-card balance">
              <div className="stat-label">صافي الرصيد</div>
              <div className="stat-value balance">
                {fmt((stats?.totalOnUs || 0) - (stats?.totalForUs || 0))}
              </div>
              <div className="stat-sub">عليه − له</div>
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">آخر الحركات المالية</span>
              <Link href="/statement" className="btn btn-ghost btn-sm">عرض الكل</Link>
            </div>
            {!stats?.recentTransactions.length ? (
              <div className="empty-state">
                <div className="empty-state-icon">📋</div>
                <div className="empty-state-title">لا توجد حركات بعد</div>
                <Link href="/documents/upload" className="btn btn-primary mt-4">ابدأ برفع فاتورة</Link>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>الطرف</th>
                      <th>البيان</th>
                      <th style={{ color: 'var(--color-debit)' }}>عليه</th>
                      <th style={{ color: 'var(--color-credit)' }}>له</th>
                      <th style={{ color: 'var(--color-balance)' }}>الرصيد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats?.recentTransactions.map(tx => (
                      <tr key={tx.id}>
                        <td style={{ color: 'var(--color-text-2)', whiteSpace: 'nowrap' }}>{fmtDate(tx.transactionDate)}</td>
                        <td>{tx.party?.name || '—'}</td>
                        <td>{tx.details}</td>
                        <td className={tx.onUs > 0 ? 'amount-debit' : 'amount-zero'}>
                          {tx.onUs > 0 ? tx.onUs.toLocaleString('ar-SA', { minimumFractionDigits: 2 }) : '—'}
                        </td>
                        <td className={tx.forUs > 0 ? 'amount-credit' : 'amount-zero'}>
                          {tx.forUs > 0 ? tx.forUs.toLocaleString('ar-SA', { minimumFractionDigits: 2 }) : '—'}
                        </td>
                        <td className="amount-balance">
                          {tx.balanceAfter.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
