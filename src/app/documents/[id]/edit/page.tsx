'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface DocumentEdit {
  id: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  processingStatus: string;
  uploadedAt: string;
  warnings: string[];
  metadata: Record<string, unknown> | null;
  customFields: Record<string, unknown> | null;
  uploadedBy: { name: string } | null;
}

const STATUS_OPTIONS = [
  { value: 'uploaded',      label: 'مرفوع — انتظار التحليل' },
  { value: 'needs_review',  label: 'بانتظار المراجعة' },
  { value: 'extracted',     label: 'تم الاستخراج' },
  { value: 'approved',      label: 'معتمد' },
  { value: 'rejected',      label: 'مرفوض' },
  { value: 'failed',        label: 'فشل التحليل' },
];

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EditDocumentPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();

  const [doc, setDoc] = useState<DocumentEdit | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // حقول التعديل
  const [fileName, setFileName] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  useEffect(() => {
    fetch(`/api/documents/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          const d = data.data;
          setDoc(d);
          setFileName(d.fileName);
          setStatus(d.processingStatus);
          setNotes((d.metadata?.notes as string) || '');
          const cf = d.customFields || {};
          setCustomFields(
            Object.fromEntries(
              Object.entries(cf).map(([k, v]) => [k, String(v)])
            )
          );
        } else {
          setError(data.error || 'لم يُوجد المستند');
        }
        setLoading(false);
      })
      .catch(() => { setError('خطأ في الاتصال'); setLoading(false); });
  }, [id]);

  async function handleSave() {
    if (!fileName.trim()) { setError('اسم الملف مطلوب'); return; }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, notes, status, customFields }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess('✅ تم حفظ التعديلات بنجاح');
        setDoc(prev => prev ? { ...prev, fileName, processingStatus: status } : prev);
      } else {
        setError(data.error || 'فشل الحفظ');
      }
    } catch {
      setError('خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`هل أنت متأكد من حذف المستند "${doc?.fileName}"؟\nلا يمكن التراجع عن هذا الإجراء.`)) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        router.push('/documents');
      } else {
        setError(data.error || 'فشل الحذف');
        setDeleting(false);
      }
    } catch {
      setError('خطأ في الاتصال');
      setDeleting(false);
    }
  }

  function addCustomField() {
    if (!newKey.trim()) return;
    setCustomFields(prev => ({ ...prev, [newKey.trim()]: newVal }));
    setNewKey(''); setNewVal('');
  }

  function removeCustomField(key: string) {
    setCustomFields(prev => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  }

  const formatSize = (b: number) => b < 1024 * 1024
    ? `${(b / 1024).toFixed(1)} KB`
    : `${(b / (1024 * 1024)).toFixed(1)} MB`;

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <div style={{ textAlign: 'center', color: '#94a3b8' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⟳</div>
        <p>جاري التحميل...</p>
      </div>
    </div>
  );

  if (error && !doc) return (
    <div style={{ padding: '2rem', direction: 'rtl' }}>
      <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', padding: '1rem', color: '#ef4444' }}>
        ❌ {error}
      </div>
      <Link href="/documents" style={{ display: 'inline-block', marginTop: '1rem', color: '#6366f1' }}>
        ← العودة للمستندات
      </Link>
    </div>
  );

  return (
    <div style={{ direction: 'rtl', padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.3rem' }}>
            <Link href="/documents" style={{ color: '#6366f1', textDecoration: 'none', fontSize: '0.85rem' }}>
              ← المستندات
            </Link>
            <span style={{ color: '#334155' }}>/</span>
            <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>تعديل</span>
          </div>
          <h1 style={{ fontSize: '1.7rem', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
            ✏️ تعديل المستند
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '0.3rem' }}>{doc?.originalFileName}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <Link href={`/documents/${id}/review`} style={{
            padding: '0.55rem 1.1rem', borderRadius: '8px',
            background: 'rgba(99,102,241,0.15)', color: '#818cf8',
            textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600,
            border: '1px solid rgba(99,102,241,0.3)',
          }}>
            👁️ صفحة المراجعة
          </Link>
          <button onClick={handleDelete} disabled={deleting} style={{
            padding: '0.55rem 1.1rem', borderRadius: '8px',
            background: 'rgba(239,68,68,0.15)', color: '#ef4444',
            border: '1px solid rgba(239,68,68,0.3)',
            cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 600,
          }}>
            {deleting ? '⟳ جاري الحذف...' : '🗑️ حذف المستند'}
          </button>
        </div>
      </div>

      {/* Document Info Card */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: '12px', padding: '1.2rem', marginBottom: '1.5rem',
        display: 'flex', gap: '1.5rem', flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ color: '#475569', fontSize: '0.75rem', marginBottom: '0.2rem' }}>نوع الملف</div>
          <div style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>{doc?.mimeType}</div>
        </div>
        <div>
          <div style={{ color: '#475569', fontSize: '0.75rem', marginBottom: '0.2rem' }}>الحجم</div>
          <div style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>{formatSize(doc?.fileSizeBytes || 0)}</div>
        </div>
        <div>
          <div style={{ color: '#475569', fontSize: '0.75rem', marginBottom: '0.2rem' }}>رُفع بواسطة</div>
          <div style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>{doc?.uploadedBy?.name || '—'}</div>
        </div>
        <div>
          <div style={{ color: '#475569', fontSize: '0.75rem', marginBottom: '0.2rem' }}>تاريخ الرفع</div>
          <div style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>
            {doc?.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString('ar-SA') : '—'}
          </div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '10px', padding: '0.9rem 1.2rem', marginBottom: '1.2rem', color: '#ef4444', fontSize: '0.9rem' }}>
          ❌ {error}
        </div>
      )}
      {success && (
        <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '10px', padding: '0.9rem 1.2rem', marginBottom: '1.2rem', color: '#10b981', fontSize: '0.9rem' }}>
          {success}
        </div>
      )}

      {/* Edit Form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

        {/* اسم الملف */}
        <div style={cardStyle}>
          <h3 style={sectionTitle}>📄 معلومات الملف</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>اسم الملف</label>
              <input
                value={fileName}
                onChange={e => setFileName(e.target.value)}
                style={inputStyle}
                placeholder="اسم الملف..."
              />
            </div>
            <div>
              <label style={labelStyle}>حالة المستند</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                style={inputStyle}
              >
                {STATUS_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* الملاحظات */}
        <div style={cardStyle}>
          <h3 style={sectionTitle}>📝 ملاحظات</h3>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={4}
            placeholder="أضف ملاحظات على هذا المستند..."
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>

        {/* الحقول المخصصة */}
        <div style={cardStyle}>
          <h3 style={sectionTitle}>🔧 حقول إضافية مخصصة</h3>
          <p style={{ color: '#475569', fontSize: '0.8rem', marginBottom: '1rem', marginTop: '-0.5rem' }}>
            أضف أي بيانات إضافية تحتاجها (مثل: رقم العقد، المشروع، القسم، إلخ)
          </p>

          {/* الحقول الموجودة */}
          {Object.keys(customFields).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
              {Object.entries(customFields).map(([key, val]) => (
                <div key={key} style={{
                  display: 'flex', gap: '0.5rem', alignItems: 'center',
                  background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '0.5rem 0.7rem',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  <span style={{ color: '#6366f1', fontWeight: 600, fontSize: '0.85rem', minWidth: '120px' }}>{key}</span>
                  <span style={{ color: '#94a3b8', flex: 1 }}>:</span>
                  <input
                    value={val}
                    onChange={e => setCustomFields(prev => ({ ...prev, [key]: e.target.value }))}
                    style={{ ...inputStyle, flex: 2, padding: '0.35rem 0.6rem', margin: 0 }}
                  />
                  <button onClick={() => removeCustomField(key)} style={{
                    background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                    border: 'none', borderRadius: '6px', padding: '0.3rem 0.6rem',
                    cursor: 'pointer', fontSize: '0.8rem',
                  }}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* إضافة حقل جديد */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              placeholder="اسم الحقل (مثل: رقم العقد)"
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: '150px', margin: 0 }}
              onKeyDown={e => e.key === 'Enter' && addCustomField()}
            />
            <input
              placeholder="القيمة"
              value={newVal}
              onChange={e => setNewVal(e.target.value)}
              style={{ ...inputStyle, flex: 2, minWidth: '150px', margin: 0 }}
              onKeyDown={e => e.key === 'Enter' && addCustomField()}
            />
            <button onClick={addCustomField} style={{
              padding: '0.55rem 1rem', background: 'rgba(99,102,241,0.2)',
              color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
            }}>
              + إضافة
            </button>
          </div>
        </div>

        {/* معاينة الملف */}
        <div style={cardStyle}>
          <h3 style={sectionTitle}>👁️ معاينة المستند</h3>
          <div style={{ borderRadius: '8px', overflow: 'hidden', background: '#0f172a', minHeight: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {doc?.mimeType === 'application/pdf' ? (
              <iframe
                src={`/api/documents/${id}/file`}
                style={{ width: '100%', height: '400px', border: 'none' }}
                title="معاينة"
              />
            ) : doc?.mimeType.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/documents/${id}/file`}
                alt="معاينة"
                style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain' }}
              />
            ) : (
              <div style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>📄</div>
                <a href={`/api/documents/${id}/file`} download={doc?.fileName}
                  style={{ color: '#6366f1', textDecoration: 'none' }}>
                  ⬇️ تحميل الملف
                </a>
              </div>
            )}
          </div>
        </div>

        {/* أزرار الحفظ */}
        <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'flex-end', paddingTop: '0.5rem' }}>
          <button onClick={() => router.back()} style={{
            padding: '0.7rem 1.5rem', borderRadius: '10px',
            background: 'rgba(255,255,255,0.05)', color: '#94a3b8',
            border: '1px solid rgba(255,255,255,0.1)',
            cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.9rem',
          }}>
            إلغاء
          </button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: '0.7rem 2rem', borderRadius: '10px',
            background: saving ? 'rgba(99,102,241,0.5)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: 'white', border: 'none',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', fontSize: '0.9rem', fontWeight: 700,
            boxShadow: saving ? 'none' : '0 4px 15px rgba(99,102,241,0.4)',
          }}>
            {saving ? '⟳ جاري الحفظ...' : '💾 حفظ التعديلات'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────
const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '14px',
  padding: '1.4rem',
};

const sectionTitle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 700,
  color: '#e2e8f0',
  margin: '0 0 1rem 0',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  color: '#94a3b8',
  fontSize: '0.82rem',
  marginBottom: '0.4rem',
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.6rem 0.9rem',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  color: '#e2e8f0',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  boxSizing: 'border-box' as const,
  outline: 'none',
};
