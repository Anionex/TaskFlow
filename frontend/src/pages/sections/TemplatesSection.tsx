import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Zap, Info } from 'lucide-react'
import { confirm } from '@/components/ui/ConfirmDialog'
import { Modal, ModalFooter } from '@/components/ui/Modal'
import { StarRating } from '@/components/ui/StarRating'
import { Spinner } from '@/components/ui/Spinner'
import { PageContainer } from '@/components/layout/PageContainer'
import { templatesApi } from '@/api/templates'
import { useAppStore } from '@/store'
import type { Template, Category, Frequency } from '@/types'

const CATEGORIES: Category[] = ['学习', '工作', '生活', '家庭', '其他']
const FREQUENCIES: { id: Frequency; label: string }[] = [
  { id: 'daily', label: '每天' },
  { id: 'weekly', label: '每周' },
  { id: 'monthly', label: '每月' },
]

function emptyTemplate(): Partial<Template> {
  return {
    title: '', description: '', category: '其他', star_rating: 0,
    frequency: 'daily', generate_day: 0, generate_time: '08:00',
    deadline_day: 1, deadline_time: '23:59',
  }
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

function focusIn(e: React.FocusEvent<any>) { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--ring)' }
function focusOut(e: React.FocusEvent<any>) { e.target.style.borderColor = 'var(--border-strong)'; e.target.style.boxShadow = 'none' }

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-xs)', fontWeight: 'var(--fw-medium)', color: 'var(--text-secondary)', marginBottom: '5px' }}>
        {label}
        {/* 带示例的说明气泡：鼠标悬停 info 图标可看解释（item 6）。 */}
        {hint && (
          <span title={hint} style={{ display: 'inline-flex', color: 'var(--text-muted)', cursor: 'help', flexShrink: 0 }}>
            <Info size={13} aria-hidden />
          </span>
        )}
      </label>
      {children}
    </div>
  )
}

export function TemplatesSection() {
  const { addToast } = useAppStore()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Template | null>(null)
  const [draft, setDraft] = useState<Partial<Template>>(emptyTemplate())
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true)
    const res = await templatesApi.list()
    if (res.success && res.data) {
      // Backend may return { items: [] } or Template[]
      const d = res.data as any
      setTemplates(Array.isArray(d) ? d : (d.items ?? []))
    }
    if (!opts?.silent) setLoading(false)
  }

  function openCreate() {
    setEditing(null)
    setDraft(emptyTemplate())
    setShowForm(true)
  }

  function openEdit(t: Template) {
    setEditing(t)
    // 旧数据的 generate_day 可能越界(如 monthly 存了 0，调度器 today.day()==0 永不触发)，
    // 载入时按频率夹到合法范围。
    setDraft({ ...t, generate_day: clampDay(t.frequency, t.generate_day) })
    setShowForm(true)
  }

  async function handleSave() {
    if (!draft.title?.trim()) return
    // 提交前归一化 generate_day：按当前频率夹到合法范围。daily 后端忽略，
    // 但为避免携带越界值(若频率是 monthly/weekly 则非法)，统一夹到 1-31 内的安全值。
    const normDay = dayRange(draft.frequency) ? clampDay(draft.frequency, draft.generate_day) : clampDay('monthly', draft.generate_day)
    const draftToSave: Partial<Template> = { ...draft, generate_day: normDay }
    if (editing) {
      // 乐观改本地并立即关闭弹窗；请求回来后静默重载校正。
      const id = editing.id
      const patched = { ...editing, ...draftToSave } as Template
      setTemplates((ts) => ts.map((t) => (t.id === id ? patched : t)))
      setShowForm(false)
      const res = await templatesApi.update(id, draftToSave)
      if (res.success) addToast({ type: 'success', message: '习惯已更新' })
      else addToast({ type: 'error', message: res.message })
      load({ silent: true })
    } else {
      // 新建需服务端 id，静默重载（不再顶掉整个列表）。
      setSaving(true)
      try {
        const res = await templatesApi.create(draftToSave)
        if (res.success) {
          addToast({ type: 'success', message: '习惯已创建' })
          setShowForm(false)
          load({ silent: true })
        } else {
          addToast({ type: 'error', message: res.message })
        }
      } finally {
        setSaving(false)
      }
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ title: '删除习惯', message: '确认删除此习惯？', danger: true, confirmText: '删除' }))) return
    // 乐观移除该行；失败静默重载恢复。
    setTemplates((ts) => ts.filter((t) => t.id !== id))
    const res = await templatesApi.delete(id)
    if (res.success) {
      addToast({ type: 'success', message: '已删除' })
    } else {
      addToast({ type: 'error', message: res.message })
      load({ silent: true })
    }
  }

  async function handleGenerate() {
    if (templates.length === 0) {
      addToast({ type: 'info', message: '暂无可生成的任务，请先创建习惯' })
      return
    }
    setGenerating(true)
    try {
      const res = await templatesApi.generate()
      if (res.success) {
        // Backend returns { generated: N } (or a bare number / legacy { count }).
        const d = res.data as any
        const count = typeof d === 'number' ? d : (d?.generated ?? d?.count ?? 0)
        if (count > 0) {
          addToast({ type: 'success', message: `已生成 ${count} 个任务` })
        } else {
          addToast({ type: 'info', message: '暂无可生成的任务，请先创建习惯' })
        }
        load({ silent: true })
      } else {
        addToast({ type: 'error', message: res.message || '生成失败' })
      }
    } finally {
      setGenerating(false)
    }
  }

  function set<K extends keyof Template>(k: K, v: any) {
    setDraft((d) => ({ ...d, [k]: v }))
  }

  // generate_day 的取值范围随频率而变：weekly 0-6(0=周日)，monthly 1-31。
  // daily 后端忽略 generate_day，返回 null 表示"不夹取"，保留原值以便切回 weekly/monthly 不丢。
  function dayRange(freq?: Frequency): { min: number; max: number } | null {
    if (freq === 'weekly') return { min: 0, max: 6 }
    if (freq === 'monthly') return { min: 1, max: 31 }
    return null // daily：不适用
  }

  // 把 generate_day 夹到某频率的合法范围；daily 不适用则原样返回。
  function clampDay(freq: Frequency | undefined, day: number | undefined): number {
    const r = dayRange(freq)
    if (!r) return day ?? 0
    return Math.min(r.max, Math.max(r.min, day ?? r.min))
  }

  // 切换频率时把 generate_day 夹到新范围，防止提交过期的越界值；daily 不夹取，保留原值。
  function setFrequency(freq: Frequency) {
    setDraft((d) => ({
      ...d,
      frequency: freq,
      generate_day: clampDay(freq, d.generate_day),
    }))
  }

  return (
    <PageContainer width={860}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)' }}>习惯</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'none', border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-pill)', padding: '6px 14px',
              fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
              cursor: generating ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)',
              opacity: generating ? 0.7 : 1,
            }}
          >
            {generating ? <Spinner size={12} /> : <Zap size={13} aria-hidden />}
            生成习惯任务
          </button>
          <button
            onClick={openCreate}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'var(--accent)', border: '1px solid var(--accent)',
              borderRadius: 'var(--radius-pill)', padding: '6px 16px',
              fontSize: 'var(--text-sm)', color: 'var(--on-accent)',
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}
          >
            <Plus size={13} aria-hidden /> 新建习惯
          </button>
        </div>
      </div>

      <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '24px' }}>
        习惯会在指定时间自动生成任务，点击"生成习惯任务"可立即触发。
      </p>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}><Spinner size={20} /></div>
      ) : templates.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-base)', color: 'var(--text-muted)', textAlign: 'center', padding: '48px 0' }}>
          暂无习惯，创建一个习惯
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {templates.map((t) => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '12px 4px', borderBottom: '1px solid var(--border)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', marginBottom: '3px' }}>{t.title}</div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '1px 7px' }}>{t.category}</span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                    {FREQUENCIES.find(f => f.id === t.frequency)?.label || t.frequency}
                    {t.frequency === 'weekly' ? ` 第${t.generate_day}天` : ''}
                    {' '}{t.generate_time}
                  </span>
                  {t.last_generated && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                      上次生成：{t.last_generated.slice(0, 10)}
                    </span>
                  )}
                </div>
              </div>
              <StarRating value={t.star_rating} readonly size="sm" />
              <button onClick={() => openEdit(t)} aria-label="编辑" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: '3px' }}>
                <Pencil size={13} />
              </button>
              <button onClick={() => handleDelete(t.id)} aria-label="删除" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: '3px' }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Form modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? '编辑习惯' : '新建习惯'} maxWidth={500}>
        <Field label="标题">
          <input type="text" value={draft.title ?? ''} onChange={(e) => set('title', e.target.value)} style={inputStyle} onFocus={focusIn} onBlur={focusOut} autoFocus />
        </Field>
        <Field label="描述">
          <textarea value={draft.description ?? ''} onChange={(e) => set('description', e.target.value)} rows={2} style={{ ...inputStyle, resize: 'none' } as React.CSSProperties} onFocus={focusIn as any} onBlur={focusOut as any} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Field label="分类">
            <select value={draft.category ?? '其他'} onChange={(e) => set('category', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }} onFocus={focusIn as any} onBlur={focusOut as any}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="重复频率">
            <select value={draft.frequency ?? 'daily'} onChange={(e) => setFrequency(e.target.value as Frequency)} style={{ ...inputStyle, cursor: 'pointer' }} onFocus={focusIn as any} onBlur={focusOut as any}>
              {FREQUENCIES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Field label={`生成${draft.frequency === 'monthly' ? '日(1-31)' : draft.frequency === 'weekly' ? '星期几(0=周日)' : '(每天不适用)'}`}>
            {draft.frequency === 'daily' ? (
              <input type="number" value="" disabled style={{ ...inputStyle, opacity: 0.5, cursor: 'not-allowed' }} />
            ) : (
              <input
                type="number"
                min={dayRange(draft.frequency)?.min}
                max={dayRange(draft.frequency)?.max}
                value={draft.generate_day ?? dayRange(draft.frequency)?.min ?? 0}
                onChange={(e) => set('generate_day', clampDay(draft.frequency, Number(e.target.value)))}
                style={inputStyle}
                onFocus={focusIn}
                onBlur={focusOut}
              />
            )}
          </Field>
          <Field label="生成时间">
            <input type="time" value={draft.generate_time ?? '08:00'} onChange={(e) => set('generate_time', e.target.value)} style={inputStyle} onFocus={focusIn} onBlur={focusOut} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Field label="截止偏移天" hint="从任务生成当天算起第几天到期。0 = 当天到期，1 = 次日到期，7 = 一周后到期。例如每天生成、偏移 1，则今天生成的任务明天到期。">
            <input type="number" min={0} value={draft.deadline_day ?? 1} onChange={(e) => set('deadline_day', Number(e.target.value))} style={inputStyle} onFocus={focusIn} onBlur={focusOut} />
          </Field>
          <Field label="截止时间">
            <input type="time" value={draft.deadline_time ?? '23:59'} onChange={(e) => set('deadline_time', e.target.value)} style={inputStyle} onFocus={focusIn} onBlur={focusOut} />
          </Field>
        </div>
        <Field label="重要性">
          <StarRating value={draft.star_rating ?? 0} onChange={(v) => set('star_rating', v)} />
        </Field>
        <ModalFooter>
          <button onClick={() => setShowForm(false)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '6px 14px', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>取消</button>
          <button onClick={handleSave} disabled={saving || !draft.title?.trim()} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-pill)', padding: '6px 16px', fontSize: 'var(--text-sm)', color: 'var(--on-accent)', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: 'var(--font-sans)' }}>
            {saving && <Spinner size={12} />} {editing ? '保存' : '创建'}
          </button>
        </ModalFooter>
      </Modal>
    </PageContainer>
  )
}
