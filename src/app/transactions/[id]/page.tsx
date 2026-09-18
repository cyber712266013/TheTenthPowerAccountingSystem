'use client';

import { use, useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface Transaction {
  id: string;
  transactionDate: string;
  details: string;
  reference: string | null;
  operationType: string;
  direction: string;
  amount: number;
  onUs: number;
  forUs: number;
  balanceBefore: number;
  balanceAfter: number;
  currency: string;
  status: string;
  notes: string | null;
  extraFields: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  approvedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  party: { id: string; name: string; type: string } | null;
  document: { id: string; fileName: string; mimeType: string } | null;
  createdBy: { name: string } | null;
  approvedBy: { name: string } | null;
}

const OP_LABELS: Record<string, string> = {
  invoice: 'فاتورة', payment: 'دفعة', receipt: 'إيصال استلام',
  refund: 'استرداد', adjustment: 'تسوية', other: 'أخرى',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  pending:  { label: 'انتظار', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', icon: '⏳' },
  approved: { label: 'معتمد',  color: '#10b981', bg: 'rgba(16,185,129,0.15)',  icon: '✅' },
  voided:   { label: 'ملغي',   color: '#ef4444', bg: 'rgba(239,68,68,0.15)',   icon: '🚫' },
  rejected: { label: 'مرفوض', color: '#6b7280', bg: 'rgba(107,114,128,0.15)', icon: '❌' },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function TransactionDetailPage({ params }: PageProps) {
  return (
    <Suspense fallback={<div style={{ textAlign: 'center', padding: '4rem', color: '#6366f1' }}>⟳</div>}>
      <TransactionContent params={params} />
    </Suspense>
  );
}

function TransactionContent({ params }: PageProps) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const justApproved = searchParams.get('approved') === '1';

  const [tx, setTx] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [showVoidForm, setShowVoidForm] = useState(false);

  useEffect(() => {
    fetch(`/api/transactions/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setTx(data.data);
        else setError(data.error || 'لم تُوجد الحركة');
        setLoading(false);
      })
      .catch(() => { setError('خطأ في الاتصال'); setLoading(false); });
  }, [id]);

  async function handleVoid() {
    if (!voidReason.trim()) { alert('يجب إدخال سبب الإلغاء'); return; }
    if (!confirm('هل أنت متأكد من إلغاء هذه الحركة المالية؟')) return;
    setVoiding(true);
    try {
      const res = await fetch(`/api/transactions/${id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: voidReason }),
      });
      const data = await res.json();
      if (data.success) {
        setTx(prev => prev ? { ...prev, status: 'voided', voidedAt: new Date().toISOString(), voidReason } : prev);
        setShowVoidForm(false);
      } else {
        alert(data.error || 'فشل الإلغاء');
      }
    } catch {
      alert('خطأ في الاتصال');
    } finally {
      setVoiding(false);
    }
  }

  const fmt = (n: number) => n.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <div style={{ textAlign: 'center', color: '#6366f1' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⟳</div>
        <p style={{ color: '#94a3b8' }}>جاري التحميل...</p>
      </div>
    </div>
  );

  if (error || !tx) return (
    <div style={{ padding: '2rem', direction: 'rtl' }}>
      <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '12px', padding: '1.5rem', color: '#ef4444', marginBottom: '1rem' }}>
        ❌ {error || 'لم تُوجد الحركة المالية'}
      </div>
      <Link href="/transactions" style={{ color: '#6366f1', textDecoration: 'none' }}>← العودة للحركات المالية</Link>
    </div>
  );

  const statusInfo = STATUS_CONFIG[tx.status] || STATUS_CONFIG.pending;
  const isDebit = tx.direction === 'gave' || tx.onUs > 0;

  return (
    <div style={{ direction: 'rtl', padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>

      {/* نجاح الاعتماد */}
      {justApproved && tx.status === 'approved' && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))',
          border: '1px solid rgba(16,185,129,0.4)', borderRadius: '14px',
          padding: '1.2rem 1.5rem', marginBottom: '1.5rem',
          display: 'flex', alignItems: 'center', gap: '1rem',
        }}>
          <span style={{ fontSize: '2rem' }}>🎉</span>
          <div>
            <p style={{ color: '#10b981', fontWeight: 700, margin: 0, fontSize: '1.05rem' }}>
              تم اعتماد الحركة المالية بنجاح!
            </p>
            <p style={{ color: '#6ee7b7', fontSize: '0.85rem', margin: '0.2rem 0 0' }}>
              تمت إضافتها لكشف الحساب تلقائياً
            </p>
          </div>
          <div style={{ marginRight: 'auto', display: 'flex', gap: '0.6rem' }}>
            <Link href="/statement" style={{
              padding: '0.5rem 1.1rem', background: 'rgba(16,185,129,0.2)',
              color: '#10b981', borderRadius: '8px', textDecoration: 'none',
              fontSize: '0.85rem', fontWeight: 600, border: '1px solid rgba(16,185,129,0.3)',
            }}>
              📋 كشف الحساب
            </Link>
            <Link href="/documents" style={{
              padding: '0.5rem 1.1rem', background: 'rgba(255,255,255,0.05)',
              color: '#94a3b8', borderRadius: '8px', textDecoration: 'none',
              fontSize: '0.85rem', border: '1px solid rgba(255,255,255,0.1)',
            }}>
              المستندات
            </Link>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
            <Link href="/transactions" style={{ color: '#6366f1', textDecoration: 'none', fontSize: '0.85rem' }}>← الحركات المالية</Link>
          </div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f1f5f9', margin: 0 }}>
            💳 تفاصيل الحركة المالية
          </h1>
          {tx.reference && (
            <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '0.3rem' }}>
              المرجع: {tx.reference}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{
            padding: '0.4rem 1rem', borderRadius: '20px', fontWeight: 700,
            fontSize: '0.85rem', background: statusInfo.bg, color: statusInfo.color,
          }}>
            {statusInfo.icon} {statusInfo.label}
          </span>
          {tx.status === 'approved' && (
            <button onClick={() => setShowVoidForm(v => !v)}
              style={{
                padding: '0.45rem 1rem', borderRadius: '8px',
                background: 'rgba(239,68,68,0.12)', color: '#ef4444',
                border: '1px solid rgba(239,68,68,0.25)',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.82rem', fontWeight: 600,
              }}>
              🚫 إلغاء الحركة
            </button>
          )}
        </div>
      </div>

      {/* بطاقة المبلغ الرئيسية */}
      <div style={{
        background: isDebit
          ? 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.04))'
          : 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(16,185,129,0.04))',
        border: `1px solid ${isDebit ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
        borderRadius: '16px', padding: '1.5rem 2rem', marginBottom: '1.5rem',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem',
      }}>
        <div>
          <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0 0 0.3rem' }}>
            {OP_LABELS[tx.operationType] || tx.operationType} — {isDebit ? 'عليه (مدين)' : 'له (دائن)'}
          </p>
          <p style={{
            fontSize: '2.2rem', fontWeight: 800, margin: 0,
            color: isDebit ? '#ef4444' : '#10b981',
          }}>
            {isDebit ? '−' : '+'} {fmt(tx.amount || tx.onUs || tx.forUs)} {tx.currency}
          </p>
          <p style={{ color: '#475569', fontSize: '0.8rem', marginTop: '0.4rem' }}>
            {tx.details}
          </p>
        </div>
        <div style={{ textAlign: 'left' }}>
          <p style={{ color: '#64748b', fontSize: '0.75rem', margin: '0 0 0.2rem' }}>الرصيد بعد العملية</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#e2e8f0', margin: 0 }}>
            {fmt(tx.balanceAfter)} {tx.currency}
          </p>
          <p style={{ color: '#475569', fontSize: '0.75rem', marginTop: '0.2rem' }}>
            قبلها: {fmt(tx.balanceBefore)} {tx.currency}
          </p>
        </div>
      </div>

      {/* نموذج إلغاء الحركة */}
      {showVoidForm && (
        <div style={{
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: '12px', padding: '1.2rem', marginBottom: '1.5rem',
        }}>
          <p style={{ color: '#ef4444', fontWeight: 600, marginBottom: '0.8rem' }}>
            ⚠️ إلغاء الحركة المالية — هذا الإجراء لا يمكن التراجع عنه
          </p>
          <textarea
            value={voidReason}
            onChange={e => setVoidReason(e.target.value)}
            placeholder="سبب الإلغاء (مطلوب)..."
            rows={2}
            style={{
              width: '100%', padding: '0.6rem', borderRadius: '8px',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#e2e8f0', fontFamily: 'inherit', fontSize: '0.9rem',
              boxSizing: 'border-box', resize: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem' }}>
            <button onClick={handleVoid} disabled={voiding || !voidReason.trim()}
              style={{
                padding: '0.5rem 1.2rem', background: 'rgba(239,68,68,0.8)',
                color: 'white', border: 'none', borderRadius: '8px',
                cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                opacity: (!voidReason.trim() || voiding) ? 0.5 : 1,
              }}>
              {voiding ? '⟳ جاري الإلغاء...' : '🚫 تأكيد الإلغاء'}
            </button>
            <button onClick={() => setShowVoidForm(false)}
              style={{
                padding: '0.5rem 1rem', background: 'transparent',
                color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
              }}>
              إلغاء
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

        {/* التفاصيل */}
        <div style={cardStyle}>
          <h3 style={sectionTitle}>📋 تفاصيل العملية</h3>
          <Row label="التاريخ" value={fmtDate(tx.transactionDate)} />
          <Row label="نوع العملية" value={OP_LABELS[tx.operationType] || tx.operationType} />
          <Row label="الاتجاه" value={tx.direction === 'gave' ? '← عليه (دفعنا)' : '→ له (استلمنا)'} />
          <Row label="العملة" value={tx.currency} />
          {tx.reference && <Row label="المرجع" value={tx.reference} />}
          {tx.notes && <Row label="ملاحظات" value={tx.notes} />}
        </div>

        {/* المبالغ */}
        <div style={cardStyle}>
          <h3 style={sectionTitle}>💰 المبالغ</h3>
          <Row label="عليه" value={`${fmt(tx.onUs)} ${tx.currency}`} color={tx.onUs > 0 ? '#ef4444' : undefined} />
          <Row label="له" value={`${fmt(tx.forUs)} ${tx.currency}`} color={tx.forUs > 0 ? '#10b981' : undefined} />
          <Row label="الرصيد السابق" value={`${fmt(tx.balanceBefore)} ${tx.currency}`} />
          <Row label="الرصيد الجديد" value={`${fmt(tx.balanceAfter)} ${tx.currency}`}
            color={tx.balanceAfter >= 0 ? '#10b981' : '#ef4444'} bold />
        </div>

        {/* الطرف */}
        {tx.party && (
          <div style={cardStyle}>
            <h3 style={sectionTitle}>🏢 الطرف</h3>
            <Row label="الاسم" value={tx.party.name} />
            <Row label="النوع" value={tx.party.type} />
            <div style={{ marginTop: '0.8rem' }}>
              <Link href={`/statement?partyId=${tx.party.id}`}
                style={{ color: '#6366f1', fontSize: '0.82rem', textDecoration: 'none' }}>
                📋 كشف حساب هذا الطرف →
              </Link>
            </div>
          </div>
        )}

        {/* المستند المرتبط */}
        {tx.document && (
          <div style={cardStyle}>
            <h3 style={sectionTitle}>📄 المستند المرتبط</h3>
            <Row label="الملف" value={tx.document.fileName} />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
              <Link href={`/documents/${tx.document.id}/review`}
                style={{
                  padding: '0.35rem 0.8rem', background: 'rgba(99,102,241,0.15)',
                  color: '#818cf8', borderRadius: '6px', textDecoration: 'none',
                  fontSize: '0.8rem', border: '1px solid rgba(99,102,241,0.2)',
                }}>
                👁️ عرض المستند
              </Link>
            </div>
          </div>
        )}

        {/* معلومات النظام */}
        <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
          <h3 style={sectionTitle}>🔧 معلومات النظام</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem' }}>
            <Row label="أُنشئت بتاريخ" value={fmtDate(tx.createdAt)} />
            {tx.approvedAt && <Row label="اعتُمدت بتاريخ" value={fmtDate(tx.approvedAt)} />}
            {tx.createdBy && <Row label="أنشأها" value={tx.createdBy.name} />}
            {tx.approvedBy && <Row label="اعتمدها" value={tx.approvedBy.name} />}
            {tx.voidedAt && <Row label="أُلغيت بتاريخ" value={fmtDate(tx.voidedAt)} />}
            {tx.voidReason && <Row label="سبب الإلغاء" value={tx.voidReason} />}
          </div>
        </div>

        {/* حقول إضافية */}
        {tx.extraFields && Object.keys(tx.extraFields).length > 0 && (
          <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
            <h3 style={sectionTitle}>🔧 بيانات إضافية</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem' }}>
              {Object.entries(tx.extraFields).map(([k, v]) => (
                <Row key={k} label={k} value={String(v)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* أزرار التنقل */}
      <div style={{ display: 'flex', gap: '0.8rem', marginTop: '2rem', justifyContent: 'flex-end' }}>
        <Link href="/transactions" style={{
          padding: '0.6rem 1.4rem', borderRadius: '10px',
          background: 'rgba(255,255,255,0.05)', color: '#94a3b8',
          border: '1px solid rgba(255,255,255,0.1)', textDecoration: 'none', fontSize: '0.9rem',
        }}>
          ← قائمة الحركات
        </Link>
        <Link href="/statement" style={{
          padding: '0.6rem 1.4rem', borderRadius: '10px',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          color: 'white', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 600,
          boxShadow: '0 4px 15px rgba(99,102,241,0.4)',
        }}>
          📋 كشف الحساب
        </Link>
      </div>
    </div>
  );
}

// ─── مكونات مساعدة ───────────────────────────────────────────
function Row({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0.35rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: '#64748b', fontSize: '0.8rem', flexShrink: 0 }}>{label}</span>
      <span style={{ color: color || '#e2e8f0', fontSize: '0.85rem', fontWeight: bold ? 700 : 400, textAlign: 'left', maxWidth: '60%', wordBreak: 'break-word' }}>
        {value}
      </span>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '14px', padding: '1.2rem',
};

const sectionTitle: React.CSSProperties = {
  fontSize: '0.95rem', fontWeight: 700,
  color: '#e2e8f0', margin: '0 0 0.8rem 0',
};
