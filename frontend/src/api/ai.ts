import { api } from './client'
import type { BraindumpResult, RewriteResult, DecomposeResult, SearchResult, MorningResult, EveningResult } from '../types'

export const aiApi = {
  // The model decides how many tasks the text contains; always returns { items: [...] }.
  parse: (text: string) =>
    api.postAi<BraindumpResult>('/ai/parse', { text }),

  braindump: (text: string) =>
    api.postAi<BraindumpResult>('/ai/braindump', { text }),

  rewrite: (title: string, description: string) =>
    api.postAi<RewriteResult>('/ai/rewrite', { title, description }),

  decompose: (title: string, description: string) =>
    api.postAi<DecomposeResult>('/ai/decompose', { title, description }),

  // 把任务页当前筛选选择器（状态 + 分类）一并作为检索上下文传给后端。
  search: (query: string, filters?: { status?: string; category?: string }) =>
    api.postAi<SearchResult>('/ai/search', { query, ...filters }),

  morning: () => api.getAi<MorningResult>('/ai/morning'),

  evening: () => api.getAi<EveningResult>('/ai/evening'),
}
