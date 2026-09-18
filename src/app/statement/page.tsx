'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface Transaction {
  id: string;
  transactionDate: string;
  details: string;
  reference?: string;
  operationType: string;
  direction: string;
  onUs: number;
  forUs: number;
  balanceBefore: number;
  balanceAfter: number;
  currency: string;
  status: string;
  party?: { id: string; name: string; type: string };
  invoice?: { id: string; invoiceNumber: string | null };
  document?: { id: string; fileName: string; googleDriveViewLink: string | null };
  approvedAt?: string;
  notes?: string;
}

interface Summary {
  totalTransactions: number;
  totalOnUs: number;
  totalForUs: number;
}

export default function StatementPage() {
  const searchParams = useSearchParams();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    partyId: searchParams.get('partyId') || '',
    fromDate: '',
    toDate: '',
    operationType: '',
    search: '',
  });
  const [parties, setParties] = useState<{ id: string; name: string }[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetch('/api/parties').then(r => r.json()).then(d => setParties(d.data || []));
  }, []);

  useEffect(() => {
    loadData();
  }, [filters, page]);

  async function loadData() {
    setLoading(true);
    const params = new URLSearchParams({
      ...filters,
      page: String(page),
      pageSize: '50',
    });
    Object.keys(filters).forEach(k => {
      if (!filters[k as keyof typeof filters]) params.delete(k);
    });

    const res = await fetch(`/api/transactions?${params}`);
    const data = await res.json();
    if (data.success) {
      setTransactions(data.data.transactions);
      setSummary(data.data.summary);
      setTotalPages(data.data.pagination.totalPages);
    }
    setLoading(false);
  }

  async function handleExport(format: 'excel' | 'csv' | 'pdf') {
    const params = new URLSearchParams({ ...filters, format });
    window.open(`/api/export/statement?${params}`, '_blank');
  }

  async function handleRecalculate() {
    if (!confirm('هل تريد إعادة حساب جميع الأرصدة؟ قد تستغرق بعض الوقت.')) return;
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partyId: filters.partyId || undefined }),
    });
    const data = await res.json();
    if (data.success) {
      alert(`تم إعادة حساب ${data.updatedTransactions} حركة`);
      loadData();
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('ar-SA', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
  }

  function formatAmount(n: number) {
    if (n === 0) return '—';
    return n.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const netBalance = (summary?.totalOnUs || 0) - (summary?.totalForUs || 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 800 }}>كشف الحساب</h1>
          <p className="text-muted text-sm mt-1">جميع الحركات المالية المعتمدة</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button className="btn btn-ghost btn-sm" onClick={handleRecalculate}>⟳ إعادة حساب</button>
          <button className="btn btn-secondary btn-sm" onClick={() => handleExport('excel')}>↓ Excel</button>
          <button className="btn btn-secondary btn-sm" onClick={() => handleExport('csv')}>↓ CSV</button>
          <button className="btn btn-secondary btn-sm" onClick={() => handleExport('pdf')}>↓ PDF</button>
          <Link href="/transactions/new" className="btn btn-primary btn-sm">+ إضافة يدوي</Link>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
          <div className="stat-card debit">
            <div className="stat-label">إجمالي عليه</div>
            <div className="stat-value debit">{summary.totalOnUs.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}</div>
            <div className="stat-sub">{summary.totalTransactions} حركة</div>
          </div>
          <div className="stat-card credit">
            <div className="stat-label">إجمالي له</div>
            <div className="stat-value credit">{summary.totalForUs.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="stat-card balance">
            <div className="stat-label">صافي الرصيد</div>
            <div className="stat-value balance">{netBalance.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}</div>
            <div className="stat-sub">عليه - له</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card mb-6">
        <div className="card-body">
          <div className="filter-row">
            <div className="form-group" style={{ minWidth: '200px' }}>
              <label className="form-label">الطرف</label>
              <select
                className="form-select"
                value={filters.partyId}
                onChange={e => { setFilters(f => ({ ...f, partyId: e.target.value })); setPage(1); }}
              >
                <option value="">جميع الأطراف</option>
                {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">من تاريخ</label>
              <input type="date" className="form-input" value={filters.fromDate}
                onChange={e => { setFilters(f => ({ ...f, fromDate: e.target.value })); setPage(1); }} />
            </div>
            <div className="form-group">
              <label className="form-label">إلى تاريخ</label>
              <input type="date" className="form-input" value={filters.toDate}
                onChange={e => { setFilters(f => ({ ...f, toDate: e.target.value })); setPage(1); }} />
            </div>
            <div className="form-group">
              <label className="form-label">نوع العملية</label>
              <select className="form-select" value={filters.operationType}
                onChange={e => { setFilters(f => ({ ...f, operationType: e.target.value })); setPage(1); }}>
                <option value="">جميع الأنواع</option>
                <option value="invoice">فاتورة</option>
                <option value="payment">دفعة</option>
                <option value="bank_transfer">تحويل بنكي</option>
                <option value="opening_balance">رصيد افتتاحي</option>
                <option value="manual">يدوي</option>
              </select>
            </div>
            <div className="form-group search-bar" style={{ flex: 2 }}>
              <label className="form-label">بحث</label>
              <span className="search-bar-icon">🔍</span>
              <input
                type="text"
                className="form-input"
                placeholder="ابحث في البيان، رقم الفاتورة، اسم الطرف..."
                value={filters.search}
                onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1); }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="empty-state">
            <div style={{ fontSize: '2rem', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</div>
            <p className="text-muted mt-4">جاري تحميل البيانات...</p>
          </div>
        ) : transactions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">لا توجد حركات مالية</div>
            <p className="text-muted text-sm">ابدأ برفع مستند أو إضافة حركة يدوية</p>
            <div className="flex gap-3 justify-center mt-4">
              <Link href="/documents/upload" className="btn btn-primary">رفع مستند</Link>
              <Link href="/transactions/new" className="btn btn-secondary">إضافة يدوي</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>الطرف</th>
                    <th>البيان</th>
                    <th>نوع العملية</th>
                    <th style={{ color: 'var(--color-debit)' }}>عليه</th>
                    <th style={{ color: 'var(--color-credit)' }}>له</th>
                    <th style={{ color: 'var(--color-balance)' }}>الرصيد</th>
                    <th>المستند</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(tx => (
                    <tr key={tx.id}>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-2)' }}>
                        {formatDate(tx.transactionDate)}
                      </td>
                      <td>
                        {tx.party ? (
                          <Link href={`/parties/${tx.party.id}`} className="text-primary">
                            {tx.party.name}
                          </Link>
                        ) : '—'}
                      </td>
                      <td>
                        <div>{tx.details}</div>
                        {tx.invoice?.invoiceNumber && (
                          <div className="text-xs text-muted">#{tx.invoice.invoiceNumber}</div>
                        )}
                      </td>
                      <td>
                        <span className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>
                          {tx.operationType}
                        </span>
                      </td>
                      <td className={tx.onUs > 0 ? 'amount-debit' : 'amount-zero'}>
                        {formatAmount(tx.onUs)}
                      </td>
                      <td className={tx.forUs > 0 ? 'amount-credit' : 'amount-zero'}>
                        {formatAmount(tx.forUs)}
                      </td>
                      <td className="amount-balance">
                        {tx.balanceAfter.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                      </td>
                      <td>
                        {tx.document ? (
                          <Link href={`/documents/${tx.document.id}`} className="btn btn-ghost btn-sm" title={tx.document.fileName}>
                            📄
                          </Link>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="pagination">
                <button className="pagination-btn" onClick={() => setPage(1)} disabled={page === 1}>«</button>
                <button className="pagination-btn" onClick={() => setPage(p => p - 1)} disabled={page === 1}>‹</button>
                <span className="text-sm text-muted px-4">صفحة {page} من {totalPages}</span>
                <button className="pagination-btn" onClick={() => setPage(p => p + 1)} disabled={page === totalPages}>›</button>
                <button className="pagination-btn" onClick={() => setPage(totalPages)} disabled={page === totalPages}>»</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
