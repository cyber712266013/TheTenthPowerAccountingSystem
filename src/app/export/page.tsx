'use client';
import { useState } from 'react';

export default function ExportPage() {
  const [exporting, setExporting] = useState(false);
  const [format, setFormat] = useState<'csv' | 'excel' | 'pdf'>('csv');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ format });
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);

      const res = await fetch(`/api/export?${params}`);
      if (!res.ok) {
        alert('تعذر التصدير. سيتم إضافة هذه الميزة قريباً');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `كشف-الحساب.${format}`;
      a.click();
    } catch {
      alert('تعذر التصدير. سيتم إضافة هذه الميزة قريباً');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ direction: 'rtl', padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '2rem' }}>
        📥 تصدير البيانات
      </h1>

      <div style={{
        background: 'rgba(255,255,255,0.04)', borderRadius: '16px',
        border: '1px solid rgba(255,255,255,0.08)', padding: '2rem',
        display: 'flex', flexDirection: 'column', gap: '1.2rem',
      }}>
        <div>
          <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
            صيغة التصدير
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {(['csv', 'excel', 'pdf'] as const).map(f => (
              <button key={f} onClick={() => setFormat(f)}
                style={{
                  padding: '0.5rem 1rem', borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: format === f ? 'rgba(99,102,241,0.3)' : 'transparent',
                  color: format === f ? '#818cf8' : '#64748b',
                  cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                  textTransform: 'uppercase',
                }}>
                {f}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              من تاريخ
            </label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{
                width: '100%', padding: '0.6rem 0.8rem',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px', color: '#e2e8f0', fontFamily: 'inherit', fontSize: '0.85rem',
                boxSizing: 'border-box',
              }} />
          </div>
          <div>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              إلى تاريخ
            </label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{
                width: '100%', padding: '0.6rem 0.8rem',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px', color: '#e2e8f0', fontFamily: 'inherit', fontSize: '0.85rem',
                boxSizing: 'border-box',
              }} />
          </div>
        </div>

        <button onClick={handleExport} disabled={exporting}
          style={{
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: 'white', padding: '0.8rem', borderRadius: '10px',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontWeight: 600, fontSize: '0.95rem',
            opacity: exporting ? 0.7 : 1,
          }}>
          {exporting ? '⟳ جاري التصدير...' : '📥 تصدير الآن'}
        </button>
      </div>
    </div>
  );
}
