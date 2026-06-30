/**
 * API client.
 * Base URL is fixed at build time: VITE_API_BASE || '/api'.
 * (Web defaults to '/api' via Vite proxy; desktop injects VITE_API_BASE at build.)
 */

function getBase(): string {
  return (import.meta.env.VITE_API_BASE as string | undefined) || '/api'
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
  const json: ApiResponse<T> = await res.json()
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
    return res.json()
  },

  download: async (path: string): Promise<Blob> => {
    const sid = sessionId()
    const headers: Record<string, string> = {}
    if (sid) headers['X-Session-Id'] = sid
    const base = getBase()
    const res = await fetch(`${base}${path}`, { method: 'GET', headers })
    if (!res.ok) throw new Error('Download failed')
    return res.blob()
  },
}
