'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Transaction {
  id: string;
  transactionDate: string;
  details: string;
  reference?: string;
  operationType: string;
  direction: string;
  onUs: number;
  forUs: number;
  balanceAfter: number;
  currency: string;
  status: string;
  party?: { id: string; name: string };
  document?: { id: string; fileName: string };
  approvedAt?: string;
  notes?: string;
}

export default function TransactionsPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    load();
  }, [search, page]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (search) params.set('search', search);
    const res = await fetch(`/api/transactions?${params}`);
    const data = await res.json();
    if (data.success) {
      setTransactions(data.data.transactions);
      setTotalPages(data.data.pagination.totalPages);
    }
    setLoading(false);
  }

  async function handleVoid(id: string) {
    const reason = prompt('سبب الإلغاء:');
    if (!reason) return;
    const res = await fetch(`/api/transactions/${id}/void`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (data.success) load();
  }

  function fmt(n: number) {
    if (n === 0) return '—';
    return n.toLocaleString('ar-SA', { minimumFractionDigits: 2 });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 800 }}>الحركات المالية</h1>
          <p className="text-muted text-sm mt-1">جميع الحركات المالية المعتمدة في النظام</p>
        </div>
        <div className="flex gap-3">
          <Link href="/transactions/new" className="btn btn-primary">+ إضافة يدوي</Link>
        </div>
      </div>

      {/* Search */}
      <div className="card mb-6">
        <div className="card-body">
          <div className="search-bar">
            <span className="search-bar-icon">🔍</span>
            <input
              type="text"
              className="form-input"
              placeholder="بحث في البيان، اسم الطرف، رقم الفاتورة..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="empty-state">
            <div style={{ fontSize: '2rem', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</div>
          </div>
        ) : transactions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💳</div>
            <div className="empty-state-title">لا توجد حركات مالية</div>
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
                    <th>النوع</th>
                    <th style={{ color: 'var(--color-debit)' }}>عليه</th>
                    <th style={{ color: 'var(--color-credit)' }}>له</th>
                    <th style={{ color: 'var(--color-balance)' }}>الرصيد</th>
                    <th>المستند</th>
                    <th>الحالة</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(tx => (
                    <tr key={tx.id} onClick={() => router.push(`/transactions/${tx.id}`)} style={{ cursor: 'pointer' }}>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-2)' }}>
                        {new Date(tx.transactionDate).toLocaleDateString('ar-SA')}
                      </td>
                      <td>{tx.party?.name || '—'}</td>
                      <td>
                        <div>{tx.details}</div>
                        {tx.reference && <div className="text-xs text-muted">{tx.reference}</div>}
                      </td>
                      <td>
                        <span className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>{tx.operationType}</span>
                      </td>
                      <td className={tx.onUs > 0 ? 'amount-debit' : 'amount-zero'}>{fmt(tx.onUs)}</td>
                      <td className={tx.forUs > 0 ? 'amount-credit' : 'amount-zero'}>{fmt(tx.forUs)}</td>
                      <td className="amount-balance">
                        {tx.balanceAfter.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        {tx.document ? (
                          <Link href={`/documents/${tx.document.id}`} className="btn btn-ghost btn-sm" title={tx.document.fileName}>
                            📄
                          </Link>
                        ) : '—'}
                      </td>
                      <td>
                        <span className={`badge ${tx.status === 'approved' ? 'badge-success' : tx.status === 'voided' ? 'badge-danger' : 'badge-neutral'}`}>
                          {tx.status === 'approved' ? 'معتمد' : tx.status === 'voided' ? 'ملغى' : tx.status}
                        </span>
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        {tx.status === 'approved' && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleVoid(tx.id)}
                            title="إلغاء"
                            style={{ color: 'var(--color-danger)' }}
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="pagination">
                <button className="pagination-btn" onClick={() => setPage(p => p - 1)} disabled={page === 1}>‹</button>
                <span className="text-sm text-muted px-4">صفحة {page} من {totalPages}</span>
                <button className="pagination-btn" onClick={() => setPage(p => p + 1)} disabled={page === totalPages}>›</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
