import { useAppStore } from '@/store'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'

export function ToastContainer() {
  const { toasts, removeToast } = useAppStore()
  if (!toasts.length) return null
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 'var(--z-toast)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        minWidth: '280px',
        maxWidth: '380px',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderLeft: `3px solid ${t.type === 'success' ? 'var(--success)' : t.type === 'error' ? 'var(--danger)' : 'var(--accent)'}`,
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-pop)',
            padding: '10px 12px',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-primary)',
          }}
        >
          <span style={{ flexShrink: 0, color: t.type === 'success' ? 'var(--success)' : t.type === 'error' ? 'var(--danger)' : 'var(--accent)' }}>
            {t.type === 'success' ? <CheckCircle size={15} /> : t.type === 'error' ? <AlertCircle size={15} /> : <Info size={15} />}
          </span>
          <span style={{ flex: 1 }}>{t.message}</span>
          <button
            onClick={() => removeToast(t.id)}
            aria-label="关闭"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', display: 'flex', alignItems: 'center' }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
