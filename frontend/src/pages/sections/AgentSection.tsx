/**
 * AgentSection — Agent 模式聊天页。
 * 多轮、有记忆（前端持有 messages）；模型可调用工具读写任务，写操作经确认卡确认后才生效。
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, ArrowUp } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { ToolTrace } from '@/components/agent/ToolTrace'
import { PendingActionCard } from '@/components/agent/PendingActionCard'
import { agentApi } from '@/api/agent'
import { useAppStore } from '@/store'
import type { AgentMessage, AgentStep, AgentPending, AgentTurn } from '@/types'

type ChatItem =
  | { type: 'user'; text: string }
  | { type: 'steps'; steps: AgentStep[] }
  | { type: 'assistant'; text: string }

const EXAMPLES = [
  '拉出我每周一的待办清单（完成和没完成都要），看看出现最多的关键词是什么',
  '帮我把所有已经过期的任务，星级都调成 5',
  '新建一个明天下午三点截止的工作任务：写周报',
]

export function AgentSection() {
  const { addToast } = useAppStore()
  const [transcript, setTranscript] = useState<ChatItem[]>([])
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [pending, setPending] = useState<AgentPending | null>(null)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')

  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  // 同步的在途标记：busy 是异步 state，单靠它无法挡住同一帧内的两次触发（双击/回车+点击）。
  const inFlightRef = useRef(false)

  // 新内容到达时滚到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [transcript, pending, busy])

  // 输入框自适应高度
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(160, Math.max(24, ta.scrollHeight))}px`
  }, [input])

  const applyTurn = useCallback((turn: AgentTurn) => {
    setMessages(turn.messages)
    setTranscript((prev) => {
      const next = [...prev]
      if (turn.steps && turn.steps.length) next.push({ type: 'steps', steps: turn.steps })
      if (turn.reply && turn.reply.trim()) next.push({ type: 'assistant', text: turn.reply })
      return next
    })
    setPending(turn.pending ?? null)
  }, [])

  // 调用方负责同步置位 inFlightRef 后再进入；这里只在结束时复位。
  const runChat = useCallback(
    async (payload: Parameters<typeof agentApi.chat>[0]) => {
      setBusy(true)
      try {
        const res = await agentApi.chat(payload)
        if (!res.success || !res.data) {
          addToast({ type: 'error', message: res.message || '助理暂时不可用' })
          return
        }
        applyTurn(res.data)
      } catch {
        addToast({ type: 'error', message: '网络错误，请稍后再试' })
      } finally {
        inFlightRef.current = false
        setBusy(false)
      }
    },
    [addToast, applyTurn],
  )

  function send(text: string) {
    const t = text.trim()
    if (!t || pending || inFlightRef.current) return
    inFlightRef.current = true
    setTranscript((prev) => [...prev, { type: 'user', text: t }])
    setInput('')
    void runChat({ messages, user_input: t })
  }

  function accept() {
    if (!pending || inFlightRef.current) return
    inFlightRef.current = true
    void runChat({ messages, decision: { tool_call_id: pending.tool_call_id, approved: true } })
  }

  function reject() {
    if (!pending || inFlightRef.current) return
    inFlightRef.current = true
    void runChat({ messages, decision: { tool_call_id: pending.tool_call_id, approved: false } })
  }

  const empty = transcript.length === 0 && !pending

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: '22px 24px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <h1 style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          fontSize: 'var(--text-xl)', fontWeight: 'var(--fw-medium)',
          color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.3px',
        }}>
          <Sparkles size={18} style={{ color: 'var(--accent)' }} aria-hidden />
          智能助理
        </h1>
        <p style={{
          fontFamily: 'var(--font-voice)', fontSize: 'var(--text-sm)',
          color: 'var(--text-muted)', margin: '6px 0 0',
        }}>
          用聊天的方式查看、整理你的任务。涉及改动会先征求你的同意。
        </p>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 24px 8px' }}>
          {empty ? (
            <div style={{ paddingTop: 'min(12vh, 90px)', textAlign: 'center' }}>
              <p style={{
                fontFamily: 'var(--font-voice)', fontSize: 'var(--text-lg)',
                color: 'var(--text-secondary)', lineHeight: 'var(--lh-snug)', margin: '0 0 22px',
              }}>
                想了解或调整什么？我可以帮你查、帮你改。
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => send(ex)}
                    disabled={busy}
                    style={{
                      maxWidth: 520, textAlign: 'left',
                      background: 'var(--surface-1)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)', padding: '10px 14px',
                      fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
                      cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)',
                      lineHeight: 'var(--lh-snug)', transition: 'border-color var(--dur-fast)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            transcript.map((item, i) => {
              if (item.type === 'user') {
                return (
                  <div key={i} className="tf-rise" style={{ display: 'flex', justifyContent: 'flex-end', margin: '0 0 16px' }}>
                    <div style={{
                      maxWidth: '80%', background: 'var(--accent-soft)',
                      borderRadius: 'var(--radius-lg)', padding: '9px 14px',
                      fontSize: 'var(--text-base)', color: 'var(--text-primary)',
                      lineHeight: 'var(--lh-snug)', whiteSpace: 'pre-wrap',
                    }}>
                      {item.text}
                    </div>
                  </div>
                )
              }
              if (item.type === 'steps') {
                return <ToolTrace key={i} steps={item.steps} />
              }
              return (
                <div key={i} className="tf-rise" style={{ margin: '0 0 18px' }}>
                  <p style={{
                    fontFamily: 'var(--font-voice)', fontSize: 'var(--text-base)',
                    color: 'var(--text-primary)', lineHeight: 'var(--lh-normal)',
                    margin: 0, whiteSpace: 'pre-wrap',
                  }}>
                    {item.text}
                  </p>
                </div>
              )
            })
          )}

          {pending && (
            <PendingActionCard pending={pending} busy={busy} onAccept={accept} onReject={reject} />
          )}

          {busy && !pending && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', margin: '4px 0 16px' }}>
              <Spinner size={14} />
              <span style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-sm)' }}>正在处理…</span>
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', padding: '14px 24px 18px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: '10px',
            background: 'var(--surface-1)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: '10px 12px 10px 16px',
            opacity: pending ? 0.6 : 1,
          }}>
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy || !!pending}
              onKeyDown={(e) => {
                // 中文等输入法合成期间的回车用于上屏候选词，不应触发发送。
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  send(input)
                }
              }}
              placeholder={pending ? '请先确认上方的改动…' : '问点什么，或让我帮你改…'}
              rows={1}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                resize: 'none', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)',
                color: 'var(--text-primary)', lineHeight: 'var(--lh-snug)', maxHeight: 160,
              }}
            />
            <button
              onClick={() => send(input)}
              disabled={busy || !!pending || !input.trim()}
              aria-label="发送"
              style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: 'var(--radius-pill)',
                background: !input.trim() || busy || pending ? 'var(--border)' : 'var(--accent)',
                color: !input.trim() || busy || pending ? 'var(--text-muted)' : 'var(--on-accent)',
                border: 'none', cursor: !input.trim() || busy || pending ? 'not-allowed' : 'pointer',
                transition: 'background var(--dur-fast)',
              }}
            >
              <ArrowUp size={16} aria-hidden />
            </button>
          </div>
          <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', margin: '8px 2px 0', textAlign: 'center' }}>
            助理可能出错；涉及增删改的操作都会先请你确认。
          </p>
        </div>
      </div>
    </div>
  )
}
