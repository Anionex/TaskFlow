/**
 * PendingActionCard — 模型拟改动业务数据时，淡入展示一张确认卡。
 * 接受 → 真正执行；拒绝 → 停下并由模型询问如何调整。改动前不写库。
 */
import { Check, X, Plus, Pencil, Trash2 } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import type { AgentPending } from '@/types'

interface Props {
  pending: AgentPending
  busy: boolean
  onAccept: () => void
  onReject: () => void
}

const FIELD_LABEL: Record<string, string> = {
  title: '标题',
  description: '备注',
  category: '分类',
  star_rating: '星级',
  completed: '完成',
  start_date: '开始',
  deadline: '截止',
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '（空）'
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v)
    if (!isNaN(d.getTime())) return d.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
  }
  return String(v)
}

function actionVisual(action: string): { icon: React.ReactNode; color: string; verb: string } {
  switch (action) {
    case 'create': return { icon: <Plus size={13} aria-hidden />, color: 'var(--success)', verb: '新建' }
    case 'delete': return { icon: <Trash2 size={13} aria-hidden />, color: 'var(--danger)', verb: '删除' }
    default:       return { icon: <Pencil size={13} aria-hidden />, color: 'var(--accent)', verb: '修改' }
  }
}

export function PendingActionCard({ pending, busy, onAccept, onReject }: Props) {
  const { action, args, current } = pending.preview
  const visual = actionVisual(action)

  // 渲染的字段：改/删用 args 里出现的（除 id）；新建直接展示 args。
  const fields = Object.keys(args).filter((k) => k !== 'id')

  return (
    <div
      className="tf-rise"
      style={{
        border: '1px solid var(--border-strong)',
        borderLeft: `2px solid ${visual.color}`,
        borderRadius: 'var(--radius-lg)',
        background: 'var(--surface-1)',
        padding: '16px 18px',
        margin: '6px 0 14px',
      }}
    >
      {/* 头部：动作 + 摘要 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '12px', color: visual.color }}>
        {visual.icon}
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--fw-medium)' }}>
          需要确认 · {visual.verb}
        </span>
      </div>

      <p style={{
        fontFamily: 'var(--font-voice)', fontSize: 'var(--text-base)',
        color: 'var(--text-primary)', lineHeight: 'var(--lh-snug)', margin: '0 0 12px',
      }}>
        {pending.summary}
      </p>

      {/* 字段对照：改/删显示 当前 → 拟改；新建显示拟建字段 */}
      {action !== 'delete' && fields.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
          {fields.map((k) => {
            const next = (args as Record<string, unknown>)[k]
            const prev = current ? (current as Record<string, unknown>)[k] : undefined
            const changed = action === 'update' && current != null
            return (
              <div key={k} style={{ display: 'flex', gap: '8px', fontSize: 'var(--text-sm)', alignItems: 'baseline' }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 40, flexShrink: 0 }}>
                  {FIELD_LABEL[k] ?? k}
                </span>
                {changed && (
                  <>
                    <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{fmt(prev)}</span>
                    <span style={{ color: 'var(--text-muted)' }}>→</span>
                  </>
                )}
                <span style={{ color: 'var(--text-primary)' }}>{fmt(next)}</span>
              </div>
            )
          })}
        </div>
      )}

      {action === 'delete' && current && (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '0 0 14px' }}>
          「{fmt((current as Record<string, unknown>).title)}」将被移到回收站，可在回收站恢复。
        </p>
      )}

      {/* 操作 */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={onReject}
          disabled={busy}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-pill)', padding: '5px 14px',
            fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
            cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)',
          }}
        >
          <X size={12} aria-hidden /> 拒绝
        </button>
        <button
          onClick={onAccept}
          disabled={busy}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            background: visual.color, border: `1px solid ${visual.color}`,
            borderRadius: 'var(--radius-pill)', padding: '5px 16px',
            fontSize: 'var(--text-sm)', color: 'var(--on-accent)',
            cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1,
            fontFamily: 'var(--font-sans)',
          }}
        >
          {busy ? <Spinner size={12} /> : <Check size={12} aria-hidden />}
          接受
        </button>
      </div>
    </div>
  )
}
