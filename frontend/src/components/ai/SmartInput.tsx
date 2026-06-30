/**
 * SmartInput — the hero natural language entry point.
 * Anatomy: auto-grow textarea + hairline underline accent on focus,
 * footer with "批量捕获" link and primary "智能解析" button.
 */
import { useState, useRef, useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'

interface Props {
  onParse: (text: string) => Promise<void>
  onBrainDump: (text: string) => Promise<void>
  loading?: boolean
  loadingLabel?: string
}

export function SmartInput({ onParse, onBrainDump, loading, loadingLabel }: Props) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.max(72, ta.scrollHeight)}px`
  }, [text])

  async function handleParse() {
    if (!text.trim() || loading) return
    await onParse(text.trim())
    setText('')
  }

  async function handleBrainDump() {
    if (!text.trim() || loading) return
    await onBrainDump(text.trim())
    setText('')
  }

  return (
    <div style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '16px 20px',
      transition: 'border-color var(--dur-fast)',
      borderColor: focused ? 'var(--accent)' : 'var(--border)',
    }}>
      {/* Inline sparkle + label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: 'var(--text-muted)' }}>
        <Sparkles size={13} aria-hidden />
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>智能输入 — 用自然语言描述任务</span>
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            handleParse()
          }
        }}
        placeholder="例如：下周五前完成设计稿，工作相关，比较重要"
        rows={2}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-base)',
          color: 'var(--text-primary)',
          lineHeight: 'var(--lh-normal)',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      />

      {/* Focus underline */}
      <div style={{
        height: 1,
        background: focused ? 'var(--accent)' : 'var(--border)',
        marginTop: '8px',
        marginBottom: '12px',
        transition: 'background var(--dur-fast)',
      }} />

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {loading ? (
          <span style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Spinner size={13} />
            {loadingLabel || '正在整理…'}
          </span>
        ) : (
          <button
            onClick={handleBrainDump}
            disabled={!text.trim()}
            style={{
              background: 'none', border: 'none', cursor: text.trim() ? 'pointer' : 'default',
              color: text.trim() ? 'var(--accent)' : 'var(--text-muted)',
              fontSize: 'var(--text-sm)', fontFamily: 'var(--font-sans)',
              padding: 0, transition: 'color var(--dur-fast)',
            }}
          >
            批量捕获
          </button>
        )}

        <button
          onClick={handleParse}
          disabled={!text.trim() || loading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            background: !text.trim() || loading ? 'var(--border)' : 'var(--accent)',
            border: '1px solid transparent',
            borderRadius: 'var(--radius-pill)',
            padding: '6px 14px',
            fontSize: 'var(--text-sm)',
            color: !text.trim() || loading ? 'var(--text-muted)' : 'var(--on-accent)',
            cursor: !text.trim() || loading ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-sans)',
            transition: 'background var(--dur-fast), color var(--dur-fast)',
          }}
        >
          <Sparkles size={12} aria-hidden />
          智能解析
        </button>
      </div>
    </div>
  )
}
