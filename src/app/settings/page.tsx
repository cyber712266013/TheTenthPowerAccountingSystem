export default function SettingsPage() {
  return (
    <div style={{ direction: 'rtl', padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '1rem' }}>
        ⚙️ الإعدادات
      </h1>
      <div style={{
        background: 'rgba(255,255,255,0.04)', borderRadius: '14px',
        border: '1px solid rgba(255,255,255,0.08)', padding: '3rem',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚙️</div>
        <h3 style={{ color: '#94a3b8', marginBottom: '0.5rem' }}>سيتم إضافة هذه الصفحة قريباً</h3>
        <p style={{ color: '#475569', fontSize: '0.85rem' }}>
          إعدادات النظام، إدارة المستخدمين، وتخصيص الإعدادات المالية
        </p>
      </div>
    </div>
  );
}
