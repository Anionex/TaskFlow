/**
 * AgentSection — Agent 模式聊天页。
 * 多轮、有记忆（前端持有 messages）；模型可调用工具读写任务，写操作经确认卡确认后才生效。
 * 回复走 SSE 流式，Markdown 边流边渲染。
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, ArrowUp } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { ToolTrace } from '@/components/agent/ToolTrace'
import { PendingActionCard } from '@/components/agent/PendingActionCard'
import { Markdown } from '@/components/agent/Markdown'
import { agentApi } from '@/api/agent'
import { useAppStore } from '@/store'
import type { AgentMessage, AgentStep, AgentPending } from '@/types'

type ChatItem =
  | { type: 'user'; text: string }
  | { type: 'steps'; steps: AgentStep[] }
  | { type: 'assistant'; text: string }

interface Payload {
  messages: AgentMessage[]
  user_input?: string
  decision?: { tool_call_id: string; approved: boolean }
}

const EXAMPLES = [
  '拉出我每周一的待办清单（完成和没完成都要），看看出现最多的关键词是什么',
  '用表格列出我所有待办任务的标题、分类和截止时间',
  '新建一个明天下午三点截止的工作任务：写周报',
]

export function AgentSection() {
  const { addToast } = useAppStore()
  const [transcript, setTranscript] = useState<ChatItem[]>([])
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [pending, setPending] = useState<AgentPending | null>(null)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')

  // 本轮进行中的流式状态（committed 前的临时展示）
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([])
  const [liveText, setLiveText] = useState('')
  // 用 ref 做累加的真值来源，避免异步回调里的闭包陈旧问题
  const liveStepsRef = useRef<AgentStep[]>([])
  const liveTextRef = useRef('')
  const liveThinkingRef = useRef('')

  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  // 同步的在途标记：busy 是异步 state，单靠它无法挡住同一帧内的两次触发（双击/回车+点击）。
  const inFlightRef = useRef(false)
  // 当前在途流的中止控制器；组件卸载或重开新流时用它断开连接。
  const abortRef = useRef<AbortController | null>(null)
  // 组件是否仍挂载：中止/卸载后的异步回调据此跳过 setState。
  const mountedRef = useRef(true)

  // 卸载时中止在途流并置卸载标记，避免连接泄漏与卸载后 setState
  useEffect(() => {
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  // 新内容到达时滚到底部（含流式增量）；仅当用户本就贴着底部时才跟随，
  // 否则用户向上翻看时不被每个 token 拽回底部。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [transcript, pending, busy, liveText, liveSteps])

  // 输入框自适应高度
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(160, Math.max(24, ta.scrollHeight))}px`
  }, [input])

  const resetLive = useCallback(() => {
    liveStepsRef.current = []
    liveTextRef.current = ''
    liveThinkingRef.current = ''
    setLiveSteps([])
    setLiveText('')
  }, [])

  const flushThinking = useCallback(() => {
    if (liveThinkingRef.current.trim()) {
      liveStepsRef.current = [...liveStepsRef.current, { kind: 'thinking', text: liveThinkingRef.current }]
      setLiveSteps(liveStepsRef.current)
      liveThinkingRef.current = ''
    }
  }, [])

  // 调用方负责同步置位 inFlightRef 后再进入；这里在结束时复位。
  const runChat = useCallback(
    // retryText 仅在 send() 路径传入：出错时用它回滚 transcript 用户气泡并还原输入
    async (payload: Payload, retryText?: string) => {
      // 开新流前先中止上一条在途流，避免连接泄漏与回调串扰
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      // 本流是否仍是当前流：被更新的流替换后，其迟到的回调不应再写 state
      const alive = () => mountedRef.current && abortRef.current === controller

      setBusy(true)
      resetLive()
      let terminal = false

      await agentApi.chatStream(payload, {
        onStart: () => {
          if (!alive()) return
          // 新的模型段：清掉上一段的旁白（工具旁白已在 onTool 折叠）
          liveTextRef.current = ''
          liveThinkingRef.current = ''
          setLiveText('')
        },
        onDelta: (t) => {
          if (!alive()) return
          liveTextRef.current += t
          setLiveText(liveTextRef.current)
        },
        onThinking: (t) => {
          if (!alive()) return
          liveThinkingRef.current += t
        },
        onTool: (step) => {
          if (!alive()) return
          flushThinking()
          // 工具调用前若模型有旁白文字，折进思考轨迹
          if (liveTextRef.current.trim()) {
            liveStepsRef.current = [...liveStepsRef.current, { kind: 'thinking', text: liveTextRef.current }]
            liveTextRef.current = ''
            setLiveText('')
          }
          liveStepsRef.current = [...liveStepsRef.current, step]
          setLiveSteps(liveStepsRef.current)
        },
        onDone: (d) => {
          if (!alive()) return
          terminal = true
          flushThinking()
          const steps = liveStepsRef.current
          const reply = (d.reply && String(d.reply)) || liveTextRef.current
          setTranscript((prev) => {
            const n = [...prev]
            if (steps.length) n.push({ type: 'steps', steps })
            if (reply && reply.trim()) n.push({ type: 'assistant', text: reply })
            return n
          })
          setMessages(d.messages ?? [])
          setPending(d.pending ?? null)
          resetLive()
        },
        onError: (m) => {
          if (!alive()) return
          terminal = true
          addToast({ type: 'error', message: m })
          // 本轮服务端未提交任何 assistant/tool 结果：messages 未更新，但 send() 已把
          // 用户气泡推进 transcript。若不回滚，下一轮会用缺了这一条的旧 messages 重发，
          // transcript 与后端上下文就此错位。这里回滚该用户气泡并还原输入，方便重试。
          // （accept/reject 不加用户气泡、且失败前 messages 未变，无需回滚。）
          if (retryText !== undefined) {
            setTranscript((prev) => {
              const n = [...prev]
              const last = n[n.length - 1]
              if (last && last.type === 'user' && last.text === retryText) n.pop()
              return n
            })
            setInput(retryText)
          }
          resetLive()
        },
      }, controller.signal)

      // 被更新的流替换或已卸载：不再触碰任何 state / 在途标记
      if (!alive()) return

      // 流意外中断（既无 done 也无 error）：尽量留存已到内容，避免凭空消失
      if (!terminal) {
        flushThinking()
        const steps = liveStepsRef.current
        const partial = liveTextRef.current
        if (steps.length || partial.trim()) {
          setTranscript((prev) => {
            const n = [...prev]
            if (steps.length) n.push({ type: 'steps', steps })
            if (partial.trim()) n.push({ type: 'assistant', text: partial })
            return n
          })
        }
        resetLive()
      }

      inFlightRef.current = false
      setBusy(false)
    },
    [addToast, resetLive, flushThinking],
  )

  function send(text: string) {
    const t = text.trim()
    if (!t || pending || inFlightRef.current) return
    inFlightRef.current = true
    setTranscript((prev) => [...prev, { type: 'user', text: t }])
    setInput('')
    void runChat({ messages, user_input: t }, t)
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

  const empty = transcript.length === 0 && !pending && !busy
  // 流式期间「还没出任何内容」时显示的思考态
  const thinkingOnly = busy && !pending && liveText === '' && liveSteps.length === 0

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
                  <Markdown text={item.text} />
                </div>
              )
            })
          )}

          {/* 流式进行中的临时展示 */}
          {liveSteps.length > 0 && <ToolTrace steps={liveSteps} />}
          {liveText && (
            <div style={{ margin: '0 0 18px' }}>
              <Markdown text={liveText} />
            </div>
          )}

          {pending && (
            <PendingActionCard pending={pending} busy={busy} onAccept={accept} onReject={reject} />
          )}

          {thinkingOnly && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', margin: '4px 0 16px' }}>
              <Spinner size={14} />
              <span style={{ fontFamily: 'var(--font-voice)', fontSize: 'var(--text-sm)' }}>正在思考…</span>
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
