'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Party {
  id: string; name: string; type: string;
  phone?: string; email?: string; taxNumber?: string;
  openingBalance: number; isActive: boolean;
  _count?: { transactions: number };
}

const TYPE_LABELS: Record<string, string> = {
  supplier: 'مورد', customer: 'عميل', person: 'شخص',
  company: 'شركة', bank: 'بنك', other: 'أخرى',
};

export default function PartiesPage() {
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/parties')
      .then(r => r.json())
      .then(d => { setParties(d.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = parties.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.phone || '').includes(search)
  );

  return (
    <div style={{ direction: 'rtl', padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>🏢 الأطراف</h1>
        <button style={{
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          color: 'white', padding: '0.6rem 1.4rem', borderRadius: '10px',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
        }} onClick={() => alert('سيتم إضافة هذه الميزة قريباً')}>
          ➕ طرف جديد
        </button>
      </div>

      <input
        placeholder="بحث بالاسم أو رقم الهاتف..."
        value={search} onChange={e => setSearch(e.target.value)}
        style={{
          width: '100%', padding: '0.7rem 1rem', marginBottom: '1.5rem',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '10px', color: '#e2e8f0', fontFamily: 'inherit', fontSize: '0.9rem',
          boxSizing: 'border-box',
        }}
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem', color: '#64748b' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏢</div>
          <p>لا توجد أطراف مسجلة</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
          {filtered.map(party => (
            <div key={party.id} style={{
              background: 'rgba(255,255,255,0.04)', borderRadius: '14px',
              border: '1px solid rgba(255,255,255,0.08)', padding: '1.2rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.8rem' }}>
                <h3 style={{ color: '#e2e8f0', margin: 0, fontSize: '1rem' }}>{party.name}</h3>
                <span style={{
                  padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.72rem',
                  background: 'rgba(99,102,241,0.2)', color: '#818cf8',
                }}>{TYPE_LABELS[party.type] || party.type}</span>
              </div>
              {party.phone && <p style={{ color: '#94a3b8', fontSize: '0.8rem', margin: '0.3rem 0' }}>📞 {party.phone}</p>}
              {party.email && <p style={{ color: '#94a3b8', fontSize: '0.8rem', margin: '0.3rem 0' }}>✉️ {party.email}</p>}
              <div style={{ marginTop: '0.8rem', paddingTop: '0.8rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ color: party.openingBalance >= 0 ? '#10b981' : '#ef4444', fontSize: '0.85rem', fontWeight: 600 }}>
                  الرصيد: {party.openingBalance.toLocaleString('ar-SA')} ر.س
                </span>
              </div>
              <div style={{ marginTop: '0.8rem' }}>
                <Link href={`/statement?partyId=${party.id}`} style={{
                  display: 'inline-block', padding: '0.35rem 0.8rem',
                  background: 'rgba(99,102,241,0.15)', color: '#818cf8',
                  borderRadius: '6px', textDecoration: 'none', fontSize: '0.75rem',
                }}>
                  كشف الحساب →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
