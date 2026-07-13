/**
 * CategorySelect — 选择分类，并支持即时新建自定义分类（Issue #9）。
 * 选项 = store.categories（默认 5 类 ∪ 已用分类）∪ 当前值。选「+ 新建分类…」切到文本输入。
 */
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useAppStore } from '@/store'
import { isValidCategory } from '@/lib/categories'

const CUSTOM = '__custom__'

interface Props {
  value: string
  onChange: (v: string) => void
  style?: CSSProperties
  /** 是否在最前面加「全部分类」（用于筛选）。选中它时 onChange('')。 */
  includeAll?: boolean
}

const focusIn = (e: React.FocusEvent<HTMLElement>) => {
  ;(e.target as HTMLElement).style.borderColor = 'var(--accent)'
  ;(e.target as HTMLElement).style.boxShadow = '0 0 0 3px var(--ring)'
}
const focusOut = (e: React.FocusEvent<HTMLElement>) => {
  ;(e.target as HTMLElement).style.borderColor = 'var(--border-strong)'
  ;(e.target as HTMLElement).style.boxShadow = 'none'
}

export function CategorySelect({ value, onChange, style, includeAll }: Props) {
  const categories = useAppStore((s) => s.categories)
  const [custom, setCustom] = useState(false)
  const [draft, setDraft] = useState('')

  // 当前值若不在列表内（刚建的自定义分类），也要能显示为选中项。
  const options = value && !includeAll && !categories.includes(value)
    ? [value, ...categories]
    : categories

  function commitCustom() {
    const v = draft.trim()
    if (isValidCategory(v)) onChange(v)
    setCustom(false)
    setDraft('')
  }

  if (custom) {
    return (
      <input
        type="text"
        autoFocus
        value={draft}
        maxLength={10}
        placeholder="输入分类名（≤10 字）"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitCustom() }
          if (e.key === 'Escape') { setCustom(false); setDraft('') }
        }}
        onBlur={commitCustom}
        style={style}
      />
    )
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === CUSTOM) { setCustom(true); setDraft('') }
        else onChange(e.target.value)
      }}
      style={{ ...style, cursor: 'pointer' }}
      onFocus={focusIn}
      onBlur={focusOut}
    >
      {includeAll && <option value="">全部分类</option>}
      {options.map((c) => <option key={c} value={c}>{c}</option>)}
      <option value={CUSTOM}>+ 新建分类…</option>
    </select>
  )
}
