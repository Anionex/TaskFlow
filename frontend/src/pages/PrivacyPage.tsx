import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export function PrivacyPage() {
  const navigate = useNavigate()
  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-0)', padding: '40px 24px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 'var(--text-sm)',
            marginBottom: '32px', fontFamily: 'var(--font-sans)',
          }}
        >
          <ArrowLeft size={14} aria-hidden />
          返回
        </button>

        <h1 style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-2xl)', fontWeight: 'var(--fw-regular)', marginBottom: '24px', color: 'var(--text-primary)' }}>
          隐私政策
        </h1>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>
          <p style={{ marginBottom: '16px' }}>
            TaskFlow 仅收集运行产品所必要的数据：手机号（账号标识）、任务内容（核心功能数据）。
          </p>
          <p style={{ marginBottom: '16px' }}>
            你的任务数据存储在我们的服务器上，仅用于向你提供任务管理服务，不会被用于广告或出售给第三方。
          </p>
          <p style={{ marginBottom: '16px' }}>
            AI 功能通过你自己配置的大模型 API Key 调用，任务文本会被发送至对应服务商，请参阅各服务商隐私政策。
          </p>
          <p style={{ marginBottom: '16px' }}>
            如有疑问，请联系：1005128408@qq.com
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
            最后更新：2026-06-30
          </p>
        </div>
      </div>
    </div>
  )
}
