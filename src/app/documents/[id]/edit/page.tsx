'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface PartyOption {
  id: string;
  name: string;
  type: string;
}

interface ItemRow {
  description: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  total: number;
}

interface DocumentData {
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
  invoice?: {
    id: string;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    currency: string;
    subtotal: number;
    taxAmount: number;
    discount: number;
    total: number;
    paidAmount: number;
    remainingAmount: number;
    notes: string | null;
    partyId: string | null;
    party?: { id: string; name: string; type: string } | null;
    items?: Array<{
      id: string;
      description: string;
      unit: string | null;
      quantity: number | null;
      unitPrice: number | null;
      total: number;
    }>;
  } | null;
  transactions?: Array<{
    id: string;
    partyId: string | null;
    party?: { name: string } | null;
    amount: number;
    direction: 'gave' | 'received';
    operationType: string;
    transactionDate: string;
    details: string;
    status: string;
  }>;
  extractedData?: Record<string, any> | null;
}

const DOCUMENT_TYPES = [
  { value: 'invoice', label: 'فاتورة (مبيعات / مشتريات)' },
  { value: 'bank_transfer', label: 'إشعار تحويل بنكي' },
  { value: 'payment_receipt', label: 'سند قبض / دفع' },
  { value: 'receipt', label: 'وصل استلام' },
  { value: 'account_statement', label: 'كشف حساب' },
  { value: 'expense', label: 'مصروف' },
  { value: 'debit_note', label: 'إشعار مدين' },
  { value: 'credit_note', label: 'إشعار دائن' },
  { value: 'handwritten', label: 'مستند بخط اليد' },
  { value: 'other', label: 'نوع آخر' },
];

const OPERATION_TYPES = [
  { value: 'invoice', label: 'فاتورة' },
  { value: 'bank_transfer', label: 'تحويل بنكي' },
  { value: 'payment', label: 'سند صرف' },
  { value: 'receipt', label: 'سند قبض' },
  { value: 'expense', label: 'مصروف' },
  { value: 'opening_balance', label: 'رصيد افتتاحي' },
  { value: 'adjustment', label: 'تسوية حساب' },
  { value: 'credit_note', label: 'إشعار دائن' },
  { value: 'debit_note', label: 'إشعار مدين' },
  { value: 'manual', label: 'قيد يدوي' },
];

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EditDocumentPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();

  const [doc, setDoc] = useState<DocumentData | null>(null);
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  // ─── بيانات التعديل الشاملة ──────────────────────────────
  const [fileName, setFileName] = useState('');
  const [documentType, setDocumentType] = useState('invoice');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [currency, setCurrency] = useState('SAR');

  // المبالغ
  const [subtotal, setSubtotal] = useState<number>(0);
  const [taxAmount, setTaxAmount] = useState<number>(0);
  const [discount, setDiscount] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [remainingAmount, setRemainingAmount] = useState<number>(0);

  // اتجاه وبيان الحركة
  const [direction, setDirection] = useState<'gave' | 'received'>('gave');
  const [operationType, setOperationType] = useState('invoice');
  const [details, setDetails] = useState('');
  const [notes, setNotes] = useState('');

  // البنود
  const [items, setItems] = useState<ItemRow[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const [docRes, partiesRes] = await Promise.all([
          fetch(`/api/documents/${id}`),
          fetch('/api/parties'),
        ]);
        const docJson = await docRes.json();
        const partiesJson = await partiesRes.json();

        if (!docJson.success) {
          setError(docJson.error || 'لم يتم العثور على المستند');
          setLoading(false);
          return;
        }

        const d: DocumentData = docJson.data;
        setDoc(d);
        setParties(partiesJson.data || []);

        // ملء الحقول من البيانات الموجودة
        setFileName(d.fileName || '');

        const inv = d.invoice;
        const tx = d.transactions && d.transactions.length > 0 ? d.transactions[0] : null;
        const ext = d.extractedData || {};

        setDocumentType(
          ext.document_type || (inv ? 'invoice' : 'other')
        );

        setInvoiceNumber(
          inv?.invoiceNumber ||
          ext.invoice_number?.value ||
          ''
        );

        // تاريخ
        const rawDate = inv?.invoiceDate || tx?.transactionDate || ext.invoice_date?.value || d.uploadedAt;
        if (rawDate) {
          try {
            setInvoiceDate(new Date(rawDate).toISOString().split('T')[0]);
          } catch {
            setInvoiceDate('');
          }
        }

        // الطرف
        const pName = inv?.party?.name || tx?.party?.name || ext.party?.name?.value || '';
        let pId = inv?.partyId || tx?.partyId || '';
        if (!pId && pName && partiesJson.data?.length > 0) {
          const norm = pName
            .trim()
            .toLowerCase()
            .replace(/[\u064B-\u065F\u0670]/g, '')
            .replace(/[أإآ]/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/ى/g, 'ي')
            .replace(/\s+/g, ' ');
          const found = partiesJson.data.find((p: any) => {
            const pNorm = (p.normalizedName || p.name || '')
              .toLowerCase()
              .replace(/[\u064B-\u065F\u0670]/g, '')
              .replace(/[أإآ]/g, 'ا')
              .replace(/ة/g, 'ه')
              .replace(/ى/g, 'ي')
              .replace(/\s+/g, ' ');
            return pNorm === norm || p.name.trim() === pName.trim();
          });
          if (found) pId = found.id;
        }
        setPartyId(pId);
        setPartyName(pName);

        // العملة والمبالغ
        setCurrency(inv?.currency || 'SAR');
        setSubtotal(inv ? Number(inv.subtotal) : Number(ext.financial?.subtotal?.value || 0));
        setTaxAmount(inv ? Number(inv.taxAmount) : Number(ext.financial?.tax_amount?.value || 0));
        setDiscount(inv ? Number(inv.discount) : Number(ext.financial?.discount?.value || 0));
        setTotal(inv ? Number(inv.total) : tx ? Number(tx.amount) : Number(ext.financial?.total?.value || 0));
        setPaidAmount(inv ? Number(inv.paidAmount) : Number(ext.financial?.paid?.value || 0));
        setRemainingAmount(inv ? Number(inv.remainingAmount) : Number(ext.financial?.remaining?.value || 0));

        // الحركة
        setDirection(tx?.direction || ext.transaction?.direction?.value || 'gave');
        setOperationType(tx?.operationType || ext.transaction?.operation?.value || 'invoice');
        setDetails(tx?.details || ext.transaction?.description?.value || '');
        setNotes((d.metadata?.notes as string) || inv?.notes || '');

        // البنود
        if (inv?.items && inv.items.length > 0) {
          setItems(
            inv.items.map(it => ({
              description: it.description,
              unit: it.unit || undefined,
              quantity: it.quantity ? Number(it.quantity) : undefined,
              unitPrice: it.unitPrice ? Number(it.unitPrice) : undefined,
              total: Number(it.total),
            }))
          );
        } else if (Array.isArray(ext.items) && ext.items.length > 0) {
          setItems(
            ext.items.map((it: any) => ({
              description: it.description?.value || it.description || '',
              unit: it.unit?.value || it.unit || undefined,
              quantity: it.quantity?.value ?? it.quantity ?? undefined,
              unitPrice: it.unitPrice?.value ?? it.unit_price?.value ?? undefined,
              total: Number(it.total?.value ?? it.total ?? 0),
            }))
          );
        }
      } catch (err) {
        console.error(err);
        setError('خطأ في تحميل بيانات المستند');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [id]);

  // تحديث الطرف عند اختياره من القائمة
  function handlePartySelect(selectedId: string) {
    setPartyId(selectedId);
    const found = parties.find(p => p.id === selectedId);
    if (found) {
      setPartyName(found.name);
    }
  }

  // إضافة بند جديد
  function addItem() {
    setItems(prev => [...prev, { description: '', quantity: 1, unitPrice: 0, total: 0 }]);
  }

  // تعديل بند
  function updateItem(index: number, field: keyof ItemRow, val: any) {
    setItems(prev => {
      const copy = [...prev];
      const row = { ...copy[index], [field]: val };
      if (field === 'quantity' || field === 'unitPrice') {
        const q = Number(field === 'quantity' ? val : row.quantity || 1);
        const p = Number(field === 'unitPrice' ? val : row.unitPrice || 0);
        row.total = Math.round(q * p * 100) / 100;
      }
      copy[index] = row;
      return copy;
    });
  }

  // حذف بند
  function removeItem(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index));
  }

  // حفظ التعديلات الشاملة
  async function handleSave() {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload = {
        fileName,
        documentType,
        invoiceNumber,
        invoiceDate,
        partyId: partyId || undefined,
        partyName: partyName || undefined,
        currency,
        subtotal: Number(subtotal) || 0,
        taxAmount: Number(taxAmount) || 0,
        discount: Number(discount) || 0,
        total: Number(total) || 0,
        paidAmount: Number(paidAmount) || 0,
        remainingAmount: Number(remainingAmount) || 0,
        operationType,
        direction,
        details,
        notes,
        items,
      };

      const res = await fetch(`/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setSuccess('✅ تم حفظ التعديلات بنجاح في نفس المستند وتحديث كشف الحساب مباشرة!');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setError(data.error || 'فشل حفظ التعديلات');
      }
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  }

  // حذف المستند
  async function handleDelete() {
    if (!confirm(`هل أنت متأكد من حذف المستند "${fileName || doc?.fileName}"؟\nلا يمكن التراجع عن هذا الإجراء.`)) return;
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

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.8rem' }}>⏳</div>
          <p style={{ fontSize: '1.1rem' }}>جاري تحميل بيانات المستند للتعديل...</p>
        </div>
      </div>
    );
  }

  if (error && !doc) {
    return (
      <div style={{ padding: '2rem', direction: 'rtl', maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '12px', padding: '1.5rem', color: '#ef4444' }}>
          ❌ {error}
        </div>
        <Link href="/documents" style={{ display: 'inline-block', marginTop: '1rem', color: '#6366f1', textDecoration: 'none' }}>
          ← العودة لقائمة المستندات
        </Link>
      </div>
    );
  }

  const isApproved = doc?.processingStatus === 'approved';
  const hasTx = doc?.transactions && doc.transactions.length > 0;

  return (
    <div style={{ direction: 'rtl', padding: '2rem 1.5rem', maxWidth: '1100px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.4rem' }}>
            <Link href="/documents" style={{ color: '#6366f1', textDecoration: 'none', fontSize: '0.9rem' }}>
              ← المستندات
            </Link>
            <span style={{ color: '#334155' }}>/</span>
            <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>تعديل شامل</span>
          </div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
            ✏️ تعديل بيانات المستند المالي
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '0.3rem' }}>
            {doc?.originalFileName} • رقم المستند الداخلي: <code style={{ color: '#818cf8' }}>{doc?.id}</code>
          </p>
        </div>

        {/* Quick Actions */}
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setShowPreview(prev => !prev)}
            style={{
              padding: '0.6rem 1.1rem', borderRadius: '8px',
              background: showPreview ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)',
              color: showPreview ? '#a5b4fc' : '#cbd5e1',
              border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 600,
            }}
          >
            {showPreview ? '🙈 إخفاء المعاينة' : '👁️ عرض المستند الأصلي'}
          </button>

          <Link
            href={`/documents/${id}/review`}
            style={{
              padding: '0.6rem 1.1rem', borderRadius: '8px',
              background: 'rgba(99,102,241,0.15)', color: '#818cf8',
              textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600,
              border: '1px solid rgba(99,102,241,0.3)',
            }}
          >
            📋 شاشة المراجعة
          </Link>

          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            style={{
              padding: '0.6rem 1.1rem', borderRadius: '8px',
              background: 'rgba(239,68,68,0.12)', color: '#f87171',
              border: '1px solid rgba(239,68,68,0.25)', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 600,
            }}
          >
            {deleting ? '⟳ جاري الحذف...' : '🗑️ حذف المستند'}
          </button>
        </div>
      </div>

      {/* Inline Document Preview (Collapsible) */}
      {showPreview && (
        <div style={{
          background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '14px', padding: '1rem', marginBottom: '2rem',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
            <span style={{ fontWeight: 600, color: '#94a3b8', fontSize: '0.9rem' }}>📄 معاينة المستند المرفق:</span>
            <a
              href={`/api/documents/${id}/file`}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#6366f1', fontSize: '0.85rem', textDecoration: 'none' }}
            >
              فتح في نافذة مستقلة ↗
            </a>
          </div>
          {doc?.mimeType.includes('pdf') ? (
            <iframe
              src={`/api/documents/${id}/file`}
              style={{ width: '100%', height: '550px', border: 'none', borderRadius: '8px', background: '#ffffff' }}
              title="معاينة المستند"
            />
          ) : (
            <div style={{ textAlign: 'center', background: '#000', borderRadius: '8px', padding: '1rem' }}>
              <img
                src={`/api/documents/${id}/file`}
                alt="المستند"
                style={{ maxWidth: '100%', maxHeight: '550px', objectFit: 'contain' }}
              />
            </div>
          )}
        </div>
      )}

      {/* Success / Error Alerts */}
      {success && (
        <div style={{
          background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)',
          color: '#4ade80', borderRadius: '12px', padding: '1.2rem', marginBottom: '1.5rem',
          fontSize: '0.95rem', fontWeight: 600,
        }}>
          {success}
        </div>
      )}

      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#f87171', borderRadius: '12px', padding: '1.2rem', marginBottom: '1.5rem',
          fontSize: '0.95rem', fontWeight: 600,
        }}>
          ❌ {error}
        </div>
      )}

      {/* Status Info Banner */}
      <div style={{
        background: isApproved
          ? 'linear-gradient(135deg, rgba(34,197,94,0.08), rgba(16,185,129,0.04))'
          : 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(217,119,6,0.04))',
        border: isApproved ? '1px solid rgba(34,197,94,0.25)' : '1px solid rgba(245,158,11,0.25)',
        borderRadius: '14px', padding: '1.2rem 1.5rem', marginBottom: '2rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <span style={{ fontSize: '1.8rem' }}>{isApproved ? '✅' : '📝'}</span>
          <div>
            <div style={{ fontWeight: 700, color: isApproved ? '#4ade80' : '#fbbf24', fontSize: '1rem' }}>
              {isApproved ? 'المستند معتمد ومسجل في كشف الحساب' : 'المستند قيد المراجعة / مسودة'}
            </div>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0.2rem 0 0 0' }}>
              {isApproved
                ? 'أي تعديل تحفظه هنا سيقوم بتحديث نفس المستند وتحديث الحركة في كشف الحساب تلقائياً دون الحاجة للاعتماد مجدداً.'
                : 'تعديل البيانات هنا يحفظ التغييرات في نفس النسخة ويكون المستند جاهزاً للاعتماد في أي وقت.'}
            </p>
          </div>
        </div>
        {hasTx && (
          <span style={{
            background: 'rgba(255,255,255,0.08)', color: '#e2e8f0',
            padding: '0.4rem 0.8rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600,
          }}>
            مرتبط بالحركة #{doc?.transactions?.[0]?.id.substring(0, 10)}
          </span>
        )}
      </div>

      {/* Main Edit Form */}
      <form onSubmit={(e) => { e.preventDefault(); handleSave(); }}>

        {/* Section 1: Basic Document Details */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px', padding: '1.5rem', marginBottom: '1.5rem',
        }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9', marginTop: 0, marginBottom: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>📄</span> البيانات الأساسية للمستند
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.2rem' }}>
            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>
                نوع المستند
              </label>
              <select
                value={documentType}
                onChange={e => setDocumentType(e.target.value)}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.05)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'inherit', fontSize: '0.9rem',
                }}
              >
                {DOCUMENT_TYPES.map(t => (
                  <option key={t.value} value={t.value} style={{ background: '#1e293b' }}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>
                رقم الفاتورة / المرجع
              </label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={e => setInvoiceNumber(e.target.value)}
                placeholder="مثلاً: INV-2026-001 أو رقم الحوالة"
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.05)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'inherit', fontSize: '0.9rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>
                تاريخ المستند / الحركة
              </label>
              <input
                type="date"
                value={invoiceDate}
                onChange={e => setInvoiceDate(e.target.value)}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.05)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'inherit', fontSize: '0.9rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>
                اسم الملف في النظام
              </label>
              <input
                type="text"
                value={fileName}
                onChange={e => setFileName(e.target.value)}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.05)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'inherit', fontSize: '0.9rem',
                }}
              />
            </div>
          </div>
        </div>

        {/* Section 2: Party Details */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px', padding: '1.5rem', marginBottom: '1.5rem',
        }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9', marginTop: 0, marginBottom: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🏢</span> الطرف المالي (العميل / المورد / المستفيد)
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.2rem' }}>
            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>
                اختر من الأطراف المسجلة
              </label>
              <select
                value={partyId}
                onChange={e => handlePartySelect(e.target.value)}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.05)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'inherit', fontSize: '0.9rem',
                }}
              >
                <option value="" style={{ background: '#1e293b' }}>-- اختيار طرف مسجل --</option>
                {parties.map(p => (
                  <option key={p.id} value={p.id} style={{ background: '#1e293b' }}>
                    {p.name} ({p.type === 'customer' ? 'عميل' : p.type === 'supplier' ? 'مورد' : 'أخرى'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>
                اسم الطرف (كما يظهر في المستند أو إضافة جديد)
              </label>
              <input
                type="text"
                value={partyName}
                onChange={e => setPartyName(e.target.value)}
                placeholder="اسم الشركة أو العميل أو المورد"
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.05)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'inherit', fontSize: '0.9rem',
                }}
              />
            </div>
          </div>
        </div>

        {/* Section 3: Financial Figures */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px', padding: '1.5rem', marginBottom: '1.5rem',
        }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9', marginTop: 0, marginBottom: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>💰</span> المبالغ المالية والحسابات
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1.2rem' }}>
            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>
                المجموع الفرعي (Subtotal)
              </label>
              <input
                type="number"
                step="0.01"
                value={subtotal}
                onChange={e => setSubtotal(parseFloat(e.target.value) || 0)}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.05)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'inherit', fontSize: '0.9rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>
                مبلغ الضريبة
              </label>
              <input
                type="number"
                step="0.01"
                value={taxAmount}
                onChange={e => setTaxAmount(parseFloat(e.target.value) || 0)}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.05)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'inherit', fontSize: '0.9rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>
                الخصم
              </label>
              <input
                type="number"
                step="0.01"
                value={discount}
                onChange={e => setDiscount(parseFloat(e.target.value) || 0)}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.05)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'inherit', fontSize: '0.9rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#38bdf8', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 700 }}>
                الإجمالي النهائي (Total) ★
              </label>
              <input
                type="number"
                step="0.01"
                value={total}
                onChange={e => setTotal(parseFloat(e.target.value) || 0)}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '10px',
                  background: 'rgba(56,189,248,0.1)', color: '#38bdf8', fontWeight: 700,
                  border: '1px solid rgba(56,189,248,0.3)', fontFamily: 'inherit', fontSize: '1rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>
                المدفوع
              </label>
              <input
                type="number"
                step="0.01"
                value={paidAmount}
                onChange={e => setPaidAmount(parseFloat(e.target.value) || 0)}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.05)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'inherit', fontSize: '0.9rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>
                المتبقي
              </label>
              <input
                type="number"
                step="0.01"
                value={remainingAmount}
                onChange={e => setRemainingAmount(parseFloat(e.target.value) || 0)}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.05)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'inherit', fontSize: '0.9rem',
                }}
              />
            </div>
          </div>
        </div>

        {/* Section 4: Accounting Movement (Ledger Action) */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px', padding: '1.5rem', marginBottom: '1.5rem',
        }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9', marginTop: 0, marginBottom: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>⚖️</span> حركة كشف الحساب (مدين / دائن)
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.2rem', marginBottom: '1.2rem' }}>
            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>
                اتجاه العملية المحاسبية
              </label>
              <select
                value={direction}
                onChange={e => setDirection(e.target.value as 'gave' | 'received')}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '10px',
                  background: direction === 'gave' ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                  color: direction === 'gave' ? '#fca5a5' : '#86efac', fontWeight: 700,
                  border: direction === 'gave' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(34,197,94,0.3)',
                  fontFamily: 'inherit', fontSize: '0.9rem',
                }}
              >
                <option value="gave" style={{ background: '#1e293b', color: '#fca5a5' }}>
                  ← عليه (مدين / دفعنا له أو بيع بالأجل)
                </option>
                <option value="received" style={{ background: '#1e293b', color: '#86efac' }}>
                  → له (دائن / استلمنا منه أو شراء بالأجل)
                </option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>
                نوع العملية
              </label>
              <select
                value={operationType}
                onChange={e => setOperationType(e.target.value)}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.05)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'inherit', fontSize: '0.9rem',
                }}
              >
                {OPERATION_TYPES.map(op => (
                  <option key={op.value} value={op.value} style={{ background: '#1e293b' }}>
                    {op.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.4rem', fontWeight: 600 }}>
              البيان / شرح الحركة في كشف الحساب
            </label>
            <input
              type="text"
              value={details}
              onChange={e => setDetails(e.target.value)}
              placeholder="مثال: سداد دفعة عن طريق تحويل بنكي / توريد زجاج..."
              style={{
                width: '100%', padding: '0.75rem', borderRadius: '10px',
                background: 'rgba(255,255,255,0.05)', color: '#fff',
                border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'inherit', fontSize: '0.9rem',
              }}
            />
          </div>
        </div>

        {/* Section 5: Line Items (Optional for Invoices) */}
        {documentType !== 'bank_transfer' && (
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '16px', padding: '1.5rem', marginBottom: '1.5rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>📦</span> بنود الفاتورة ({items.length})
              </h2>
              <button
                type="button"
                onClick={addItem}
                style={{
                  padding: '0.4rem 0.9rem', borderRadius: '8px',
                  background: 'rgba(99,102,241,0.2)', color: '#818cf8',
                  border: '1px solid rgba(99,102,241,0.35)', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: '0.82rem', fontWeight: 600,
                }}
              >
                + إضافة بند
              </button>
            </div>

            {items.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0.5rem 0' }}>
                لا توجد بنود مسجلة لهذا المستند. يمكنك الضغط على "+ إضافة بند" لإضافة تفاصيل.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {items.map((row, idx) => (
                  <div key={idx} style={{
                    display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr auto',
                    gap: '0.6rem', alignItems: 'center',
                    background: 'rgba(255,255,255,0.02)', padding: '0.6rem',
                    borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <input
                      type="text"
                      value={row.description}
                      onChange={e => updateItem(idx, 'description', e.target.value)}
                      placeholder="وصف الصنف / البند"
                      style={{
                        padding: '0.5rem', borderRadius: '6px', background: 'rgba(255,255,255,0.05)',
                        color: '#fff', border: '1px solid rgba(255,255,255,0.1)', fontFamily: 'inherit', fontSize: '0.85rem',
                      }}
                    />
                    <input
                      type="number"
                      value={row.quantity ?? ''}
                      onChange={e => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                      placeholder="الكمية"
                      style={{
                        padding: '0.5rem', borderRadius: '6px', background: 'rgba(255,255,255,0.05)',
                        color: '#fff', border: '1px solid rgba(255,255,255,0.1)', fontFamily: 'inherit', fontSize: '0.85rem',
                      }}
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={row.unitPrice ?? ''}
                      onChange={e => updateItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                      placeholder="السعر"
                      style={{
                        padding: '0.5rem', borderRadius: '6px', background: 'rgba(255,255,255,0.05)',
                        color: '#fff', border: '1px solid rgba(255,255,255,0.1)', fontFamily: 'inherit', fontSize: '0.85rem',
                      }}
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={row.total}
                      onChange={e => updateItem(idx, 'total', parseFloat(e.target.value) || 0)}
                      placeholder="الإجمالي"
                      style={{
                        padding: '0.5rem', borderRadius: '6px', background: 'rgba(255,255,255,0.05)',
                        color: '#38bdf8', fontWeight: 600, border: '1px solid rgba(255,255,255,0.1)', fontFamily: 'inherit', fontSize: '0.85rem',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      style={{
                        padding: '0.45rem 0.7rem', borderRadius: '6px',
                        background: 'rgba(239,68,68,0.12)', color: '#f87171',
                        border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer',
                        fontSize: '0.8rem',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Section 6: Notes */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px', padding: '1.5rem', marginBottom: '2rem',
        }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9', marginTop: 0, marginBottom: '0.8rem' }}>
            📝 ملاحظات إضافية
          </h2>
          <textarea
            rows={3}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="اكتب أي ملاحظات محاسبية أو تفاصيل للمستند..."
            style={{
              width: '100%', padding: '0.75rem', borderRadius: '10px',
              background: 'rgba(255,255,255,0.05)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'inherit', fontSize: '0.9rem',
            }}
          />
        </div>

        {/* Save Bar */}
        <div style={{
          position: 'sticky', bottom: '1.5rem',
          background: 'rgba(15,23,42,0.92)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.15)', borderRadius: '16px',
          padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
          zIndex: 50, flexWrap: 'wrap', gap: '1rem',
        }}>
          <div>
            <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>حفظ التعديلات:</span>
            <strong style={{ color: '#f8fafc', display: 'block', fontSize: '1rem' }}>
              سيتم التحديث مباشرة في نفس النسخة بقاعدة البيانات
            </strong>
          </div>

          <div style={{ display: 'flex', gap: '0.8rem' }}>
            <Link
              href="/documents"
              style={{
                padding: '0.75rem 1.4rem', borderRadius: '10px',
                background: 'rgba(255,255,255,0.08)', color: '#cbd5e1',
                textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem',
                border: '1px solid rgba(255,255,255,0.12)',
              }}
            >
              إلغاء
            </Link>

            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '0.75rem 2rem', borderRadius: '10px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#ffffff', fontWeight: 700, fontSize: '1rem',
                border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 15px rgba(99,102,241,0.4)',
                fontFamily: 'inherit', opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? '⏳ جاري حفظ التعديلات...' : '💾 حفظ التعديلات في نفس المستند'}
            </button>
          </div>
        </div>

      </form>
    </div>
  );
}
