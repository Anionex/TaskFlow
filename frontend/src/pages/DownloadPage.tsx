import { useNavigate } from 'react-router-dom'
import { Download, ArrowLeft, Info } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'

/** 桌面客户端版本与产物（与 desktop-release workflow 的产物名保持一致）。 */
const VERSION = '2.0.3'
const PLATFORMS = [
  {
    os: 'macOS',
    arch: 'Apple 芯片 (Apple Silicon)',
    file: `TaskFlow_${VERSION}_aarch64.dmg`,
    note: '⚠️ 首次打开 macOS 可能提示「已损坏，无法打开」——安装包本身没有问题，这只是因为尚未通过 Apple 公证、系统对下载文件加了隔离标记。修复：把 App 拖到「应用程序」，打开「终端」执行 xattr -cr /Applications/TaskFlow.app（可把 App 拖进终端自动补全路径），再双击即可正常打开。仅支持 Apple 芯片（M 系列）。',
  },
  {
    os: 'Windows',
    arch: 'x64',
    file: `TaskFlow_${VERSION}_x64-setup.exe`,
    note: '若 SmartScreen 弹出蓝色提示，点「更多信息」→「仍要运行」。安装包未做代码签名公证。',
  },
]

export function DownloadPage() {
  const navigate = useNavigate()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-0)', color: 'var(--text-primary)' }}>
      {/* Nav */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        padding: '0 clamp(16px, 5vw, 48px)',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        background: 'var(--surface-0)',
        zIndex: 10,
      }}>
        <button
          onClick={() => navigate('/')}
          aria-label="返回首页"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <Logo size={22} />
          <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--fw-medium)', color: 'var(--accent)', letterSpacing: '-0.3px' }}>
            TaskFlow
          </span>
        </button>
        <button
          onClick={() => navigate('/')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            background: 'none', border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-pill)', padding: '6px 16px',
            fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
          }}
        >
          <ArrowLeft size={14} aria-hidden /> 返回首页
        </button>
      </header>

      {/* Hero */}
      <section style={{ padding: 'clamp(48px, 9vw, 88px) clamp(16px, 5vw, 48px) 40px', maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
        <p style={{
          fontSize: 'var(--text-sm)', color: 'var(--accent)', fontWeight: 'var(--fw-medium)',
          letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '18px',
        }}>
          桌面客户端 · v{VERSION}
        </p>
        <h1 style={{
          fontFamily: 'var(--font-voice)', fontSize: 'var(--text-3xl)', fontWeight: 'var(--fw-regular)',
          color: 'var(--text-primary)', lineHeight: 'var(--lh-tight)', marginBottom: '20px', letterSpacing: '-0.5px',
        }}>
          下载 TaskFlow 桌面版
        </h1>
        <p style={{
          fontSize: 'var(--text-md)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)',
          maxWidth: 460, margin: '0 auto',
        }}>
          原生桌面体验，数据与网页版账户实时同步。也可
          <button
            onClick={() => navigate('/register')}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 'inherit', fontFamily: 'inherit' }}
          >
            直接使用网页版
          </button>
          。
        </p>
      </section>

      {/* Platform cards */}
      <section style={{ padding: '0 clamp(16px, 5vw, 48px) 64px', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px' }}>
          {PLATFORMS.map((p) => (
            <div key={p.os} style={{
              border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
              padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px',
              background: 'var(--surface-1)',
            }}>
              <div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)' }}>{p.os}</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: '2px' }}>{p.arch}</div>
              </div>

              <a
                href={`/downloads/${p.file}`}
                download
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
                  background: 'var(--accent)', border: '1px solid var(--accent)',
                  borderRadius: 'var(--radius-pill)', padding: '9px 18px',
                  fontSize: 'var(--text-sm)', color: 'var(--on-accent)', textDecoration: 'none',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <Download size={15} aria-hidden /> 下载
              </a>

              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                {p.file}
              </div>

              <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>
                <Info size={13} aria-hidden style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: '1px' }} />
                <span>{p.note}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '24px clamp(16px, 5vw, 48px)', textAlign: 'center' }}>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          TaskFlow V2.0 — 专注、清晰、掌控
        </p>
      </footer>
    </div>
  )
}
