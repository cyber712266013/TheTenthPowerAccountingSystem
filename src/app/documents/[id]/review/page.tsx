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
  invoice?: any;
  transactions?: any[];
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
  const [successMessage, setSuccessMessage] = useState('');
  const [invoiceCheck, setInvoiceCheck] = useState<{
    exists: boolean;
    isApproved?: boolean;
    otherDocument?: {
      documentId: string;
      fileName: string;
      partyName: string;
      total: number;
      isApproved: boolean;
      status: string;
      invoiceNumber: string;
      transactionId?: string;
    } | null;
    currentDocument?: {
      documentId: string;
      fileName: string;
      partyName: string;
      total: number;
      isApproved: boolean;
      status: string;
      invoiceNumber: string;
      transactionId?: string;
    } | null;
    partyName?: string;
    total?: number;
    documentId?: string;
    invoiceNumber?: string;
  } | null>(null);

  // ─── التحقق التلقائي إذا كان رقم الفاتورة مسجل ومعتمد في قواعد البيانات ───
  useEffect(() => {
    const invNum = form.invoiceNumber?.trim();
    if (!invNum || invNum.length < 3) {
      setInvoiceCheck(null);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/documents/check-invoice?number=${encodeURIComponent(invNum)}&excludeId=${id}`)
        .then(r => r.json())
        .then(data => {
          if (data.exists) setInvoiceCheck(data);
          else setInvoiceCheck(null);
        })
        .catch(() => setInvoiceCheck(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [form.invoiceNumber, id]);

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
        const partiesList = partiesData.data || [];
        setParties(partiesList);

        function matchPartyId(name: string): string {
          if (!name || partiesList.length === 0) return '';
          const norm = name
            .trim()
            .toLowerCase()
            .replace(/[\u064B-\u065F\u0670]/g, '')
            .replace(/[أإآ]/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/ى/g, 'ي')
            .replace(/\s+/g, ' ');
          const found = partiesList.find((p: any) => {
            const pNorm = (p.normalizedName || p.name || '')
              .toLowerCase()
              .replace(/[\u064B-\u065F\u0670]/g, '')
              .replace(/[أإآ]/g, 'ا')
              .replace(/ة/g, 'ه')
              .replace(/ى/g, 'ي')
              .replace(/\s+/g, ' ');
            return pNorm === norm || p.name.trim() === name.trim();
          });
          return found ? found.id : '';
        }

        // Pre-fill form: الأولوية لبيانات الفاتورة والحركة المسجلة بقاعدة البيانات، ثم الاستخراج الأولي
        const inv = docData.data.invoice;
        const tx = docData.data.transactions && docData.data.transactions.length > 0 ? docData.data.transactions[0] : null;
        const extraction = docData.data.rawExtraction as GeminiExtractionResult | null;
        const extracted = (docData.data.extractedData as Record<string, any>) || null;
        const partyMatch = extracted?.partyMatch as {
          matchFound: boolean; partyId?: string; partyName?: string;
        } | undefined;

        if (inv) {
          const invItems: ReviewItemData[] = (inv.items || []).map((it: any) => ({
            description: it.description || '',
            unit: it.unit || undefined,
            quantity: it.quantity !== null && it.quantity !== undefined ? parseFloat(it.quantity.toString()) : undefined,
            unitPrice: it.unitPrice !== null && it.unitPrice !== undefined ? parseFloat(it.unitPrice.toString()) : undefined,
            taxRate: it.taxRate !== null && it.taxRate !== undefined ? parseFloat(it.taxRate.toString()) : undefined,
            taxAmount: it.taxAmount !== null && it.taxAmount !== undefined ? parseFloat(it.taxAmount.toString()) : undefined,
            discount: it.discount !== null && it.discount !== undefined ? parseFloat(it.discount.toString()) : undefined,
            total: parseFloat(it.total?.toString() || '0'),
          }));

          const partyName = inv.party?.name || inv.partyNameRaw || extraction?.party?.name?.value || extracted?.party?.name?.value || '';
          const resolvedPartyId = inv.partyId || inv.party?.id || partyMatch?.partyId || matchPartyId(partyName);

          setForm(f => ({
            ...f,
            documentType: (tx?.operationType as ReviewFormData['documentType']) || (extraction?.document_type as ReviewFormData['documentType']) || (extracted?.document_type as ReviewFormData['documentType']) || 'invoice',
            invoiceNumber: inv.invoiceNumber || extraction?.invoice_number?.value || extracted?.invoice_number?.value || '',
            invoiceDate: inv.invoiceDate ? String(inv.invoiceDate).split('T')[0] : (extraction?.invoice_date?.value || extracted?.invoice_date?.value || ''),
            partyId: resolvedPartyId,
            partyName,
            currency: (inv.currency as Currency) || (extraction?.financial?.currency?.value as Currency) || (extracted?.financial?.currency?.value as Currency) || 'SAR',
            subtotal: parseFloat(inv.subtotal?.toString() || '0') || extraction?.financial?.subtotal?.value || extracted?.financial?.subtotal?.value || 0,
            taxAmount: parseFloat(inv.taxAmount?.toString() || '0') || extraction?.financial?.tax_amount?.value || extracted?.financial?.tax_amount?.value || 0,
            discount: parseFloat(inv.discount?.toString() || '0') || extraction?.financial?.discount?.value || extracted?.financial?.discount?.value || 0,
            total: parseFloat(inv.total?.toString() || '0') || extraction?.financial?.total?.value || extracted?.financial?.total?.value || 0,
            paidAmount: parseFloat(inv.paidAmount?.toString() || '0') || extraction?.financial?.paid?.value || extracted?.financial?.paid?.value || 0,
            remainingAmount: parseFloat(inv.remainingAmount?.toString() || '0') || extraction?.financial?.remaining?.value || extracted?.financial?.remaining?.value || 0,
            items: invItems.length > 0 ? invItems : f.items,
            operationType: (tx?.operationType as OperationType) || (extraction?.transaction?.operation?.value as OperationType) || (extracted?.transaction?.operation?.value as OperationType) || 'invoice',
            direction: (tx?.direction as TransactionDirection) || (extraction?.transaction?.direction?.value as TransactionDirection) || (extracted?.transaction?.direction?.value as TransactionDirection) || 'gave',
            transactionDate: tx?.transactionDate ? String(tx.transactionDate).split('T')[0] : (inv.invoiceDate ? String(inv.invoiceDate).split('T')[0] : (extraction?.invoice_date?.value || extracted?.invoice_date?.value || f.transactionDate)),
            details: tx?.details || inv.notes || extraction?.transaction?.description?.value || extracted?.transaction?.description?.value || '',
            notes: inv.notes || '',
            extraFields: inv.extraFields || {},
          }));

          setPartySearch(partyName);
        } else if (extraction || extracted) {
          const rawItems = extraction?.items || extracted?.items || [];
          const items: ReviewItemData[] = rawItems.map((item: any) => {
            const getVal = (field: any) => {
              if (field === null || field === undefined) return undefined;
              if (typeof field === 'object' && 'value' in field) {
                return field.value !== null && field.value !== undefined ? field.value : undefined;
              }
              return field;
            };

            const desc = getVal(item.description);
            const unit = getVal(item.unit);
            const qty = getVal(item.quantity);
            const unitPrice = getVal(item.unit_price ?? item.unitPrice);
            const taxRate = getVal(item.tax_rate ?? item.taxRate);
            const taxAmount = getVal(item.tax_amount ?? item.taxAmount);
            const discount = getVal(item.discount);
            const total = getVal(item.total);

            return {
              description: typeof desc === 'string' ? desc : String(desc || ''),
              unit: unit ? String(unit) : undefined,
              quantity: qty !== undefined && qty !== null ? parseFloat(String(qty)) : undefined,
              unitPrice: unitPrice !== undefined && unitPrice !== null ? parseFloat(String(unitPrice)) : undefined,
              taxRate: taxRate !== undefined && taxRate !== null ? parseFloat(String(taxRate)) : undefined,
              taxAmount: taxAmount !== undefined && taxAmount !== null ? parseFloat(String(taxAmount)) : undefined,
              discount: discount !== undefined && discount !== null ? parseFloat(String(discount)) : undefined,
              total: total !== undefined && total !== null ? (parseFloat(String(total)) || 0) : 0,
            };
          });

          const partyName = extraction?.party?.name?.value || extracted?.party?.name?.value || '';
          const resolvedPartyId = partyMatch?.partyId || matchPartyId(partyName);

          setForm(f => ({
            ...f,
            documentType: (extraction?.document_type as ReviewFormData['documentType']) || (extracted?.document_type as ReviewFormData['documentType']) || 'invoice',
            invoiceNumber: extraction?.invoice_number?.value || extracted?.invoice_number?.value || '',
            invoiceDate: extraction?.invoice_date?.value || extracted?.invoice_date?.value || '',
            partyId: resolvedPartyId,
            partyName,
            currency: (extraction?.financial?.currency?.value as Currency) || (extracted?.financial?.currency?.value as Currency) || 'SAR',
            subtotal: extraction?.financial?.subtotal?.value || extracted?.financial?.subtotal?.value || 0,
            taxAmount: extraction?.financial?.tax_amount?.value || extracted?.financial?.tax_amount?.value || 0,
            discount: extraction?.financial?.discount?.value || extracted?.financial?.discount?.value || 0,
            total: extraction?.financial?.total?.value || extracted?.financial?.total?.value || 0,
            paidAmount: extraction?.financial?.paid?.value || extracted?.financial?.paid?.value || 0,
            remainingAmount: extraction?.financial?.remaining?.value || extracted?.financial?.remaining?.value || 0,
            items: items.length > 0 ? items : f.items,
            operationType: (extraction?.transaction?.operation?.value as OperationType) || (extracted?.transaction?.operation?.value as OperationType) || 'invoice',
            direction: (extraction?.transaction?.direction?.value as TransactionDirection) || (extracted?.transaction?.direction?.value as TransactionDirection) || 'gave',
            transactionDate: extraction?.invoice_date?.value || extracted?.invoice_date?.value || f.transactionDate,
            details: extraction?.transaction?.description?.value || extracted?.transaction?.description?.value || '',
          }));

          setPartySearch(partyName);
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

    // تنبيه وتحذير إذا كان رقم الفاتورة معتمداً في مستند آخر
    if (invoiceCheck?.otherDocument?.isApproved) {
      const confirmDup = confirm(
        `⚠️ تنبيه تكرار معتمد:\nرقم الفاتورة (${form.invoiceNumber}) مسجل ومعتمد مسبقاً في النظام للطرف (${invoiceCheck.otherDocument.partyName || 'مسجل'}) بمبلغ (${invoiceCheck.otherDocument.total} ر.س) في مستند (${invoiceCheck.otherDocument.fileName}).\n\nإذا تابعت الاعتماد، فسيتم إنشاء حركة مالية جديدة مكررة في كشف الحساب!\n\nهل أنت متأكد تماماً من رغبتك في إنشاء حركة مكررة؟\n(ملاحظة: يمكنك الضغط على "إلغاء" واستخدام زر "💾 حفظ التعديلات في نفس المستند" لحفظ تعديلاتك دون تكرار الحركة)`
      );
      if (!confirmDup) return;
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
        setError(data.details ? `${data.error}: ${data.details}` : (data.error || 'فشل اعتماد المستند'));
      }
    } catch {
      setError('حدث خطأ في الاتصال');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── حفظ التعديلات فقط في نفس المستند ─────────────────────
  async function handleSaveDraft() {
    setSubmitting(true);
    setError('');
    setSuccessMessage('');
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType: form.documentType,
          invoiceNumber: form.invoiceNumber,
          invoiceDate: form.invoiceDate,
          partyId: form.partyId,
          partyName: form.partyName,
          currency: form.currency,
          subtotal: form.subtotal,
          taxAmount: form.taxAmount,
          discount: form.discount,
          total: form.total,
          paidAmount: form.paidAmount,
          remainingAmount: form.remainingAmount,
          operationType: form.operationType,
          direction: form.direction,
          details: form.details,
          items: form.items,
          transactionDate: form.transactionDate,
          notes: form.notes,
          customFields: form.extraFields,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage('✅ تم حفظ التعديلات بنجاح في نفس المستند وتحديث كشف الحساب مباشرة دون تكرار!');
        // إعادة تحميل بيانات المستند لتحديث الواجهة تلقائياً
        const refreshed = await fetch(`/api/documents/${id}`);
        const refData = await refreshed.json();
        if (refData.success && refData.data) {
          setDoc(refData.data);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setError(data.error || 'فشل حفظ التعديلات');
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
        <div className="flex gap-3" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => router.back()}>رجوع</button>
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

          {/* زر حفظ التعديلات في نفس المستند - بارز ومجاور لزر الاعتماد */}
          <button
            type="button"
            className="btn"
            onClick={handleSaveDraft}
            disabled={submitting}
            title="حفظ التعديلات في نفس المستند الحالي وتحديث كشف الحساب دون إنشاء حركة جديدة"
            style={{
              background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
              color: '#ffffff',
              border: 'none',
              fontWeight: 800,
              fontSize: '0.9rem',
              padding: '0.65rem 1.4rem',
              borderRadius: '8px',
              boxShadow: '0 4px 14px rgba(79, 70, 229, 0.4)',
              cursor: submitting ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            💾 حفظ التعديلات في نفس المستند
          </button>

          <button
            type="button"
            className={`btn btn-success ${submitting ? 'btn-loading' : ''}`}
            onClick={handleApprove}
            disabled={submitting}
            style={{
              padding: '0.65rem 1.4rem',
              fontWeight: 800,
              fontSize: '0.9rem',
              borderRadius: '8px',
            }}
          >
            {!submitting && (doc?.processingStatus === 'approved' ? '✓ تحديث واعتماد الحركة المالية' : '✓ اعتماد وإنشاء حركة مالية')}
          </button>
        </div>
      </div>

      {/* تنبيه النجاح بعد حفظ التعديلات */}
      {successMessage && (
        <div style={{
          background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)',
          color: '#4ade80', borderRadius: '12px', padding: '1rem 1.2rem', marginBottom: '1.5rem',
          fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>{successMessage}</span>
          <button onClick={() => setSuccessMessage('')} style={{ background: 'none', border: 'none', color: '#4ade80', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
        </div>
      )}

      {/* 1. تنبيه خطر/تحذير إذا كان رقم الفاتورة مسجل ومعتمد في مستند آخر (تكرار معتمد) */}
      {invoiceCheck?.otherDocument?.isApproved && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.16), rgba(185, 28, 28, 0.08))',
          border: '2px solid rgba(239, 68, 68, 0.6)',
          borderRadius: '12px', padding: '1.2rem 1.5rem', marginBottom: '1.5rem',
          boxShadow: '0 4px 20px rgba(239, 68, 68, 0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: '1rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', flex: 1 }}>
            <span style={{ fontSize: '2.2rem', lineHeight: 1 }}>⚠️</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <strong style={{ color: '#fca5a5', fontSize: '1.05rem', fontWeight: 800 }}>
                  تنبيه: رقم الفاتورة ({form.invoiceNumber}) موجود في قاعدة البيانات ومعتمد مسبقاً!
                </strong>
                <span style={{
                  background: 'rgba(239, 68, 68, 0.25)', color: '#fca5a5', border: '1px solid #ef4444',
                  fontSize: '0.75rem', padding: '0.2rem 0.6rem', borderRadius: '4px', fontWeight: 800,
                }}>
                  تكرار معتمد
                </span>
              </div>
              <div style={{ color: '#e2e8f0', fontSize: '0.9rem', marginTop: '0.4rem', lineHeight: 1.6 }}>
                <span>• الطرف المسجل له: <strong style={{ color: '#ffffff' }}>{invoiceCheck.otherDocument.partyName || 'غير محدد'}</strong></span>
                <span style={{ margin: '0 0.8rem' }}>|</span>
                <span>• المبلغ: <strong style={{ color: '#ffffff' }}>{invoiceCheck.otherDocument.total?.toLocaleString('ar-SA')} ر.س</strong></span>
                <span style={{ margin: '0 0.8rem' }}>|</span>
                <span>• الملف الأصلي: <strong style={{ color: '#ffffff' }}>{invoiceCheck.otherDocument.fileName}</strong></span>
              </div>
              <p style={{ color: '#cbd5e1', fontSize: '0.85rem', margin: '0.5rem 0 0 0' }}>
                لتجنب تكرار الحركات المالية بالقوائم المحاسبية، يمكنك حفظ التعديلات فوق هذا المستند بالضغط على <strong>"💾 حفظ التعديلات في نفس المستند"</strong> بدلاً من الاعتماد المكرر.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <a
              href={`/documents/${invoiceCheck.otherDocument.documentId}/review`}
              target="_blank"
              rel="noopener"
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.85rem', padding: '0.5rem 1rem', textDecoration: 'none' }}
            >
              📄 عرض المستند المعتمد ↗
            </a>
            <button
              type="button"
              className="btn"
              onClick={handleSaveDraft}
              disabled={submitting}
              style={{
                background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                color: '#fff', border: 'none', fontWeight: 800, fontSize: '0.85rem', padding: '0.5rem 1rem',
                borderRadius: '6px', cursor: 'pointer',
              }}
            >
              💾 حفظ في هذا المستند
            </button>
          </div>
        </div>
      )}

      {/* 2. تنبيه إذا كان المستند الحالي معتمداً بالفعل */}
      {doc?.processingStatus === 'approved' && !invoiceCheck?.otherDocument?.isApproved && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.12), rgba(16, 185, 129, 0.06))',
          border: '1px solid rgba(34, 197, 94, 0.35)',
          borderRadius: '12px', padding: '1rem 1.4rem', marginBottom: '1.5rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: '1rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
            <span style={{ fontSize: '1.7rem' }}>📌</span>
            <div>
              <strong style={{ color: '#4ade80', fontSize: '0.95rem' }}>
                هذا المستند معتمد حالياً ومسجل في كشف الحساب والحركات المالية
              </strong>
              <p style={{ color: '#cbd5e1', fontSize: '0.85rem', margin: '0.2rem 0 0 0' }}>
                إذا كنت تريد تعديل هذا المستند، اضغط على زر <strong>"💾 حفظ التعديلات في نفس المستند"</strong> وسيتم تحديث نفس النسخة بقاعدة البيانات وتحديث الحركة المالية تلقائياً دون تكرار.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSaveDraft}
            disabled={submitting}
            style={{ fontWeight: 800, fontSize: '0.85rem', padding: '0.5rem 1rem' }}
          >
            💾 حفظ التعديلات في نفس المستند الآن
          </button>
        </div>
      )}

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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-1)' }}>
                      <label className="form-label" style={{ margin: 0 }}>رقم الفاتورة</label>
                      {invoiceCheck?.otherDocument?.isApproved ? (
                        <span style={{
                          fontSize: '0.72rem',
                          color: '#fca5a5',
                          background: 'rgba(239, 68, 68, 0.2)',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '4px',
                          fontWeight: 800,
                        }}>
                          ⚠️ معتمد مسبقاً (تكرار)
                        </span>
                      ) : (doc?.processingStatus === 'approved' || invoiceCheck?.currentDocument?.isApproved) ? (
                        <span style={{
                          fontSize: '0.72rem',
                          color: '#4ade80',
                          background: 'rgba(34, 197, 94, 0.15)',
                          border: '1px solid rgba(34, 197, 94, 0.3)',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '4px',
                          fontWeight: 700,
                        }}>
                          ✓ معتمد في هذا المستند
                        </span>
                      ) : null}
                    </div>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="INV-001 أو اتركه فارغًا"
                      value={form.invoiceNumber}
                      onChange={e => updateForm({ invoiceNumber: e.target.value })}
                      style={{
                        borderColor: invoiceCheck?.otherDocument?.isApproved
                          ? '#ef4444'
                          : (doc?.processingStatus === 'approved' || invoiceCheck?.currentDocument?.isApproved)
                            ? '#22c55e'
                            : undefined,
                      }}
                    />

                    {/* تنبيه تحتي مباشر ومفصل عند وجود تطابق معتمد سابق */}
                    {invoiceCheck?.otherDocument?.isApproved && (
                      <div style={{
                        marginTop: '0.45rem',
                        padding: '0.55rem 0.75rem',
                        borderRadius: '6px',
                        background: 'rgba(239, 68, 68, 0.12)',
                        border: '1px solid rgba(239, 68, 68, 0.35)',
                        color: '#fca5a5',
                        fontSize: '0.8rem',
                        lineHeight: 1.5,
                      }}>
                        <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <span>⚠️</span>
                          <span>معتمد مسبقاً للطرف: {invoiceCheck.otherDocument.partyName || 'غير محدد'}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.3rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                          <span>المبلغ: {invoiceCheck.otherDocument.total?.toLocaleString('ar-SA')} ر.س</span>
                          <a
                            href={`/documents/${invoiceCheck.otherDocument.documentId}/review`}
                            target="_blank"
                            rel="noopener"
                            style={{ color: '#93c5fd', textDecoration: 'underline', fontSize: '0.75rem', fontWeight: 600 }}
                          >
                            عرض المستند الأصلي ↗
                          </a>
                        </div>
                      </div>
                    )}

                    {doc?.rawExtraction?.invoice_number?.confidence !== undefined && (
                      <div className="form-hint flex items-center gap-2 mt-1">
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
                    {doc?.rawExtraction?.invoice_date?.confidence !== undefined && (
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
                  {doc?.rawExtraction?.party?.name?.confidence !== undefined && (
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
                  {doc?.rawExtraction?.transaction?.direction?.confidence !== undefined && (
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
                <p className="text-xs text-muted mb-3">
                  {doc?.rawExtraction
                    ? 'البيانات الخام المستخرجة من Gemini — للمرجع فقط'
                    : 'البيانات المسجلة للمستند والفاتورة والحركات في قاعدة البيانات'}
                </p>
                <pre style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--space-4)',
                  fontSize: '0.75rem',
                  overflowX: 'auto',
                  direction: 'ltr',
                  maxHeight: '500px',
                  overflowY: 'auto',
                  color: 'var(--color-text-2)',
                }}>
                  {JSON.stringify(
                    doc?.rawExtraction || doc?.extractedData || {
                      message: 'لا توجد استخراجات خام من الذكاء الاصطناعي — تم تحميل البيانات من الفاتورة والحركات المحفوظة في قاعدة البيانات',
                      invoice: doc?.invoice,
                      transactions: doc?.transactions,
                    },
                    null,
                    2
                  )}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
