'use client';

import { use, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { ReviewFormData, ReviewItemData, GeminiExtractionResult, OperationType, TransactionDirection, Currency } from '@/lib/types';

interface ReviewPageProps {
  params: Promise<{ id: string }>;
}

interface DocumentData {
  id: string;
  fileName: string;
  mimeType: string;
  processingStatus: string;
  overallConfidence: number | null;
  warnings: string[];
  googleDriveViewLink: string | null;
  rawExtraction: GeminiExtractionResult | null;
  extractedData: Record<string, unknown> | null;
  uploadedAt: string;
}

const OPERATION_LABELS: Record<OperationType, string> = {
  invoice: 'فاتورة',
  payment: 'دفعة',
  receipt: 'إيصال استلام',
  bank_transfer: 'تحويل بنكي',
  expense: 'مصروف',
  opening_balance: 'رصيد افتتاحي',
  adjustment: 'تعديل',
  credit_note: 'إشعار دائن',
  debit_note: 'إشعار مدين',
  manual: 'إدخال يدوي',
  other: 'أخرى',
};

export default function ReviewPage({ params }: ReviewPageProps) {
  const router = useRouter();
  const { id } = use(params);

  const [doc, setDoc] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [parties, setParties] = useState<{ id: string; name: string; type: string }[]>([]);
  const [activeTab, setActiveTab] = useState<'info' | 'items' | 'transaction' | 'raw'>('info');
  const [partySearch, setPartySearch] = useState('');
  const [showPartyDropdown, setShowPartyDropdown] = useState(false);

  const [form, setForm] = useState<ReviewFormData>({
    documentType: 'invoice',
    invoiceNumber: '',
    invoiceDate: '',
    partyId: '',
    partyName: '',
    currency: 'SAR',
    subtotal: 0,
    taxAmount: 0,
    discount: 0,
    total: 0,
    paidAmount: 0,
    remainingAmount: 0,
    items: [],
    operationType: 'invoice',
    direction: 'gave',
    transactionDate: new Date().toISOString().split('T')[0],
    details: '',
    notes: '',
    extraFields: {},
  });

  const [mathWarning, setMathWarning] = useState('');
  const [newExtraKey, setNewExtraKey] = useState('');
  const [newExtraVal, setNewExtraVal] = useState('');

  // ─── Load document ────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const [docRes, partiesRes] = await Promise.all([
          fetch(`/api/documents/${id}`),
          fetch('/api/parties'),
        ]);
        const docData = await docRes.json();
        const partiesData = await partiesRes.json();

        if (!docData.success) {
          setError(docData.error || 'المستند غير موجود');
          return;
        }

        setDoc(docData.data);
        setParties(partiesData.data || []);

        // Pre-fill form from extraction
        const extraction = docData.data.rawExtraction as GeminiExtractionResult | null;
        if (extraction) {
          const partyMatch = (docData.data.extractedData as Record<string, unknown>)?.partyMatch as {
            matchFound: boolean; partyId?: string; partyName?: string;
          } | undefined;

          const items: ReviewItemData[] = (extraction.items || []).map(item => ({
            description: item.description?.value || '',
            unit: item.unit?.value || undefined,
            quantity: item.quantity?.value ?? undefined,
            unitPrice: item.unit_price?.value ?? undefined,
            taxRate: item.tax_rate?.value ?? undefined,
            taxAmount: item.tax_amount?.value ?? undefined,
            discount: item.discount?.value ?? undefined,
            total: item.total?.value || 0,
          }));

          setForm(f => ({
            ...f,
            documentType: (extraction.document_type as ReviewFormData['documentType']) || 'invoice',
            invoiceNumber: extraction.invoice_number?.value || '',
            invoiceDate: extraction.invoice_date?.value || '',
            partyId: partyMatch?.partyId || '',
            partyName: extraction.party?.name?.value || '',
            currency: (extraction.financial?.currency?.value as Currency) || 'SAR',
            subtotal: extraction.financial?.subtotal?.value || 0,
            taxAmount: extraction.financial?.tax_amount?.value || 0,
            discount: extraction.financial?.discount?.value || 0,
            total: extraction.financial?.total?.value || 0,
            paidAmount: extraction.financial?.paid?.value || 0,
            remainingAmount: extraction.financial?.remaining?.value || 0,
            items: items.length > 0 ? items : f.items,
            operationType: (extraction.transaction?.operation?.value as OperationType) || 'invoice',
            direction: (extraction.transaction?.direction?.value as TransactionDirection) || 'gave',
            transactionDate: extraction.invoice_date?.value || f.transactionDate,
            details: extraction.transaction?.description?.value || '',
          }));

          setPartySearch(extraction.party?.name?.value || '');
        }
      } catch {
        setError('فشل تحميل بيانات المستند');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  // ─── Math validation (client-side preview only) ───────────
  useEffect(() => {
    // لا داعي للتحذير في الحوالات والسندات أو إذا لم يكن هناك تفصيل للضريبة والمجموع الفرعي
    const isTransferOrReceipt = ['bank_transfer', 'payment_receipt', 'receipt', 'account_statement'].includes(form.documentType);
    if (isTransferOrReceipt || (form.subtotal === 0 && form.taxAmount === 0 && form.discount === 0)) {
      setMathWarning('');
      return;
    }
    const calc = form.subtotal + form.taxAmount - form.discount;
    const diff = Math.abs(calc - form.total);
    if (diff > 0.01 && form.total > 0) {
      setMathWarning(`تحذير: الإجمالي المحسوب (${calc.toFixed(2)}) يختلف عن المُدخل (${form.total.toFixed(2)})`);
    } else {
      setMathWarning('');
    }
  }, [form.subtotal, form.taxAmount, form.discount, form.total, form.documentType]);

  function updateForm(updates: Partial<ReviewFormData>) {
    setForm(f => ({ ...f, ...updates }));
  }

  // ─── Items CRUD ───────────────────────────────────────────
  function addItem() {
    setForm(f => ({
      ...f,
      items: [...f.items, { description: '', total: 0 }],
    }));
  }

  function updateItem(idx: number, updates: Partial<ReviewItemData>) {
    setForm(f => ({
      ...f,
      items: f.items.map((item, i) => i === idx ? { ...item, ...updates } : item),
    }));
  }

  function removeItem(idx: number) {
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  // ─── Extra Fields ─────────────────────────────────────────
  function addExtraField() {
    if (!newExtraKey.trim()) return;
    setForm(f => ({
      ...f,
      extraFields: { ...f.extraFields, [newExtraKey.trim()]: newExtraVal },
    }));
    setNewExtraKey('');
    setNewExtraVal('');
  }

  function removeExtraField(key: string) {
    setForm(f => {
      const fields = { ...f.extraFields };
      delete fields[key];
      return { ...f, extraFields: fields };
    });
  }

  // ─── Submit ───────────────────────────────────────────────
  async function handleApprove() {
    if (!form.partyId && !form.partyName) {
      setError('يجب تحديد الطرف أو إدخال اسمه');
      return;
    }
    if (!form.total || form.total === 0) {
      setError('يجب إدخال المبلغ الإجمالي');
      return;
    }
    if (!form.details) {
      setError('يجب إدخال البيان');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch(`/api/documents/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (data.success) {
        router.push(`/transactions/${data.transactionId}?approved=1`);
      } else {
        setError(data.error || 'فشل اعتماد المستند');
      }
    } catch {
      setError('حدث خطأ في الاتصال');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    if (!confirm('هل تريد رفض هذا المستند؟')) return;
    await fetch(`/api/documents/${id}/reject`, { method: 'POST' });
    router.push('/documents');
  }

  // ─── Re-Analyze (مع إمكانية رفع الملف مجدداً) ────────────
  async function handleReAnalyze(fileInput?: File) {
    setSubmitting(true);
    setError('');
    try {
      if (fileInput) {
        // رفع الملف أولاً ثم تحليله
        const fd = new FormData();
        fd.append('file', fileInput);
        fd.append('documentId', id); // للربط بالـ document الحالي
        // نرفع ملف جديد ونُحدّث الـ document الحالي
        const uploadRes = await fetch('/api/documents/upload', { method: 'POST', body: fd });
        const uploadData = await uploadRes.json();
        if (!uploadData.success) {
          setError(uploadData.error || 'فشل رفع الملف');
          return;
        }
      }
      // تحليل المستند الحالي
      const res = await fetch(`/api/documents/${id}/analyze`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        window.location.reload();
      } else {
        setError(data.error || 'فشل التحليل');
      }
    } catch {
      setError('حدث خطأ في الاتصال');
    } finally {
      setSubmitting(false);
    }
  }

  function triggerFileReupload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.webp,.tiff,.bmp,.doc,.docx,.xls,.xlsx';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleReAnalyze(file);
    };
    input.click();
  }

  // ─── Confidence Badge ─────────────────────────────────────
  function ConfidenceBadge({ value }: { value: number }) {
    const pct = Math.round(value * 100);
    const cls = pct >= 90 ? 'high' : pct >= 70 ? 'medium' : 'low';
    const color = pct >= 90 ? 'var(--color-success)' : pct >= 70 ? 'var(--color-warning)' : 'var(--color-danger)';
    return (
      <span style={{ fontSize: 'var(--font-size-xs)', color, fontWeight: 700 }}>
        {pct}%
      </span>
    );
  }

  const filteredParties = parties.filter(p =>
    !partySearch || p.name.toLowerCase().includes(partySearch.toLowerCase())
  );

  if (loading) return (
    <div className="flex items-center justify-center" style={{ height: '60vh' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: 'var(--space-4)', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</div>
        <p className="text-muted">جاري تحميل المستند...</p>
      </div>
    </div>
  );

  if (error && !doc) return (
    <div className="alert alert-danger">
      <span className="alert-icon">❌</span>
      <div className="alert-body">{error}</div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 800 }}>مراجعة المستند</h1>
          <p className="text-muted text-sm mt-1">{doc?.fileName}</p>
        </div>
        <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => router.back()}>رجوع</button>
          <button
            className="btn btn-warning btn-sm"
            onClick={() => handleReAnalyze()}
            disabled={submitting}
            title="إعادة تحليل المستند بالذكاء الاصطناعي"
          >
            🤖 {submitting ? 'جاري...' : 'إعادة تحليل'}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={triggerFileReupload}
            disabled={submitting}
            title="رفع الملف مجدداً وإعادة تحليله (إذا كان الملف مفقوداً)"
          >
            📂 رفع وتحليل
          </button>
          <button className="btn btn-danger btn-sm" onClick={handleReject}>رفض</button>
          <button
            className={`btn btn-success ${submitting ? 'btn-loading' : ''}`}
            onClick={handleApprove}
            disabled={submitting}
          >
            {!submitting && '✓ اعتماد وإنشاء حركة مالية'}
          </button>
        </div>
      </div>

      {/* Confidence + Warnings */}
      {doc?.overallConfidence !== null && (
        <div className="card mb-6">
          <div className="card-body">
            <div className="flex items-center gap-6 flex-wrap">
              <div>
                <div className="text-xs text-muted mb-1">الثقة الكلية</div>
                <div className="confidence-bar" style={{ minWidth: 200 }}>
                  <div className="confidence-track">
                    <div
                      className={`confidence-fill ${(doc?.overallConfidence || 0) >= 0.9 ? 'high' : (doc?.overallConfidence || 0) >= 0.7 ? 'medium' : 'low'}`}
                      style={{ width: `${(doc?.overallConfidence || 0) * 100}%` }}
                    />
                  </div>
                  <span className="confidence-label" style={{ color: (doc?.overallConfidence || 0) >= 0.9 ? 'var(--color-success)' : (doc?.overallConfidence || 0) >= 0.7 ? 'var(--color-warning)' : 'var(--color-danger)' }}>
                    {Math.round((doc?.overallConfidence || 0) * 100)}%
                  </span>
                </div>
              </div>

              {(doc?.overallConfidence || 0) < 0.8 && (
                <div className="alert alert-warning" style={{ flex: 1, margin: 0 }}>
                  <span className="alert-icon">⚠️</span>
                  <div className="alert-body">
                    <strong>بعض البيانات تحتاج إلى مراجعة دقيقة</strong> — الثقة الكلية أقل من 80%
                  </div>
                </div>
              )}
            </div>

            {(doc?.warnings?.length || 0) > 0 && (
              <div className="mt-4">
                {[...new Set(doc?.warnings || [])].map((w, i) => (
                  <div key={i} className="alert alert-warning mt-2" style={{ padding: 'var(--space-3)' }}>
                    <span className="alert-icon">⚠️</span>
                    <div className="alert-body text-sm">{w}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Math Warning */}
      {mathWarning && (
        <div className="alert alert-warning mb-4">
          <span className="alert-icon">🔢</span>
          <div className="alert-body">{mathWarning}</div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="alert alert-danger mb-4">
          <span className="alert-icon">❌</span>
          <div className="alert-body">{error}</div>
        </div>
      )}

      {/* Split View */}
      <div className="split-view">
        {/* LEFT: Document Preview */}
        <div className="split-panel">
          <div className="split-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>📄 المستند الأصلي</span>
            {doc?.googleDriveViewLink && (
              <a href={doc.googleDriveViewLink} target="_blank" rel="noopener"
                style={{ fontSize: '0.75rem', color: '#6366f1', textDecoration: 'none' }}>
                فتح في Drive ↗
              </a>
            )}
          </div>
          <div className="split-panel-body" style={{ padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch', overflow: 'hidden' }}>
            {doc && (() => {
              const fileUrl = `/api/documents/${doc.id}/file`;
              const isImage = doc.mimeType.startsWith('image/');
              const isPdf = doc.mimeType === 'application/pdf';

              if (isPdf) {
                return (
                  <iframe
                    src={fileUrl}
                    style={{ width: '100%', height: '100%', minHeight: '600px', border: 'none', flex: 1 }}
                    title="معاينة PDF"
                  />
                );
              }

              if (isImage) {
                return (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', padding: '1rem' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={fileUrl}
                      alt="معاينة المستند"
                      style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: '8px' }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        (e.target as HTMLImageElement).nextElementSibling?.removeAttribute('hidden');
                      }}
                    />
                    <div hidden style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                      <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🖼️</div>
                      <p>تعذّر تحميل الصورة</p>
                    </div>
                  </div>
                );
              }

              // Word / Excel / other → Google Docs viewer or download
              return (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '2rem' }}>
                  <div style={{ fontSize: '4rem' }}>
                    {doc.mimeType.includes('word') ? '📝' : doc.mimeType.includes('excel') || doc.mimeType.includes('sheet') ? '📊' : '📄'}
                  </div>
                  <p style={{ color: '#94a3b8', textAlign: 'center', fontSize: '0.9rem' }}>
                    {doc.fileName}
                  </p>
                  <a
                    href={fileUrl}
                    download={doc.fileName}
                    style={{
                      padding: '0.6rem 1.4rem',
                      background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                      color: 'white', borderRadius: '8px', textDecoration: 'none',
                      fontWeight: 600, fontSize: '0.85rem',
                    }}
                  >
                    ⬇️ تحميل الملف
                  </a>
                  {doc.googleDriveViewLink && (
                    <a
                      href={`https://docs.google.com/viewer?url=${encodeURIComponent(doc.googleDriveViewLink)}`}
                      target="_blank" rel="noopener"
                      style={{
                        padding: '0.5rem 1.2rem',
                        background: 'rgba(255,255,255,0.06)',
                        color: '#94a3b8', borderRadius: '8px', textDecoration: 'none',
                        fontSize: '0.8rem', border: '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      فتح في Google Docs ↗
                    </a>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* RIGHT: Extracted Data */}
        <div className="split-panel">
          <div className="split-panel-header">
            <span>✏️</span> البيانات المستخرجة
          </div>
          <div className="split-panel-body">
            {/* Tabs */}
            <div className="tabs">
              {([
                ['info', 'المعلومات الأساسية'],
                ['items', `البنود (${form.items.length})`],
                ['transaction', 'الحركة المالية'],
                ['raw', 'البيانات الخام'],
              ] as [string, string][]).map(([key, label]) => (
                <button
                  key={key}
                  className={`tab ${activeTab === key ? 'active' : ''}`}
                  onClick={() => setActiveTab(key as typeof activeTab)}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* ── Tab: Info ── */}
            {activeTab === 'info' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label className="form-label">نوع المستند</label>
                    <select
                      className="form-select"
                      value={form.documentType}
                      onChange={e => updateForm({ documentType: e.target.value as ReviewFormData['documentType'] })}
                    >
                      <option value="invoice">فاتورة</option>
                      <option value="payment_receipt">إيصال دفع</option>
                      <option value="bank_transfer">تحويل بنكي</option>
                      <option value="receipt">إيصال استلام</option>
                      <option value="debit_note">إشعار مدين</option>
                      <option value="credit_note">إشعار دائن</option>
                      <option value="expense">مصروف</option>
                      <option value="handwritten">مكتوب بخط اليد</option>
                      <option value="other">أخرى</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">رقم الفاتورة</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="INV-001 أو اتركه فارغًا"
                      value={form.invoiceNumber}
                      onChange={e => updateForm({ invoiceNumber: e.target.value })}
                    />
                    {doc?.rawExtraction?.invoice_number.confidence !== undefined && (
                      <div className="form-hint flex items-center gap-2">
                        ثقة: <ConfidenceBadge value={doc.rawExtraction.invoice_number.confidence} />
                      </div>
                    )}
                  </div>
                </div>

                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label className="form-label">تاريخ الفاتورة</label>
                    <input
                      type="date"
                      className="form-input"
                      value={form.invoiceDate}
                      onChange={e => updateForm({ invoiceDate: e.target.value })}
                    />
                    {doc?.rawExtraction?.invoice_date.confidence !== undefined && (
                      <div className="form-hint flex items-center gap-2">
                        ثقة: <ConfidenceBadge value={doc.rawExtraction.invoice_date.confidence} />
                      </div>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">العملة</label>
                    <select
                      className="form-select"
                      value={form.currency}
                      onChange={e => updateForm({ currency: e.target.value as Currency })}
                    >
                      <option value="SAR">ريال سعودي (SAR)</option>
                      <option value="USD">دولار أمريكي (USD)</option>
                      <option value="EUR">يورو (EUR)</option>
                      <option value="AED">درهم إماراتي (AED)</option>
                      <option value="other">أخرى</option>
                    </select>
                  </div>
                </div>

                {/* Party */}
                <div className="form-group">
                  <label className="form-label required">الطرف (مورد / عميل / شخص)</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="ابحث عن الطرف أو أدخل اسمًا جديدًا..."
                      value={partySearch}
                      onChange={e => {
                        setPartySearch(e.target.value);
                        updateForm({ partyId: '', partyName: e.target.value });
                        setShowPartyDropdown(true);
                      }}
                      onFocus={() => setShowPartyDropdown(true)}
                    />
                    {form.partyId && (
                      <span style={{
                        position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)',
                        color: 'var(--color-success)', fontSize: 'var(--font-size-sm)',
                      }}>✓ متطابق</span>
                    )}
                    {showPartyDropdown && filteredParties.length > 0 && (
                      <div style={{
                        position: 'absolute', top: '100%', right: 0, left: 0, zIndex: 50,
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius)',
                        maxHeight: '200px', overflowY: 'auto',
                        boxShadow: 'var(--shadow)',
                        marginTop: '4px',
                      }}>
                        {filteredParties.slice(0, 8).map(p => (
                          <div
                            key={p.id}
                            onClick={() => {
                              updateForm({ partyId: p.id, partyName: p.name });
                              setPartySearch(p.name);
                              setShowPartyDropdown(false);
                            }}
                            style={{
                              padding: 'var(--space-3) var(--space-4)',
                              cursor: 'pointer',
                              borderBottom: '1px solid var(--color-border)',
                              fontSize: 'var(--font-size-sm)',
                              transition: 'background var(--transition)',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                          >
                            <strong>{p.name}</strong>
                            <span className="badge badge-neutral" style={{ marginRight: 'var(--space-2)' }}>{p.type}</span>
                          </div>
                        ))}
                        {partySearch && !parties.find(p => p.name === partySearch) && (
                          <div
                            onClick={() => {
                              updateForm({ partyId: '', partyName: partySearch });
                              setShowPartyDropdown(false);
                            }}
                            style={{
                              padding: 'var(--space-3) var(--space-4)',
                              cursor: 'pointer',
                              color: 'var(--color-primary)',
                              fontSize: 'var(--font-size-sm)',
                            }}
                          >
                            + إنشاء طرف جديد: "{partySearch}"
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {doc?.rawExtraction?.party.name.confidence !== undefined && (
                    <div className="form-hint flex items-center gap-2">
                      ثقة: <ConfidenceBadge value={doc.rawExtraction.party.name.confidence} />
                    </div>
                  )}
                </div>

                {/* Amounts */}
                <hr className="divider" />
                <div className="form-grid form-grid-2">
                  {[
                    { key: 'subtotal', label: 'المبلغ الفرعي (قبل الضريبة)' },
                    { key: 'taxAmount', label: 'الضريبة' },
                    { key: 'discount', label: 'الخصم' },
                    { key: 'total', label: 'الإجمالي', required: true },
                    { key: 'paidAmount', label: 'المدفوع' },
                    { key: 'remainingAmount', label: 'المتبقي' },
                  ].map(({ key, label, required }) => (
                    <div className="form-group" key={key}>
                      <label className={`form-label ${required ? 'required' : ''}`}>{label}</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="form-input"
                        value={(form as unknown as Record<string, unknown>)[key] as number || ''}
                        onChange={e => updateForm({ [key]: parseFloat(e.target.value) || 0 } as Partial<ReviewFormData>)}
                      />
                    </div>
                  ))}
                </div>

                <div className="form-group">
                  <label className="form-label">ملاحظات</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    placeholder="أي ملاحظات إضافية..."
                    value={form.notes}
                    onChange={e => updateForm({ notes: e.target.value })}
                  />
                </div>

                {/* Extra Fields — المرونة الكاملة */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="form-label" style={{ margin: 0 }}>حقول إضافية مخصصة</label>
                    <span className="text-xs text-muted">رقم العقد، مركز التكلفة، أمر الشراء...</span>
                  </div>
                  {Object.entries(form.extraFields || {}).map(([key, val]) => (
                    <div key={key} className="flex gap-2 mb-2">
                      <input className="form-input" value={key} readOnly style={{ maxWidth: '180px', opacity: 0.7 }} />
                      <input
                        className="form-input"
                        value={String(val)}
                        onChange={e => setForm(f => ({ ...f, extraFields: { ...f.extraFields, [key]: e.target.value } }))}
                      />
                      <button className="btn btn-ghost btn-icon" onClick={() => removeExtraField(key)} title="حذف">✕</button>
                    </div>
                  ))}
                  <div className="flex gap-2 mt-2">
                    <input
                      className="form-input"
                      placeholder="اسم الحقل"
                      value={newExtraKey}
                      onChange={e => setNewExtraKey(e.target.value)}
                      style={{ maxWidth: '180px' }}
                    />
                    <input
                      className="form-input"
                      placeholder="القيمة"
                      value={newExtraVal}
                      onChange={e => setNewExtraVal(e.target.value)}
                    />
                    <button className="btn btn-secondary btn-sm" onClick={addExtraField}>+ إضافة</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab: Items ── */}
            {activeTab === 'items' && (
              <div>
                <div className="table-wrapper items-table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>البيان</th>
                        <th>الكمية</th>
                        <th>سعر الوحدة</th>
                        <th>الضريبة</th>
                        <th>الإجمالي</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.items.map((item, idx) => (
                        <tr key={idx}>
                          <td>
                            <input
                              className="form-input"
                              value={item.description}
                              onChange={e => updateItem(idx, { description: e.target.value })}
                              placeholder="وصف البند..."
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              className="form-input"
                              value={item.quantity || ''}
                              onChange={e => {
                                const qty = parseFloat(e.target.value) || undefined;
                                const up = item.unitPrice;
                                updateItem(idx, {
                                  quantity: qty,
                                  total: qty && up ? qty * up : item.total,
                                });
                              }}
                              placeholder="0"
                              style={{ maxWidth: '80px' }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              className="form-input"
                              value={item.unitPrice || ''}
                              onChange={e => {
                                const up = parseFloat(e.target.value) || undefined;
                                const qty = item.quantity;
                                updateItem(idx, {
                                  unitPrice: up,
                                  total: qty && up ? qty * up : item.total,
                                });
                              }}
                              placeholder="0.00"
                              style={{ maxWidth: '100px' }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              className="form-input"
                              value={item.taxAmount || ''}
                              onChange={e => updateItem(idx, { taxAmount: parseFloat(e.target.value) || undefined })}
                              placeholder="0.00"
                              style={{ maxWidth: '80px' }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              className="form-input"
                              value={item.total || ''}
                              onChange={e => updateItem(idx, { total: parseFloat(e.target.value) || 0 })}
                              placeholder="0.00"
                              style={{ maxWidth: '100px' }}
                            />
                          </td>
                          <td>
                            <button className="btn btn-ghost btn-icon" onClick={() => removeItem(idx)} title="حذف البند">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-between items-center mt-4">
                  <button className="btn btn-secondary btn-sm" onClick={addItem}>+ إضافة بند</button>
                  <div className="text-sm">
                    <span className="text-muted">مجموع البنود: </span>
                    <strong style={{ color: 'var(--color-balance)' }}>
                      {form.items.reduce((s, i) => s + i.total, 0).toFixed(2)}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab: Transaction ── */}
            {activeTab === 'transaction' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                <div className="form-group">
                  <label className="form-label required">نوع العملية</label>
                  <select
                    className="form-select"
                    value={form.operationType}
                    onChange={e => updateForm({ operationType: e.target.value as OperationType })}
                  >
                    {Object.entries(OPERATION_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label required">اتجاه العملية</label>
                  <div className="flex gap-3">
                    {[
                      { val: 'gave', label: 'عليه (مستحق علينا)', color: 'var(--color-debit)' },
                      { val: 'received', label: 'له (مستحق لنا)', color: 'var(--color-credit)' },
                    ].map(({ val, label, color }) => (
                      <div
                        key={val}
                        onClick={() => updateForm({ direction: val as TransactionDirection })}
                        style={{
                          flex: 1, padding: 'var(--space-4)', borderRadius: 'var(--radius)',
                          border: `2px solid ${form.direction === val ? color : 'var(--color-border)'}`,
                          background: form.direction === val ? `${color}20` : 'var(--color-surface)',
                          cursor: 'pointer', textAlign: 'center', transition: 'all var(--transition)',
                          color: form.direction === val ? color : 'var(--color-text-2)',
                          fontWeight: 700,
                        }}
                      >
                        {val === 'gave' ? '↑' : '↓'} {label}
                      </div>
                    ))}
                  </div>
                  {doc?.rawExtraction?.transaction.direction.confidence !== undefined && (
                    <div className="form-hint flex items-center gap-2">
                      ثقة: <ConfidenceBadge value={doc.rawExtraction.transaction.direction.confidence} />
                    </div>
                  )}
                </div>

                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label className="form-label required">تاريخ الحركة</label>
                    <input
                      type="date"
                      className="form-input"
                      value={form.transactionDate}
                      onChange={e => updateForm({ transactionDate: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label required">المبلغ</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-input"
                      value={form.total}
                      onChange={e => updateForm({ total: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label required">البيان</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="وصف الحركة المالية..."
                    value={form.details}
                    onChange={e => updateForm({ details: e.target.value })}
                  />
                </div>

                {/* Preview */}
                <div className="card" style={{ background: 'var(--color-surface)' }}>
                  <div className="card-body">
                    <div className="text-xs text-muted mb-3">معاينة الحركة المالية (الرصيد يُحسب في السيرفر)</div>
                    <div className="flex gap-6" style={{ justifyContent: 'space-around', textAlign: 'center' }}>
                      <div>
                        <div className="text-xs text-muted">عليه</div>
                        <div style={{ color: 'var(--color-debit)', fontWeight: 800, fontSize: 'var(--font-size-lg)' }}>
                          {form.direction === 'gave' ? form.total.toFixed(2) : '0.00'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted">له</div>
                        <div style={{ color: 'var(--color-credit)', fontWeight: 800, fontSize: 'var(--font-size-lg)' }}>
                          {form.direction === 'received' ? form.total.toFixed(2) : '0.00'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted">الرصيد</div>
                        <div style={{ color: 'var(--color-balance)', fontWeight: 800, fontSize: 'var(--font-size-lg)' }}>
                          يُحسب عند الاعتماد
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab: Raw ── */}
            {activeTab === 'raw' && (
              <div>
                <p className="text-xs text-muted mb-3">البيانات الخام المستخرجة من Gemini — للمرجع فقط</p>
                <pre style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--space-4)',
                  fontSize: '0.7rem',
                  overflowX: 'auto',
                  direction: 'ltr',
                  maxHeight: '500px',
                  overflowY: 'auto',
                  color: 'var(--color-text-2)',
                }}>
                  {JSON.stringify(doc?.rawExtraction, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
