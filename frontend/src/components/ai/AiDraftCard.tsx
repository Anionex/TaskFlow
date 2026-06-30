/**
 * AiDraftCard — shows parsed result as an editable draft.
 * Nothing writes to DB until user confirms.
 */
import { useState } from 'react'
import { Check, X, Sparkles } from 'lucide-react'
import { StarRating } from '@/components/ui/StarRating'
import { Spinner } from '@/components/ui/Spinner'
import type { ParsedTask, Category } from '@/types'

const CATEGORIES: Category[] = ['学习', '工作', '生活', '家庭', '其他']

interface Props {
  draft: ParsedTask
  onConfirm: (d: ParsedTask) => Promise<void>
  onDiscard: () => void
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface-0)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  padding: '6px 10px',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-sm)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

export function AiDraftCard({ draft: initial, onConfirm, onDiscard }: Props) {
  const [draft, setDraft] = useState(initial)
  const [confirming, setConfirming] = useState(false)

  function set<K extends keyof ParsedTask>(k: K, v: ParsedTask[K]) {
    setDraft((d) => ({ ...d, [k]: v }))
  }

  async function handleConfirm() {
    setConfirming(true)
    try {
      await onConfirm(draft)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div style={{
      borderLeft: '2px solid var(--accent)',
      paddingLeft: '16px',
      marginTop: '12px',
    }}>
      {/* AI voice line */}
      <p style={{
        fontFamily: 'var(--font-voice)',
        fontSize: 'var(--text-sm)',
        color: 'var(--text-secondary)',
        marginBottom: '14px',
        lineHeight: 'var(--lh-snug)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      }}>
        <Sparkles size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} aria-hidden />
        我先替你拟了份草稿，哪里不合意，落笔改就是，确认前都还作数。
      </p>

      {/* Editable fields */}
      <div style={{ marginBottom: '12px' }}>
        <input
          type="text"
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          style={{ ...inputStyle, fontSize: 'var(--text-base)', marginBottom: '8px' }}
          onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--ring)' }}
          onBlur={(e) => { e.target.style.borderColor = 'var(--border-strong)'; e.target.style.boxShadow = 'none' }}
        />
        <textarea
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
          rows={2}
          style={{ ...inputStyle, resize: 'none', marginBottom: '8px' } as React.CSSProperties}
          onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--ring)' }}
          onBlur={(e) => { e.target.style.borderColor = 'var(--border-strong)'; e.target.style.boxShadow = 'none' }}
        />
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={draft.category}
            onChange={(e) => set('category', e.target.value as Category)}
            style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}
            onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--ring)' }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--border-strong)'; e.target.style.boxShadow = 'none' }}
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <StarRating value={draft.star_rating} onChange={(v) => set('star_rating', v)} />
          <input
            type="date"
            value={draft.deadline ?? ''}
            onChange={(e) => set('deadline', e.target.value || null)}
            style={{ ...inputStyle, width: 'auto' }}
            onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--ring)' }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--border-strong)'; e.target.style.boxShadow = 'none' }}
          />
        </div>
      </div>

      {/* AI suggestion */}
      {draft.suggestion && (
        <p style={{
          fontFamily: 'var(--font-voice)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-secondary)',
          marginBottom: '12px',
          padding: '8px 12px',
          borderLeft: '1px solid var(--border)',
          lineHeight: 'var(--lh-snug)',
        }}>
          {draft.suggestion}
        </p>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={onDiscard}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-pill)', padding: '5px 13px',
            fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
          }}
        >
          <X size={12} aria-hidden /> 放弃
        </button>
        <button
          onClick={handleConfirm}
          disabled={confirming || !draft.title.trim()}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            background: 'var(--accent)', border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-pill)', padding: '5px 15px',
            fontSize: 'var(--text-sm)', color: 'var(--on-accent)',
            cursor: confirming ? 'not-allowed' : 'pointer',
            opacity: confirming ? 0.7 : 1,
            fontFamily: 'var(--font-sans)',
          }}
        >
          {confirming ? <Spinner size={12} /> : <Check size={12} aria-hidden />}
          确认入库
        </button>
      </div>
    </div>
  )
}
