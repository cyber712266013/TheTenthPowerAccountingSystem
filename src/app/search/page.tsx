'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ documents: unknown[]; transactions: unknown[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const [docsRes, txRes] = await Promise.all([
        fetch(`/api/documents?search=${encodeURIComponent(query)}&pageSize=10`),
        fetch(`/api/transactions?search=${encodeURIComponent(query)}&pageSize=10`),
      ]);
      const docs = await docsRes.json();
      const txs = await txRes.json();
      setResults({ documents: docs.data || [], transactions: txs.data || [] });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ direction: 'rtl', padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '1.5rem' }}>
        🔍 البحث
      </h1>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
        <input
          placeholder="ابحث في المستندات والحركات المالية..."
          value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          style={{
            flex: 1, padding: '0.8rem 1rem',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '10px', color: '#e2e8f0', fontFamily: 'inherit', fontSize: '0.95rem',
          }}
        />
        <button onClick={handleSearch}
          style={{
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: 'white', padding: '0.8rem 1.5rem', borderRadius: '10px',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
          }}>
          {loading ? '...' : 'بحث'}
        </button>
      </div>

      {results && (
        <div>
          <div style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ color: '#94a3b8', fontSize: '1rem', marginBottom: '0.8rem' }}>
              المستندات ({results.documents.length})
            </h2>
            {results.documents.length === 0 ? (
              <p style={{ color: '#475569', fontSize: '0.85rem' }}>لا توجد نتائج</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {(results.documents as { id: string; fileName: string; processingStatus: string }[]).map((d) => (
                  <Link key={d.id} href={`/documents/${d.id}/review`}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '0.8rem 1rem', background: 'rgba(255,255,255,0.04)',
                      borderRadius: '10px', textDecoration: 'none', color: '#e2e8f0',
                      border: '1px solid rgba(255,255,255,0.07)',
                    }}>
                    <span>📄 {d.fileName}</span>
                    <span style={{ color: '#6366f1', fontSize: '0.8rem' }}>{d.processingStatus}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 style={{ color: '#94a3b8', fontSize: '1rem', marginBottom: '0.8rem' }}>
              الحركات المالية ({results.transactions.length})
            </h2>
            {results.transactions.length === 0 ? (
              <p style={{ color: '#475569', fontSize: '0.85rem' }}>لا توجد نتائج</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {(results.transactions as { id: string; details: string; amount: number }[]).map((t) => (
                  <div key={t.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.8rem 1rem', background: 'rgba(255,255,255,0.04)',
                    borderRadius: '10px', border: '1px solid rgba(255,255,255,0.07)',
                  }}>
                    <span style={{ color: '#e2e8f0' }}>💳 {t.details || 'حركة مالية'}</span>
                    <span style={{ color: '#10b981', fontWeight: 600 }}>{Number(t.amount).toLocaleString('ar-SA')} ر.س</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
