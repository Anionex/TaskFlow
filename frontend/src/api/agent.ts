import type { AgentMessage, AgentStep, AgentPending, AgentDecision } from '../types'

interface AgentPayload {
  messages: AgentMessage[]
  user_input?: string
  decision?: AgentDecision
}

export interface AgentDone {
  messages: AgentMessage[]
  reply: string | null
  pending: AgentPending | null
}

export interface StreamHandlers {
  onStart?: () => void
  onDelta?: (text: string) => void
  onThinking?: (text: string) => void
  onTool?: (step: AgentStep) => void
  onDone?: (done: AgentDone) => void
  onError?: (message: string) => void
}

function getBase(): string {
  return (import.meta.env.VITE_API_BASE as string | undefined) || '/api'
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const sid = localStorage.getItem('session_id')
  if (sid) headers['X-Session-Id'] = sid
  // 与 client.ts 一致：自带 LLM key/模型/base url（留空则用服务端默认）
  const key = localStorage.getItem('llm_key')
  const model = localStorage.getItem('llm_model')
  const baseUrl = localStorage.getItem('llm_base_url')
  if (key) headers['X-LLM-Key'] = key
  if (model) headers['X-LLM-Model'] = model
  if (baseUrl) headers['X-LLM-Base-Url'] = baseUrl
  return headers
}

/** 派发一个 SSE 帧（event: / data:）到对应回调。 */
function dispatch(event: string, dataRaw: string, h: StreamHandlers) {
  let data: unknown = null
  try { data = JSON.parse(dataRaw) } catch { /* ignore */ }
  const d = (data ?? {}) as Record<string, unknown>
  switch (event) {
    case 'start':    h.onStart?.(); break
    case 'delta':    h.onDelta?.(String(d.text ?? '')); break
    case 'thinking': h.onThinking?.(String(d.text ?? '')); break
    case 'tool':     h.onTool?.(d as unknown as AgentStep); break
    case 'done':     h.onDone?.(d as unknown as AgentDone); break
    case 'error':    h.onError?.(String(d.message ?? '出错了')); break
  }
}

export const agentApi = {
  /** 流式对话：读 SSE，逐事件回调。messages 为前端持有的不透明历史。
   *  传入 signal 可在组件卸载/重开新流时中止连接（中止不算错误，不回调 onError）。 */
  async chatStream(payload: AgentPayload, h: StreamHandlers, signal?: AbortSignal): Promise<void> {
    let res: Response
    try {
      res = await fetch(`${getBase()}/ai/agent`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(payload),
        signal,
      })
    } catch {
      // 主动中止不算错误
      if (signal?.aborted) return
      h.onError?.('网络错误，请稍后再试')
      return
    }
    if (!res.ok || !res.body) {
      // 已被中止（如被更新的流替换）：与其它中止路径一致，静默返回不回调 onError
      if (signal?.aborted) return
      h.onError?.(`服务异常（${res.status}）`)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    try {
      for (;;) {
        if (signal?.aborted) break
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        // SSE 帧以空行分隔
        let idx: number
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          let event = ''
          let data = ''
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (event) dispatch(event, data, h)
        }
      }
    } catch {
      // reader.read() 在中止时会抛 AbortError：主动中止时静默返回，其它错误上报
      if (!signal?.aborted) h.onError?.('连接中断，请稍后再试')
    } finally {
      // 无论正常结束还是中止都释放底层连接
      void reader.cancel().catch(() => {})
    }
  },
}
