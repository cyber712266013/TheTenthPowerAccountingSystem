'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

interface DocumentItem {
  id: string;
  fileName: string;
  mimeType: string;
  processingStatus: string;
  overallConfidence: number | null;
  fileSizeBytes: number;
  uploadedAt: string;
  warnings: string[];
  uploadedBy: { name: string } | null;
}

interface ApiResponse {
  success: boolean;
  data: DocumentItem[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  pending:       { label: 'انتظار التحليل', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: '⏳' },
  processing:    { label: 'جاري التحليل',   color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', icon: '🔄' },
  needs_review:  { label: 'بانتظار المراجعة',color: '#f97316', bg: 'rgba(249,115,22,0.1)', icon: '👁️' },
  approved:      { label: 'معتمد',          color: '#10b981', bg: 'rgba(16,185,129,0.1)', icon: '✅' },
  rejected:      { label: 'مرفوض',          color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  icon: '❌' },
  failed:        { label: 'فشل التحليل',    color: '#6b7280', bg: 'rgba(107,114,128,0.1)',icon: '⚠️' },
};

const FILTER_TABS = [
  { value: '',             label: 'الكل',              icon: '📋' },
  { value: 'needs_review', label: 'بانتظار المراجعة', icon: '👁️' },
  { value: 'pending',      label: 'انتظار',            icon: '⏳' },
  { value: 'approved',     label: 'معتمد',             icon: '✅' },
  { value: 'rejected',     label: 'مرفوض',             icon: '❌' },
  { value: 'failed',       label: 'فشل',               icon: '⚠️' },
];

function DocumentsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const statusFilter = searchParams.get('status') || '';

  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/documents?${params}`);
      const data: ApiResponse = await res.json();
      if (data.success) {
        setDocs(data.data);
        setPagination(data.pagination);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const handleDelete = async (doc: DocumentItem) => {
    if (!confirm(`هل أنت متأكد من حذف "${doc.fileName}"؟\nلا يمكن التراجع عن هذا الإجراء.`)) return;
    setDeletingId(doc.id);
    setDeleteError('');
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setDocs(prev => prev.filter(d => d.id !== doc.id));
        setPagination(prev => ({ ...prev, total: prev.total - 1 }));
      } else {
        setDeleteError(data.error || 'فشل الحذف');
      }
    } catch {
      setDeleteError('خطأ في الاتصال');
    } finally {
      setDeletingId(null);
    }
  };

  const changeStatus = (status: string) => {
    const url = status ? `/documents?status=${status}` : '/documents';
    router.push(url);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ar-SA', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div style={{ direction: 'rtl', padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      {deleteError && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '10px', padding: '0.8rem 1.2rem', marginBottom: '1rem', color: '#ef4444', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          ❌ {deleteError}
          <button onClick={() => setDeleteError('')} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
        </div>
      )}
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
            📂 المستندات
          </h1>
          <p style={{ color: '#94a3b8', marginTop: '0.3rem', fontSize: '0.9rem' }}>
            إجمالي: {pagination.total} مستند
          </p>
        </div>
        <Link href="/documents/upload"
          style={{
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: 'white', padding: '0.6rem 1.4rem', borderRadius: '10px',
            textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            boxShadow: '0 4px 15px rgba(99,102,241,0.4)',
          }}>
          ➕ رفع مستند جديد
        </Link>
      </div>

      {/* Filter Tabs */}
      <div style={{
        display: 'flex', gap: '0.5rem', flexWrap: 'wrap',
        marginBottom: '1.5rem', background: 'rgba(255,255,255,0.03)',
        padding: '0.6rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.07)',
      }}>
        {FILTER_TABS.map(tab => {
          const active = statusFilter === tab.value;
          return (
            <button key={tab.value} onClick={() => changeStatus(tab.value)}
              style={{
                padding: '0.45rem 1rem', borderRadius: '8px', border: 'none',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 600,
                transition: 'all 0.2s',
                background: active ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'transparent',
                color: active ? 'white' : '#94a3b8',
                boxShadow: active ? '0 2px 10px rgba(99,102,241,0.4)' : 'none',
              }}>
              {tab.icon} {tab.label}
            </button>
          );
        })}
      </div>

      {/* Documents Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem', color: '#6366f1' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⟳</div>
          <p style={{ color: '#94a3b8' }}>جاري التحميل...</p>
        </div>
      ) : docs.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '5rem',
          background: 'rgba(255,255,255,0.03)', borderRadius: '16px',
          border: '2px dashed rgba(255,255,255,0.1)',
        }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>📭</div>
          <h3 style={{ color: '#e2e8f0', marginBottom: '0.5rem' }}>لا توجد مستندات</h3>
          <p style={{ color: '#64748b' }}>
            {statusFilter ? `لا توجد مستندات بحالة "${STATUS_CONFIG[statusFilter]?.label}"` : 'لم يتم رفع أي مستند بعد'}
          </p>
          <Link href="/documents/upload" style={{
            display: 'inline-block', marginTop: '1.5rem',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: 'white', padding: '0.7rem 1.8rem', borderRadius: '10px',
            textDecoration: 'none', fontWeight: 600,
          }}>
            ➕ رفع أول مستند
          </Link>
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '1rem',
          }}>
            {docs.map(doc => {
              const statusInfo = STATUS_CONFIG[doc.processingStatus] || STATUS_CONFIG.failed;
              const isReviewable = doc.processingStatus === 'needs_review';
              const ext = doc.fileName.split('.').pop()?.toUpperCase() || 'FILE';
              return (
                <div key={doc.id} style={{
                  background: 'rgba(255,255,255,0.04)', borderRadius: '14px',
                  border: '1px solid rgba(255,255,255,0.08)', padding: '1.2rem',
                  transition: 'all 0.2s', cursor: 'pointer',
                }}>
                  {/* Card Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.8rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1, minWidth: 0 }}>
                      <div style={{
                        width: '40px', height: '40px', borderRadius: '8px', flexShrink: 0,
                        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.65rem', fontWeight: 700, color: 'white',
                      }}>{ext}</div>
                      <div style={{ minWidth: 0 }}>
                        <p style={{
                          color: '#e2e8f0', fontWeight: 600, margin: 0, fontSize: '0.85rem',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          maxWidth: '200px',
                        }}>{doc.fileName}</p>
                        <p style={{ color: '#64748b', margin: 0, fontSize: '0.75rem' }}>
                          {formatSize(doc.fileSizeBytes)}
                        </p>
                      </div>
                    </div>
                    <span style={{
                      padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.72rem',
                      fontWeight: 600, whiteSpace: 'nowrap',
                      background: statusInfo.bg, color: statusInfo.color,
                    }}>
                      {statusInfo.icon} {statusInfo.label}
                    </span>
                  </div>

                  {/* Confidence */}
                  {doc.overallConfidence !== null && (
                    <div style={{ marginBottom: '0.8rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                        <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>دقة التحليل</span>
                        <span style={{ color: '#e2e8f0', fontSize: '0.75rem', fontWeight: 600 }}>
                          {Math.round((doc.overallConfidence ?? 0) * 100)}%
                        </span>
                      </div>
                      <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px' }}>
                        <div style={{
                          height: '100%', borderRadius: '2px',
                          width: `${(doc.overallConfidence ?? 0) * 100}%`,
                          background: (doc.overallConfidence ?? 0) > 0.8 ? '#10b981'
                            : (doc.overallConfidence ?? 0) > 0.5 ? '#f59e0b' : '#ef4444',
                          transition: 'width 0.5s ease',
                        }} />
                      </div>
                    </div>
                  )}

                  {/* Warnings */}
                  {doc.warnings && doc.warnings.length > 0 && (
                    <div style={{
                      background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)',
                      borderRadius: '6px', padding: '0.4rem 0.6rem', marginBottom: '0.8rem',
                      fontSize: '0.72rem', color: '#f59e0b',
                    }}>
                      ⚠️ {doc.warnings.length} تحذير
                    </div>
                  )}

                  {/* Footer */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.8rem', marginTop: '0.8rem' }}>
                    <span style={{ color: '#475569', fontSize: '0.7rem', display: 'block', marginBottom: '0.6rem' }}>
                      📅 {formatDate(doc.uploadedAt)}
                    </span>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {isReviewable && (
                        <Link href={`/documents/${doc.id}/review`}
                          style={{
                            background: 'linear-gradient(135deg, #f97316, #ef4444)',
                            color: 'white', padding: '0.3rem 0.7rem',
                            borderRadius: '6px', textDecoration: 'none',
                            fontSize: '0.72rem', fontWeight: 600,
                            boxShadow: '0 2px 8px rgba(249,115,22,0.3)',
                          }}>
                          👁️ مراجعة
                        </Link>
                      )}
                      <Link href={`/documents/${doc.id}/review`}
                        style={{
                          background: 'rgba(255,255,255,0.05)', color: '#94a3b8',
                          padding: '0.3rem 0.65rem', borderRadius: '6px',
                          textDecoration: 'none', fontSize: '0.72rem',
                          border: '1px solid rgba(255,255,255,0.08)',
                        }}>
                        عرض
                      </Link>
                      <Link href={`/documents/${doc.id}/edit`}
                        style={{
                          background: 'rgba(99,102,241,0.12)', color: '#818cf8',
                          padding: '0.3rem 0.65rem', borderRadius: '6px',
                          textDecoration: 'none', fontSize: '0.72rem',
                          border: '1px solid rgba(99,102,241,0.2)',
                        }}>
                        ✏️ تعديل
                      </Link>
                      <button
                        onClick={() => handleDelete(doc)}
                        disabled={deletingId === doc.id}
                        style={{
                          background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                          padding: '0.3rem 0.65rem', borderRadius: '6px',
                          border: '1px solid rgba(239,68,68,0.2)',
                          fontSize: '0.72rem', cursor: deletingId === doc.id ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit', opacity: deletingId === doc.id ? 0.6 : 1,
                        }}>
                        {deletingId === doc.id ? '⟳' : '🗑️'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '2rem' }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                style={{
                  padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)', color: '#94a3b8', cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>السابق</button>
              <span style={{
                padding: '0.5rem 1rem', color: '#e2e8f0', fontSize: '0.85rem',
                display: 'flex', alignItems: 'center',
              }}>
                {page} / {pagination.totalPages}
              </span>
              <button onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page === pagination.totalPages}
                style={{
                  padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)', color: '#94a3b8', cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>التالي</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense fallback={
      <div style={{ textAlign: 'center', padding: '4rem', color: '#6366f1' }}>
        <p style={{ color: '#94a3b8' }}>جاري التحميل...</p>
      </div>
    }>
      <DocumentsContent />
    </Suspense>
  );
}
