/**
 * Reusable task create/edit form fields (no submit button — caller provides).
 */
import { StarRating } from '@/components/ui/StarRating'
import type { Category } from '@/types'

const CATEGORIES: Category[] = ['学习', '工作', '生活', '家庭', '其他']

interface Draft {
  title: string
  description: string
  category: Category
  star_rating: number
  start_date: string
  deadline: string
}

interface Props {
  draft: Draft
  onChange: (d: Draft) => void
  autoFocusTitle?: boolean
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-0)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  padding: '7px 10px',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-sm)',
  outline: 'none',
  boxSizing: 'border-box',
}

function onFocus(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  e.target.style.borderColor = 'var(--accent)'
  e.target.style.boxShadow = '0 0 0 3px var(--ring)'
}
function onBlur(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  e.target.style.borderColor = 'var(--border-strong)'
  e.target.style.boxShadow = 'none'
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 'var(--fw-medium)', color: 'var(--text-secondary)', marginBottom: '5px' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

export function TaskForm({ draft, onChange, autoFocusTitle }: Props) {
  function set<K extends keyof Draft>(k: K, v: Draft[K]) {
    onChange({ ...draft, [k]: v })
  }

  return (
    <>
      <Field label="标题">
        <input
          type="text"
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="任务标题"
          autoFocus={autoFocusTitle}
          style={inputStyle}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </Field>

      <Field label="描述（可选）">
        <textarea
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="补充说明"
          rows={2}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
          onFocus={onFocus as any}
          onBlur={onBlur as any}
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
        <Field label="分类">
          <select
            value={draft.category}
            onChange={(e) => set('category', e.target.value as Category)}
            style={{ ...inputStyle, cursor: 'pointer' }}
            onFocus={onFocus as any}
            onBlur={onBlur as any}
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="重要性">
          <div style={{ paddingTop: '4px' }}>
            <StarRating value={draft.star_rating} onChange={(v) => set('star_rating', v)} />
          </div>
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <Field label="开始日期">
          <input
            type="date"
            value={draft.start_date}
            onChange={(e) => set('start_date', e.target.value)}
            style={inputStyle}
            onFocus={onFocus}
            onBlur={onBlur}
          />
        </Field>
        <Field label="截止日期">
          <input
            type="date"
            value={draft.deadline}
            onChange={(e) => set('deadline', e.target.value)}
            style={inputStyle}
            onFocus={onFocus}
            onBlur={onBlur}
          />
        </Field>
      </div>
    </>
  )
}

export function emptyDraft(): Draft {
  return { title: '', description: '', category: '其他', star_rating: 0, start_date: '', deadline: '' }
}

export type { Draft as TaskDraft }
