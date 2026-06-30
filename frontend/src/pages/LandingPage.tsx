import { useNavigate } from 'react-router-dom'
import { useRef, useEffect } from 'react'
import gsap from 'gsap'
import { Sparkles, ArrowRight, Brain, Layers, BarChart2 } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'

export function LandingPage() {
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)

  const features = [
    {
      icon: <Sparkles size={15} aria-hidden />,
      title: '自然语言输入',
      desc: '你写一句话，它解析出标题、分类、截止时间和星级，不用再一个字段一个字段地填。',
    },
    {
      icon: <Brain size={15} aria-hidden />,
      title: '案头助手',
      desc: '早上它挑出今天最该做的几件并给出理由，晚上替你回看这一天。找旧任务时用一句话描述就行，不用记关键词。',
    },
    {
      icon: <Layers size={15} aria-hidden />,
      title: '大目标拆解',
      desc: '给它一个大目标，比如“完成课程设计”，它拆成一组有先后的小任务，每步进度看得见。',
    },
    {
      icon: <BarChart2 size={15} aria-hidden />,
      title: '看得见的坚持',
      desc: '打卡天数、完成趋势、分类占比都画成图表，让你看见自己做了多少。',
    },
  ]

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || !rootRef.current) {
      // Reveal everything immediately; no motion.
      gsap.set(rootRef.current?.querySelectorAll('.tf-anim-init') ?? [], { opacity: 1, y: 0, clearProps: 'all' })
      return
    }
    const ctx = gsap.context(() => {
      const ease = 'power2.out'
      // Reveal the hero wrapper first; children animate in from below.
      gsap.set('.tf-anim-init', { opacity: 1 })
      gsap.timeline()
        .from('.lp-hero-eyebrow', { opacity: 0, y: 12, duration: 0.5, ease })
        .from('.lp-hero-title', { opacity: 0, y: 16, duration: 0.6, ease }, '-=0.3')
        .from('.lp-hero-sub', { opacity: 0, y: 14, duration: 0.55, ease }, '-=0.35')
        .from('.lp-hero-cta', { opacity: 0, y: 12, duration: 0.5, ease }, '-=0.3')
        .from('.lp-feature', { opacity: 0, y: 18, duration: 0.5, ease, stagger: 0.1 }, '-=0.15')
    }, rootRef)
    return () => ctx.revert()
  }, [])

  return (
    <div ref={rootRef} style={{ minHeight: '100vh', background: 'var(--surface-0)', color: 'var(--text-primary)' }}>
      {/* Nav */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        padding: '0 48px',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        background: 'var(--surface-0)',
        zIndex: 10,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <Logo size={22} />
          <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--fw-medium)', color: 'var(--accent)', letterSpacing: '-0.3px' }}>
            TaskFlow
          </span>
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => navigate('/login')}
            style={{
              background: 'none',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-pill)',
              padding: '6px 16px',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            登录
          </button>
          <button
            onClick={() => navigate('/register')}
            style={{
              background: 'var(--accent)',
              border: '1px solid var(--accent)',
              borderRadius: 'var(--radius-pill)',
              padding: '6px 16px',
              fontSize: 'var(--text-sm)',
              color: 'var(--on-accent)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            注册
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="tf-anim-init" style={{ padding: '96px 48px 80px', maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
        <p className="lp-hero-eyebrow" style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--accent)',
          fontWeight: 'var(--fw-medium)',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          marginBottom: '20px',
        }}>
          智能化 GTD
        </p>
        <h1 className="lp-hero-title" style={{
          fontFamily: 'var(--font-voice)',
          fontSize: 'var(--text-3xl)',
          fontWeight: 'var(--fw-regular)',
          color: 'var(--text-primary)',
          lineHeight: 'var(--lh-tight)',
          marginBottom: '24px',
          letterSpacing: '-0.5px',
        }}>
          你少操心，<br />让系统多懂你一点
        </h1>
        <p className="lp-hero-sub" style={{
          fontSize: 'var(--text-md)',
          color: 'var(--text-secondary)',
          lineHeight: 'var(--lh-normal)',
          marginBottom: '40px',
          maxWidth: 500,
          margin: '0 auto 40px',
        }}>
          说一句话，TaskFlow 帮你整理成带分类、时间和优先级的任务。每一条你都能改、能确认，最后拍板的是你。
        </p>
        <div className="lp-hero-cta" style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button
            onClick={() => navigate('/register')}
            onMouseEnter={(e) => { gsap.to(e.currentTarget.querySelector('svg'), { x: 3, duration: 0.2 }) }}
            onMouseLeave={(e) => { gsap.to(e.currentTarget.querySelector('svg'), { x: 0, duration: 0.2 }) }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'var(--accent)',
              border: '1px solid var(--accent)',
              borderRadius: 'var(--radius-pill)',
              padding: '10px 24px',
              fontSize: 'var(--text-base)',
              color: 'var(--on-accent)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            从这里开始
            <ArrowRight size={15} aria-hidden />
          </button>
          <button
            onClick={() => navigate('/login')}
            style={{
              background: 'none',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-pill)',
              padding: '10px 24px',
              fontSize: 'var(--text-base)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            老朋友，登录
          </button>
        </div>
      </section>

      {/* Divider */}
      <div style={{ borderTop: '1px solid var(--border)', maxWidth: 720, margin: '0 auto' }} />

      {/* Features */}
      <section style={{ padding: '72px 48px', maxWidth: 720, margin: '0 auto' }}>
        <h2 style={{
          fontSize: 'var(--text-xl)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text-primary)',
          marginBottom: '48px',
          textAlign: 'center',
        }}>
          它能为你做的
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
          {features.map((f, i) => (
            <div key={i} className="lp-feature" style={{ paddingLeft: '16px', borderLeft: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--accent)', marginBottom: '10px' }}>
                {f.icon}
                <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)' }}>
                  {f.title}
                </span>
              </div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '24px 48px', textAlign: 'center' }}>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          TaskFlow V2.0 · 智能化 GTD
        </p>
      </footer>
    </div>
  )
}
