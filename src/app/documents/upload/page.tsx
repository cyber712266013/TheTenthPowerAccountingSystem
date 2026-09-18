'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

type UploadPhase =
  | 'idle'
  | 'uploading'
  | 'analyzing'
  | 'done'
  | 'error';

interface UploadStep {
  id: string;
  label: string;
  sub?: string;
  status: 'done' | 'active' | 'pending' | 'error';
}

const MAX_SIZE_MB = 50;
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
const ALLOWED_EXTENSIONS = ['JPG', 'JPEG', 'PNG', 'WEBP', 'PDF'];

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [documentId, setDocumentId] = useState('');
  const [steps, setSteps] = useState<UploadStep[]>([
    { id: 'upload', label: 'رفع المستند', status: 'pending' },
    { id: 'save', label: 'حفظ المستند', status: 'pending' },
    { id: 'drive', label: 'حفظ في Google Drive', status: 'pending' },
    { id: 'analyze', label: 'تحليل بالذكاء الاصطناعي', status: 'pending' },
    { id: 'extract', label: 'استخراج البيانات', status: 'pending' },
    { id: 'validate', label: 'التحقق من البيانات', status: 'pending' },
    { id: 'review', label: 'بانتظار مراجعتك', status: 'pending' },
  ]);

  function updateStep(id: string, status: UploadStep['status'], sub?: string) {
    setSteps(prev =>
      prev.map(s => (s.id === id ? { ...s, status, sub } : s))
    );
  }

  function validateFile(file: File): string | null {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `نوع الملف غير مدعوم. الأنواع المسموح بها: ${ALLOWED_EXTENSIONS.join(', ')}`;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return `حجم الملف كبير جدًا. الحد الأقصى: ${MAX_SIZE_MB} MB`;
    }
    return null;
  }

  const processFile = useCallback(async (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSelectedFile(file);
    setError('');
    setPhase('uploading');
    updateStep('upload', 'active');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('sourceType', 'upload');

    try {
      // Step 1: Upload
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      const uploadResult = await new Promise<{ success: boolean; documentId?: string; error?: string }>(
        (resolve, reject) => {
          xhr.onload = () => {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              reject(new Error('فشل في قراءة الاستجابة'));
            }
          };
          xhr.onerror = () => reject(new Error('فشل الاتصال بالسيرفر'));
          xhr.open('POST', '/api/documents/upload');
          xhr.send(formData);
        }
      );

      if (!uploadResult.success || !uploadResult.documentId) {
        throw new Error(uploadResult.error || 'فشل رفع الملف');
      }

      const docId = uploadResult.documentId;
      setDocumentId(docId);

      updateStep('upload', 'done');
      updateStep('save', 'done');
      updateStep('drive', 'active', 'جاري الرفع إلى Google Drive...');

      // Step 2: Analyze (polling)
      setPhase('analyzing');
      updateStep('drive', 'done');
      updateStep('analyze', 'active', 'Gemini يقرأ المستند...');

      // Trigger analysis
      const analyzeRes = await fetch(`/api/documents/${docId}/analyze`, {
        method: 'POST',
      });
      const analyzeData = await analyzeRes.json();

      if (!analyzeData.success) {
        throw new Error(analyzeData.error || 'فشل تحليل المستند');
      }

      updateStep('analyze', 'done');
      updateStep('extract', 'done');
      updateStep('validate', 'done');
      updateStep('review', 'active', 'يمكنك مراجعة البيانات الآن');

      setPhase('done');

      // Redirect to review after 1.5s
      setTimeout(() => {
        router.push(`/documents/${docId}/review`);
      }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      setError(msg);
      setPhase('error');
      // Mark active step as error
      setSteps(prev =>
        prev.map(s => (s.status === 'active' ? { ...s, status: 'error' } : s))
      );
    }
  }, [router]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  const stepIcons: Record<UploadStep['status'], string> = {
    done: '✓',
    active: '⟳',
    pending: '○',
    error: '✕',
  };

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto' }}>
      <div className="mb-6">
        <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 800, marginBottom: 'var(--space-2)' }}>
          رفع مستند
        </h1>
        <p className="text-muted text-sm">
          فاتورة، إيصال، تحويل بنكي، مستند مكتوب بخط اليد — الذكاء الاصطناعي سيحلله لك
        </p>
      </div>

      {phase === 'idle' && (
        <>
          {/* Upload Zone */}
          <div
            className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="upload-icon">📄</span>
            <div className="upload-title">اسحب المستند هنا</div>
            <p className="upload-sub">أو انقر لاختيار ملف من جهازك</p>
            <div className="upload-types">
              {ALLOWED_EXTENSIONS.map(ext => (
                <span key={ext} className="upload-type-badge">{ext}</span>
              ))}
            </div>
            <p className="text-muted mt-4" style={{ fontSize: 'var(--font-size-xs)' }}>
              الحد الأقصى للحجم: {MAX_SIZE_MB} MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_TYPES.join(',')}
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </div>

          {error && (
            <div className="alert alert-danger mt-4">
              <span className="alert-icon">⚠️</span>
              <div className="alert-body">{error}</div>
            </div>
          )}

          {/* Tips */}
          <div className="card mt-6">
            <div className="card-body">
              <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--color-text-2)' }}>
                💡 نصائح لنتائج أفضل
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                {[
                  { icon: '📸', tip: 'التقط الصورة في ضوء جيد' },
                  { icon: '📐', tip: 'تأكد أن المستند مستوٍ وغير مائل' },
                  { icon: '🔍', tip: 'تأكد من وضوح النص والأرقام' },
                  { icon: '📋', tip: 'إذا كانت فاتورة، تأكد من ظهور جميع البيانات' },
                ].map(({ icon, tip }) => (
                  <div key={tip} className="flex items-center gap-2 text-sm text-muted">
                    <span>{icon}</span>
                    <span>{tip}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {(phase === 'uploading' || phase === 'analyzing' || phase === 'done') && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              {selectedFile && (
                <span>
                  {selectedFile.name}
                  <span className="text-muted text-xs" style={{ fontWeight: 400, marginRight: 'var(--space-3)' }}>
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                </span>
              )}
            </span>
            {phase === 'uploading' && (
              <span className="badge badge-info">{uploadProgress}%</span>
            )}
            {phase === 'done' && (
              <span className="badge badge-success">✓ اكتمل</span>
            )}
          </div>
          <div className="card-body">
            <div className="progress-steps">
              {steps.map((step) => (
                <div key={step.id} className={`progress-step ${step.status}`}>
                  <div className={`step-icon ${step.status}`}>
                    <span style={step.status === 'active' ? { animation: 'spin 1s linear infinite', display: 'inline-block' } : {}}>
                      {stepIcons[step.status]}
                    </span>
                  </div>
                  <div>
                    <div className="step-label">{step.label}</div>
                    {step.sub && <div className="step-sub">{step.sub}</div>}
                  </div>
                </div>
              ))}
            </div>

            {phase === 'done' && (
              <div className="alert alert-success mt-4">
                <span className="alert-icon">✅</span>
                <div className="alert-body">
                  <div className="alert-title">تم التحليل بنجاح!</div>
                  جاري تحويلك إلى شاشة المراجعة...
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {phase === 'error' && (
        <>
          <div className="card">
            <div className="card-body">
              <div className="progress-steps">
                {steps.map((step) => (
                  <div key={step.id} className={`progress-step ${step.status}`}>
                    <div className={`step-icon ${step.status}`}>{stepIcons[step.status]}</div>
                    <div>
                      <div className="step-label">{step.label}</div>
                      {step.sub && <div className="step-sub">{step.sub}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="alert alert-danger mt-4">
            <span className="alert-icon">❌</span>
            <div className="alert-body">
              <div className="alert-title">تعذر تحليل المستند</div>
              {error}
              <div className="mt-4 flex gap-3">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setPhase('idle');
                    setError('');
                    setSelectedFile(null);
                    setSteps(prev => prev.map(s => ({ ...s, status: 'pending' as const })));
                  }}
                >
                  المحاولة مرة أخرى
                </button>
                {documentId && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => router.push(`/documents/${documentId}/review`)}
                  >
                    إدخال البيانات يدويًا
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
