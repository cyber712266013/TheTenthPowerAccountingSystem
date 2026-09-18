'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [form, setForm] = useState({ email: '', password: '' });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    startTransition(async () => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        router.push('/dashboard');
        router.refresh();
      } else {
        setError(data.error || 'بيانات الدخول غير صحيحة');
      }
    });
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg)',
      padding: 'var(--space-4)',
    }}>
      {/* Background glow */}
      <div style={{
        position: 'fixed',
        top: '20%',
        right: '30%',
        width: '400px',
        height: '400px',
        background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{ width: '100%', maxWidth: '420px' }}>
        {/* Logo */}
        <div className="text-center mb-6">
          <div style={{
            width: '64px',
            height: '64px',
            background: 'var(--color-primary-muted)',
            border: '2px solid var(--color-primary)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '2rem',
            margin: '0 auto var(--space-4)',
          }}>📊</div>
          <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 800, marginBottom: 'var(--space-1)' }}>
            نظام الحسابات
          </h1>
          <p className="text-muted text-sm">تحليل الفواتير والمستندات المالية بالذكاء الاصطناعي</p>
        </div>

        <div className="card">
          <div className="card-body">
            <h2 style={{ fontSize: 'var(--font-size-lg)', marginBottom: 'var(--space-6)', textAlign: 'center' }}>
              تسجيل الدخول
            </h2>

            {error && (
              <div className="alert alert-danger mb-4">
                <span className="alert-icon">⚠️</span>
                <div className="alert-body">{error}</div>
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <div className="form-group">
                <label className="form-label">البريد الإلكتروني</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="admin@example.com"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">كلمة المرور</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  required
                />
              </div>

              <button
                type="submit"
                className={`btn btn-primary btn-lg w-full ${isPending ? 'btn-loading' : ''}`}
                disabled={isPending}
              >
                {!isPending && 'دخول'}
              </button>
            </form>
          </div>
        </div>

        <p className="text-center text-muted mt-4" style={{ fontSize: 'var(--font-size-xs)' }}>
          نظام إدارة الفواتير والمستندات المالية — نسخة 1.0
        </p>
      </div>
    </div>
  );
}
