import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { authApi } from '@/api/auth'
import { useAppStore } from '@/store'
import { Spinner } from '@/components/ui/Spinner'
import { AnimatedLogo } from '@/components/ui/AnimatedLogo'

export function RegisterPage() {
  const navigate = useNavigate()
  const { addToast, setSession } = useAppStore()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--surface-0)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 10px',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-sm)',
    outline: 'none',
    boxSizing: 'border-box',
  }

  function focusStyle(e: React.FocusEvent<HTMLInputElement>) {
    e.target.style.borderColor = 'var(--accent)'
    e.target.style.boxShadow = '0 0 0 3px var(--ring)'
  }
  function blurStyle(e: React.FocusEvent<HTMLInputElement>) {
    e.target.style.borderColor = 'var(--border-strong)'
    e.target.style.boxShadow = 'none'
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (phone.length !== 11) { setError('请输入 11 位手机号'); return }
    if (password.length < 6) { setError('密码至少 6 位'); return }
    if (password !== confirm) { setError('两次密码不一致'); return }
    setLoading(true)
    try {
      const regRes = await authApi.register(phone, password)
      if (!regRes.success) { setError(regRes.message || '注册失败'); return }
      const loginRes = await authApi.login(phone, password)
      if (loginRes.success && loginRes.data) {
        setSession(loginRes.data, phone)
        addToast({ type: 'success', message: '注册成功，已自动登录' })
        navigate('/app')
      } else {
        addToast({ type: 'success', message: '注册成功，请登录' })
        navigate('/login')
      }
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--surface-0)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
            <AnimatedLogo size={30} wordmark />
          </div>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>创建新账号</p>
        </div>

        <div style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '32px',
          boxShadow: 'var(--shadow-pop)',
        }}>
          <form onSubmit={handleSubmit}>
            {[
              { label: '手机号', type: 'tel', value: phone, setter: setPhone, placeholder: '11 位手机号', maxLength: 11, autoComplete: 'tel' },
              { label: '密码', type: 'password', value: password, setter: setPassword, placeholder: '至少 6 位', autoComplete: 'new-password' },
              { label: '确认密码', type: 'password', value: confirm, setter: setConfirm, placeholder: '再次输入密码', autoComplete: 'new-password' },
            ].map((field, i) => (
              <div key={i} style={{ marginBottom: i === 2 ? '20px' : '16px' }}>
                <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 'var(--fw-medium)', color: 'var(--text-secondary)', marginBottom: '5px' }}>
                  {field.label}
                </label>
                <input
                  type={field.type}
                  value={field.value}
                  onChange={(e) => field.setter(e.target.value)}
                  placeholder={field.placeholder}
                  maxLength={(field as any).maxLength}
                  autoComplete={field.autoComplete}
                  style={inputStyle}
                  onFocus={focusStyle}
                  onBlur={blurStyle}
                />
              </div>
            ))}

            {error && (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', marginBottom: '14px' }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '7px',
                background: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-pill)',
                padding: '9px 16px',
                fontSize: 'var(--text-sm)',
                color: 'var(--on-accent)',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                fontFamily: 'var(--font-sans)',
              }}
            >
              {loading && <Spinner size={14} />}
              {loading ? '注册中…' : '注册'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
              已有账号？{' '}
              <Link to="/login" style={{ color: 'var(--accent)', textDecoration: 'none' }}>登录</Link>
            </span>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', lineHeight: 1.8 }}>
            注册即同意{' '}
            <Link to="/privacy" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>隐私政策</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
