import { useNavigate } from 'react-router-dom'
import { useRef, useEffect, useState } from 'react'
import gsap from 'gsap'
import { Sparkles, ArrowRight, Brain, Layers, BarChart2, Download, ChevronDown } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'

export function LandingPage() {
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)

  const features = [
    {
      icon: <Sparkles size={15} aria-hidden />,
      title: '自然语言输入',
      desc: '用一句话描述你的想法，系统自动解析为结构化任务，无需手动填写分类、截止日等字段。',
    },
    {
      icon: <Brain size={15} aria-hidden />,
      title: 'AI 智能理解',
      desc: '早间推荐今日优先任务，晚间总结完成情况；语义检索让你用描述而非关键字找到任务。',
    },
    {
      icon: <Layers size={15} aria-hidden />,
      title: '目标拆解',
      desc: '输入一个大目标，AI 自动拆解为可执行的子任务序列，以任务组形式统一管理进度。',
    },
    {
      icon: <BarChart2 size={15} aria-hidden />,
      title: '完成追踪',
      desc: '打卡连续天数、完成统计图表、分类饼图，直观呈现你的执行力。',
    },
  ]

  const faqs = [
    {
      q: 'TaskFlow 的智能助理能做什么？',
      a: '智能助理是一个对话式的任务管家。你可以像聊天一样让它增删改查任务——比如「把明天的会议改到后天下午」「这周学习类的任务还剩哪些」，它会理解你的意图并执行。涉及修改的操作会先给出确认，任务始终在你的掌控之中。',
    },
    {
      q: '我需要手动填写分类、截止时间、优先级吗？',
      a: '不需要。用一句自然语言描述想做的事即可，TaskFlow 会自动解析出标题、分类、星级和起止时间，并以可编辑草稿的形式让你确认后再入库——系统绝不静默写入。',
    },
    {
      q: '一个大目标可以自动拆解吗？',
      a: '可以。输入「完成课程设计」这类大目标，TaskFlow 会识别它并建议拆解为带执行顺序的子任务，确认后生成一个「任务组」（父任务 + 一级子任务）统一追踪进度。',
    },
    {
      q: '怎么找到以前的任务？',
      a: '用语义检索，直接用自然语言描述即可，比如「快到期但还没做的」「和答辩有关的事情」。系统会理解时间、状态、分类和语义相关性，而不是简单的关键字匹配。',
    },
    {
      q: '我的数据安全吗？需要自己的 API Key 吗？',
      a: 'TaskFlow 使用你自己的大模型 API Key，密钥由客户端保管，仅在请求时临时传给后端、用完即弃，不做持久化存储。任务数据存储在你的账号下，网页版与桌面版跨设备同步。',
    },
    {
      q: '有桌面版吗？和网页版有什么区别？',
      a: '有。提供 macOS 与 Windows 原生桌面客户端（见下载页），拥有独立窗口、无需浏览器；与网页版共用同一账号和数据，功能保持一致。',
    },
  ]
  const [openFaqs, setOpenFaqs] = useState<Set<number>>(new Set([0]))
  const toggleFaq = (i: number) =>
    setOpenFaqs((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })

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
            onClick={() => navigate('/download')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
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
            <Download size={14} aria-hidden /> 下载客户端
          </button>
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
          用 AI 重塑你的任务清单
        </h1>
        <p className="lp-hero-sub" style={{
          fontSize: 'var(--text-md)',
          color: 'var(--text-secondary)',
          lineHeight: 'var(--lh-normal)',
          marginBottom: '40px',
          maxWidth: 500,
          margin: '0 auto 40px',
        }}>
          说出你的想法，TaskFlow 自动整理。从自然语言到结构化任务，从碎片想法到清晰计划，始终保持你在控制之中。
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
            免费开始使用
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
            已有账号，登录
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
          核心能力
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

      {/* Divider */}
      <div style={{ borderTop: '1px solid var(--border)', maxWidth: 720, margin: '0 auto' }} />

      {/* FAQ */}
      <section style={{ padding: '72px 48px', maxWidth: 720, margin: '0 auto' }}>
        <h2 style={{
          fontSize: 'var(--text-xl)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text-primary)',
          marginBottom: '48px',
          textAlign: 'center',
        }}>
          常见问题
        </h2>
        <div>
          {faqs.map((f, i) => {
            const open = openFaqs.has(i)
            return (
              <div key={i} style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                marginBottom: '12px',
                overflow: 'hidden',
                background: 'var(--surface-1)',
              }}>
                <button
                  onClick={() => toggleFaq(i)}
                  aria-expanded={open}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    background: 'none',
                    border: 'none',
                    padding: '18px 20px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)' }}>
                    {f.q}
                  </span>
                  <ChevronDown
                    size={16}
                    aria-hidden
                    style={{
                      color: 'var(--text-muted)',
                      flexShrink: 0,
                      transition: 'transform 0.2s ease',
                      transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}
                  />
                </button>
                <div style={{ maxHeight: open ? 400 : 0, overflow: 'hidden', transition: 'max-height 0.28s ease' }}>
                  <p style={{
                    padding: '0 20px 18px',
                    margin: 0,
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-secondary)',
                    lineHeight: 'var(--lh-normal)',
                  }}>
                    {f.a}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '24px 48px', textAlign: 'center' }}>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          TaskFlow V2.0 — 专注、清晰、掌控
        </p>
      </footer>
    </div>
  )
}
