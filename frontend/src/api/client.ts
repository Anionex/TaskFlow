/**
 * API client.
 * Base URL is fixed at build time: VITE_API_BASE || '/api'.
 * (Web defaults to '/api' via Vite proxy; desktop injects VITE_API_BASE at build.)
 */

import { useAppStore } from '@/store'

function getBase(): string {
  return (import.meta.env.VITE_API_BASE as string | undefined) || '/api'
}

// 会话过期(401)时清掉本地会话。路由的 RequireAuth 订阅了 store.sessionId，
// sessionId 变 null 会自动重渲染并跳登录页——用 React Router 处理，不做硬跳转，
// 兼容 Web 与 Tauri(tauri://localhost)，也不清空内存状态。clearSession 幂等，无需防抖标志。
function handleExpiredSession() {
  useAppStore.getState().clearSession()
}

// 兜底解析：响应非 JSON(500 HTML / 413 / body 解析失败)时返回合成错误而非抛出，
// 让缺少 try/catch 的调用方也能优雅降级。
async function safeJson<T>(res: Response): Promise<ApiResponse<T>> {
  try {
    return await res.json()
  } catch {
    return { success: false, message: '服务异常' }
  }
}

function sessionId(): string | null {
  return localStorage.getItem('session_id')
}

function llmHeaders(): Record<string, string> {
  const key = localStorage.getItem('llm_key') ?? ''
  const model = localStorage.getItem('llm_model') ?? ''  // 留空则用服务端默认(deepseek-v4-flash)
  const baseUrl = localStorage.getItem('llm_base_url') ?? ''
  const headers: Record<string, string> = {}
  if (key) headers['X-LLM-Key'] = key
  if (model) headers['X-LLM-Model'] = model
  if (baseUrl) headers['X-LLM-Base-Url'] = baseUrl
  return headers
}

export interface ApiResponse<T = unknown> {
  success: boolean
  message: string
  data?: T
}

async function request<T = unknown>(
  path: string,
  options: RequestInit = {},
  withLlm = false,
): Promise<ApiResponse<T>> {
  const sid = sessionId()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  if (sid) headers['X-Session-Id'] = sid
  if (withLlm) Object.assign(headers, llmHeaders())

  const base = getBase()
  const res = await fetch(`${base}${path}`, { ...options, headers })
  const json = await safeJson<T>(res)
  // 后端鉴权失败返回 401(JSON body)；或个别接口 200 带 {success:false,message:'未登录'}。
  if (res.status === 401 || (!json.success && json.message === '未登录')) {
    handleExpiredSession()
  }
  return json
}

export const api = {
  get: <T = unknown>(path: string) =>
    request<T>(path, { method: 'GET' }),

  getAi: <T = unknown>(path: string) =>
    request<T>(path, { method: 'GET' }, true),

  post: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),

  postAi: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }, true),

  put: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),

  delete: <T = unknown>(path: string) =>
    request<T>(path, { method: 'DELETE' }),

  upload: async <T = unknown>(path: string, file: File): Promise<ApiResponse<T>> => {
    const sid = sessionId()
    const form = new FormData()
    form.append('file', file)
    const headers: Record<string, string> = {}
    if (sid) headers['X-Session-Id'] = sid
    const base = getBase()
    const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: form })
    const json = await safeJson<T>(res)
    if (res.status === 401 || (!json.success && json.message === '未登录')) {
      handleExpiredSession()
    }
    return json
  },

  download: async (path: string): Promise<Blob> => {
    const sid = sessionId()
    const headers: Record<string, string> = {}
    if (sid) headers['X-Session-Id'] = sid
    const base = getBase()
    const res = await fetch(`${base}${path}`, { method: 'GET', headers })
    if (res.status === 401) handleExpiredSession()
    if (!res.ok) throw new Error('Download failed')
    return res.blob()
  },
}
