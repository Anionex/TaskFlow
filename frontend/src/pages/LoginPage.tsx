import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { authApi } from '@/api/auth'
import { useAppStore } from '@/store'
import { Spinner } from '@/components/ui/Spinner'

export function LoginPage() {
  const navigate = useNavigate()
  const { setSession } = useAppStore()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (phone.length !== 11) { setError('请输入 11 位手机号'); return }
    if (!password) { setError('请输入密码'); return }
    setLoading(true)
    try {
      const res = await authApi.login(phone, password)
      if (res.success && res.data) {
        setSession(res.data, phone)
        navigate('/app')
      } else {
        setError(res.message || '登录失败')
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
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--fw-medium)', color: 'var(--accent)', marginBottom: '6px' }}>
            TaskFlow
          </div>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            欢迎回来
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '32px',
          boxShadow: 'var(--shadow-pop)',
        }}>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 'var(--fw-medium)', color: 'var(--text-secondary)', marginBottom: '5px' }}>
                手机号
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="11 位手机号"
                maxLength={11}
                autoComplete="tel"
                style={{
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
                }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--ring)' }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--border-strong)'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 'var(--fw-medium)', color: 'var(--text-secondary)', marginBottom: '5px' }}>
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
                style={{
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
                }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--ring)' }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--border-strong)'; e.target.style.boxShadow = 'none' }}
              />
            </div>

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
              {loading ? '登录中…' : '登录'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
              没有账号？{' '}
              <Link to="/register" style={{ color: 'var(--accent)', textDecoration: 'none' }}>注册</Link>
            </span>
          </div>
        </div>

        {/* Help & privacy — kept quiet */}
        <div style={{ textAlign: 'center', marginTop: '24px' }}>
          <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
            <Link to="/privacy" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>隐私说明</Link>
            <span style={{ margin: '0 6px', opacity: 0.5 }}>·</span>
            <a href="mailto:1005128408@qq.com" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>需要帮助？</a>
          </p>
        </div>
      </div>
    </div>
  )
}
