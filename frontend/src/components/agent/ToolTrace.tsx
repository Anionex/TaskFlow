/**
 * ToolTrace — 折叠展示某一轮里模型的工具调用与思考。
 * 默认折叠，只露出一行"看了什么"；点开看每步详情。空气感：hairline、留白、低饱和。
 */
import { useState } from 'react'
import { ChevronRight, Wrench, Brain } from 'lucide-react'
import type { AgentStep } from '@/types'

const TOOL_LABEL: Record<string, string> = {
  list_tasks: '查询任务',
  get_stats: '统计数据',
  create_task: '新建任务',
  update_task: '修改任务',
  delete_task: '删除任务',
}

function stepLine(s: AgentStep): string {
  if (s.kind === 'thinking') return '思考'
  const label = TOOL_LABEL[s.name ?? ''] ?? s.name ?? '工具'
  if (!s.ok) return `${label} · 失败`
  if (s.name === 'list_tasks') {
    const r = s.result
    const count = r && typeof r === 'object' ? (r as { count?: unknown }).count : undefined
    return typeof count === 'number' ? `${label} · ${count} 条` : label
  }
  return label
}

export function ToolTrace({ steps }: { steps: AgentStep[] }) {
  const [open, setOpen] = useState(false)
  if (!steps.length) return null

  const summary = steps.map(stepLine).join(' · ')

  return (
    <div style={{ margin: '2px 0 10px' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', fontSize: 'var(--text-xs)',
          fontFamily: 'var(--font-sans)', padding: '2px 0',
        }}
      >
        <ChevronRight
          size={12}
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur-fast)' }}
          aria-hidden
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 460 }}>
          {open ? '过程' : summary}
        </span>
      </button>

      {open && (
        <div style={{
          marginTop: '8px', marginLeft: '6px', paddingLeft: '14px',
          borderLeft: '1px solid var(--border)', display: 'flex',
          flexDirection: 'column', gap: '10px',
        }}>
          {steps.map((s, i) => (
            <div key={i} style={{ fontSize: 'var(--text-xs)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
                {s.kind === 'thinking'
                  ? <Brain size={12} aria-hidden style={{ color: 'var(--text-muted)' }} />
                  : <Wrench size={12} aria-hidden style={{ color: 'var(--text-muted)' }} />}
                <span>{stepLine(s)}</span>
              </div>
              {s.kind === 'thinking' && s.text && (
                <p style={{
                  margin: '4px 0 0 18px', color: 'var(--text-muted)',
                  fontFamily: 'var(--font-voice)', lineHeight: 'var(--lh-snug)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {s.text}
                </p>
              )}
              {s.kind === 'tool' && (
                <pre style={{
                  margin: '4px 0 0 18px', color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)',
                  lineHeight: 'var(--lh-snug)', whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word', maxHeight: 180, overflow: 'auto',
                }}>
                  {JSON.stringify(s.args ?? {}, null, 0)}
                  {s.result != null ? '\n→ ' + JSON.stringify(s.result).slice(0, 600) : ''}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
